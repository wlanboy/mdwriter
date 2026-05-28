'use strict';

// ── File API ──────────────────────────────────────────────────────────────────
async function saveFile(t) {
  if (!t) t = activeTab();
  if (!t || !t.serverPath) return;
  if (t.id === activeId) t.content = editor.value;
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(t.serverPath), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: t.content,
    });
    if (res.ok || res.status === 204) {
      markSaved(t);
      toast('Gespeichert');
    } else {
      toast('Fehler beim Speichern (' + res.status + ')');
    }
  } catch {
    toast('Netzwerkfehler');
  }
}

async function openFromServer() {
  try {
    const res   = await fetch('/api/files');
    const files = await res.json();
    fileList.innerHTML = '';
    if (!files.length) {
      fileList.innerHTML = '<div class="file-empty">Keine Dateien vorhanden</div>';
    } else {
      files.forEach(name => {
        const div = document.createElement('div');
        div.className   = 'file-item';
        div.textContent = name;
        div.addEventListener('click', () => {
          openModal.classList.remove('open');
          loadFile(name);
        });
        fileList.appendChild(div);
      });
    }
    openModal.classList.add('open');
  } catch {
    toast('Fehler beim Laden der Dateiliste');
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
  if (!/^[\w\- .()]+\.md$/.test(name)) {
    saveInput.classList.add('invalid');
    toast('Ungültiger Dateiname');
    return;
  }
  t.serverPath = name;
  t.name       = name.replace(/\.md$/, '');
  saveModal.classList.remove('open');
  renderTabs();
  await saveFile(t);
}
