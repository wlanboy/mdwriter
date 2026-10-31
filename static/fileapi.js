'use strict';

// ── File API ──────────────────────────────────────────────────────────────────
const VALID_NAME = /^[\w\- .()]+\.md$/;

// Tabs from documents/ have no project; project tabs hold a path relative to it.
function fileUrl(project, path) {
  if (!project) return '/api/files/' + encodeURIComponent(path);
  return '/api/projects/' + encodeURIComponent(project) + '/files/' +
    path.split('/').map(encodeURIComponent).join('/');
}

function findFileTab(project, path) {
  return tabs.find(t => (t.project || null) === project && t.serverPath === path);
}

// Per-tab queue so a save never sends an ETag that an in-flight save is about to replace,
// and never targets a path that a pending rename is about to move.
const saveQueue = new Map();

function enqueue(t, op) {
  const prev = saveQueue.get(t.id) || Promise.resolve();
  const next = prev.then(op);
  saveQueue.set(t.id, next);
  return next;
}

// Ids of tabs with a PUT in flight; only drives the tab dot, so it is not persisted.
const savingTabs = new Set();

// Resolves to true if the content reached the server. With `ask` a version
// conflict offers to overwrite; without, it only marks the tab.
function saveFile(t, ask = false) {
  if (!t) t = activeTab();
  if (!t || !t.serverPath) return Promise.resolve(false);
  return enqueue(t, () => putFile(t, false, ask));
}

function overwriteFile(t) {
  if (!t || !t.serverPath) return Promise.resolve(false);
  return enqueue(t, () => putFile(t, true, false));
}

// Drops local changes for the server version. It goes in as an edit, so Ctrl+Z
// brings the local version back.
function reloadFromServer(t) {
  if (!t || !t.serverPath) return Promise.resolve(false);
  return enqueue(t, async () => {
    let content, tag;
    try {
      const res = await fetch(fileUrl(t.project, t.serverPath));
      if (!res.ok) {
        toast(res.status === 404 ? 'Datei nicht gefunden' : 'Fehler beim Laden (' + res.status + ')');
        return false;
      }
      content = await res.text();
      tag     = res.headers.get('ETag');
    } catch {
      toast('Netzwerkfehler');
      return false;
    }
    if (t.id === activeId) {
      editor.focus();
      editor.select();
      insertText(content);
      editor.setSelectionRange(0, 0);
      editor.scrollTop = 0;
    }
    Object.assign(t, { content, etag: tag, saved: true, conflict: false });
    // The edit above scheduled a save of what the server already has.
    cancelAutosave(t.id);
    updateTabStatus(t);
    return true;
  });
}

// Resolves to true if the tab may take the new name.
function renameFile(t, path) {
  if (!VALID_NAME.test(path)) {
    toast('Ungültiger Dateiname');
    return Promise.resolve(false);
  }
  return enqueue(t, () => moveFile(t, path));
}

async function moveFile(t, path) {
  // File deleted meanwhile: nothing left to move.
  if (!t.serverPath) return true;
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(t.serverPath) +
      '/rename?to=' + encodeURIComponent(path), { method: 'POST' });
    if (res.ok) {
      t.serverPath = path;
      return true;
    }
    toast(res.status === 409 ? '„' + path + '" existiert bereits'
      : res.status === 404 ? '„' + t.serverPath + '" nicht gefunden'
      : 'Fehler beim Umbenennen (' + res.status + ')');
  } catch {
    toast('Netzwerkfehler');
  }
  return false;
}

async function putFile(t, force, ask) {
  if (!t.serverPath) return false;
  if (t.id === activeId) t.content = editor.value;
  const body = t.content;
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  // Known version → only overwrite that version; no version yet → only create.
  if (!force) {
    if (t.etag) headers['If-Match'] = t.etag;
    else headers['If-None-Match'] = '*';
  }
  savingTabs.add(t.id);
  updateTabStatus(t);
  try {
    const res = await fetch(fileUrl(t.project, t.serverPath), {
      method: 'PUT',
      headers,
      body,
    });
    if (res.ok) {
      t.etag     = res.headers.get('ETag');
      t.conflict = false;
      // Typing during the request left newer content that still needs saving.
      t.saved    = t.content === body;
      return true;
    }
    if (res.status === 412) {
      const msg = t.etag
        ? '„' + t.serverPath + '" wurde auf dem Server geändert. Trotzdem überschreiben?'
        : '„' + t.serverPath + '" existiert bereits. Überschreiben?';
      if (ask && confirm(msg)) return await putFile(t, true, false);
      // The conflict bar offers reload or overwrite; autosave waits for that.
      t.conflict = true;
      return false;
    }
    toast(res.status === 413
      ? 'Datei zu groß (max. 5 MB)'
      : 'Fehler beim Speichern (' + res.status + ')');
  } catch {
    toast('Netzwerkfehler');
  } finally {
    savingTabs.delete(t.id);
    updateTabStatus(t);
  }
  return false;
}

async function openFromServer() {
  try {
    const res   = await fetch('/api/files');
    const files = await res.json();
    fileList.innerHTML = '';
    if (!files.length) {
      fileList.innerHTML = '<div class="file-empty">Keine Dateien vorhanden</div>';
    } else {
      files.forEach(name => fileList.appendChild(makeFileItem(name)));
    }
    openModal.classList.add('open');
  } catch {
    toast('Fehler beim Laden der Dateiliste');
  }
}

function makeFileItem(name) {
  const row = document.createElement('div');
  row.className = 'file-item';

  const label = document.createElement('span');
  label.className = 'file-item-name';
  label.textContent = name;
  label.addEventListener('click', () => {
    openModal.classList.remove('open');
    openFile(null, name);
  });

  const del = document.createElement('button');
  del.className = 'file-item-del';
  del.title = 'Löschen';
  del.textContent = '×';
  del.addEventListener('click', e => {
    e.stopPropagation();
    deleteServerFile(name, row);
  });

  row.append(label, del);
  return row;
}

async function deleteServerFile(name, row) {
  if (!confirm('„' + name + '" wirklich löschen?')) return;
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      row.remove();
      if (!fileList.children.length) {
        fileList.innerHTML = '<div class="file-empty">Keine Dateien vorhanden</div>';
      }
      const openTab = findFileTab(null, name);
      if (openTab) {
        openTab.serverPath = null;
        openTab.etag = null;
        openTab.saved = false;
        openTab.conflict = false;
        renderTabs();
      }
      toast('Gelöscht');
    } else {
      toast('Fehler beim Löschen (' + res.status + ')');
    }
  } catch {
    toast('Netzwerkfehler');
  }
}

function tabName(path) {
  return path.split('/').pop().replace(/\.md$/i, '');
}

// Opens the file in a new tab; a file that is already open is only brought to the front.
async function openFile(project, path) {
  const existing = findFileTab(project, path);
  if (existing) { activateTab(existing.id); return; }

  let content, tag;
  try {
    const res = await fetch(fileUrl(project, path));
    if (!res.ok) {
      toast(res.status === 404 ? 'Datei nicht gefunden' : 'Fehler beim Öffnen (' + res.status + ')');
      return;
    }
    content = await res.text();
    tag     = res.headers.get('ETag');
  } catch {
    toast('Fehler beim Öffnen');
    return;
  }

  const fields = {
    name: tabName(path), content, serverPath: path, project,
    etag: tag, saved: true, conflict: false,
  };
  // A second click may have opened it while the request was pending.
  const opened = findFileTab(project, path);
  if (opened) { activateTab(opened.id); return; }

  // An empty, never-saved tab is replaced instead of left behind.
  const cur = activeTab();
  if (cur && !cur.serverPath && cur.content.trim() === '') {
    Object.assign(cur, fields);
    // The editor still shows the old file; keep activateTab from copying it back.
    if (cur.id === activeId) activeId = 0;
    activateTab(cur.id);
  } else {
    openTab(Object.assign(makeTab(), fields));
  }
}

function downloadFile() {
  const t = activeTab();
  if (!t) return;
  if (t.id === activeId) t.content = editor.value;
  const yaml = isYamlPath(t.serverPath);
  const blob = new Blob([t.content], { type: yaml ? 'application/yaml' : 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = t.serverPath ? t.serverPath.split('/').pop() : (t.name + '.md');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function promptSaveAs() {
  const t = activeTab();
  if (!t) return;
  saveInput.value = t.serverPath || (t.name + '.md');
  saveInput.classList.remove('invalid');
  saveModal.classList.add('open');
  requestAnimationFrame(() => saveInput.focus());
}

async function confirmSaveAs() {
  const t = activeTab();
  if (!t) return;
  let name = saveInput.value.trim();
  if (!name) return;
  if (!name.endsWith('.md')) name += '.md';
  if (!VALID_NAME.test(name)) {
    saveInput.classList.add('invalid');
    toast('Ungültiger Dateiname');
    return;
  }
  const prev = { serverPath: t.serverPath, project: t.project, name: t.name, etag: t.etag };
  if (name !== t.serverPath || t.project) t.etag = null;
  t.serverPath = name;
  t.project    = null;
  t.name       = name.replace(/\.md$/, '');
  saveModal.classList.remove('open');
  renderTabs();
  if (!(await saveFile(t, true)) && t.conflict) {
    // Overwrite declined: keep the tab bound to its previous file.
    Object.assign(t, prev, { conflict: false });
    renderTabs();
  }
}
