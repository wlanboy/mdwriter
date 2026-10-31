'use strict';

// ── File API ──────────────────────────────────────────────────────────────────
const VALID_NAME = /^[\w\- .()]+\.md$/;

// Per-tab queue so a save never sends an ETag that an in-flight save is about to replace,
// and never targets a path that a pending rename is about to move.
const saveQueue = new Map();

function enqueue(t, op) {
  const prev = saveQueue.get(t.id) || Promise.resolve();
  const next = prev.then(op);
  saveQueue.set(t.id, next);
  return next;
}

// Resolves to true if the content reached the server.
function saveFile(t) {
  if (!t) t = activeTab();
  if (!t || !t.serverPath) return Promise.resolve(false);
  return enqueue(t, () => putFile(t, false));
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

async function putFile(t, force) {
  if (!t.serverPath) return false;
  if (t.id === activeId) t.content = editor.value;
  const body = t.content;
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  // Known version → only overwrite that version; no version yet → only create.
  if (!force) {
    if (t.etag) headers['If-Match'] = t.etag;
    else headers['If-None-Match'] = '*';
  }
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(t.serverPath), {
      method: 'PUT',
      headers,
      body,
    });
    if (res.ok) {
      t.etag     = res.headers.get('ETag');
      t.conflict = false;
      // Typing during the request left newer content that still needs saving.
      t.saved    = t.content === body;
      renderTabs();
      toast('Gespeichert');
      return true;
    }
    if (res.status === 412) {
      const msg = t.etag
        ? '„' + t.serverPath + '" wurde auf dem Server geändert. Trotzdem überschreiben?'
        : '„' + t.serverPath + '" existiert bereits. Überschreiben?';
      if (confirm(msg)) return putFile(t, true);
      t.conflict = true;
      renderTabs();
      toast('Nicht gespeichert');
      return false;
    }
    toast(res.status === 413
      ? 'Datei zu groß (max. 5 MB)'
      : 'Fehler beim Speichern (' + res.status + ')');
  } catch {
    toast('Netzwerkfehler');
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
    loadFile(name);
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
      const openTab = tabs.find(t => t.serverPath === name);
      if (openTab) {
        openTab.serverPath = null;
        openTab.etag = null;
        openTab.saved = false;
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

async function loadFile(name) {
  const existing = tabs.find(t => t.serverPath === name);
  if (existing) { activateTab(existing.id); return; }
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(name));
    if (!res.ok) { toast('Datei nicht gefunden'); return; }
    const content = await res.text();
    const tab = makeTab(name.replace(/\.md$/i, ''), content, name);
    tab.etag  = res.headers.get('ETag');
    tab.saved = true;

    const cur = activeTab();
    if (tabs.length === 1 && cur && !cur.serverPath && cur.content.trim() === '') {
      tabs.splice(tabs.indexOf(cur), 1);
      activeId = 0;
    }

    openTab(tab);
  } catch {
    toast('Fehler beim Öffnen');
  }
}

function downloadFile() {
  const t = activeTab();
  if (!t) return;
  if (t.id === activeId) t.content = editor.value;
  const blob = new Blob([t.content], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = t.serverPath || (t.name + '.md');
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
  const prev = { serverPath: t.serverPath, name: t.name, etag: t.etag };
  if (name !== t.serverPath) t.etag = null;
  t.serverPath = name;
  t.name       = name.replace(/\.md$/, '');
  saveModal.classList.remove('open');
  renderTabs();
  if (!(await saveFile(t)) && t.conflict) {
    // Overwrite declined: keep the tab bound to its previous file.
    Object.assign(t, prev, { conflict: false });
    renderTabs();
  }
}
