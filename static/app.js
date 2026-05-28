'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const editor     = document.getElementById('editor');
const gutter     = document.getElementById('gutter');
const tabsEl     = document.getElementById('tabs');
const btnNew     = document.getElementById('btnNew');
const ctxMenu    = document.getElementById('ctxMenu');
const openModal  = document.getElementById('openModal');
const saveModal  = document.getElementById('saveModal');
const fileList   = document.getElementById('fileList');
const fileInput  = document.getElementById('fileInput');
const toastEl    = document.getElementById('toast');
const saveInput  = document.getElementById('saveFilename');
const workspace  = document.getElementById('workspace');
const previewEl  = document.getElementById('preview');

// ── State ─────────────────────────────────────────────────────────────────────
let tabs          = [];
let activeId      = 0;
let nextId        = 1;
let ctxLine       = -1;
let saveTimer     = null;
let toastTmr      = null;
let previewActive = false;

// ── Tab helpers ───────────────────────────────────────────────────────────────
function makeTab(name = 'Unbenannt', content = '', serverPath = null) {
  return { id: nextId++, name, content, serverPath, saved: false };
}

function tab_(id) { return tabs.find(t => t.id === id); }
function activeTab() { return tab_(activeId); }

// ── Tab operations ────────────────────────────────────────────────────────────
function openTab(tab) {
  tabs.push(tab);
  activateTab(tab.id);
}

function activateTab(id) {
  if (activeId) {
    const cur = tab_(activeId);
    if (cur) cur.content = editor.value;
  }
  activeId = id;
  const t = tab_(id);
  if (t) {
    editor.value = t.content;
    syncGutter();
    editor.focus();
  }
  renderTabs();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (!tabs.length) { newDoc(); return; }
  activateTab(tabs[Math.min(i, tabs.length - 1)].id);
}

function markUnsaved() {
  const t = activeTab();
  if (!t || !t.saved) return;
  t.saved = false;
  renderTabs();
}

function markSaved(t) {
  t.saved = true;
  renderTabs();
}

function renderTabs() {
  tabsEl.querySelectorAll('.tab').forEach(el => el.remove());
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.id === activeId ? ' active' : '') + (!t.saved ? ' unsaved' : '');

    const dot = document.createElement('span');
    dot.className = 'tab-dot';

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = t.name;
    name.addEventListener('click', e => {
      if (t.id !== activeId) return;
      e.stopPropagation();
      startRename(t, name);
    });

    const x = document.createElement('button');
    x.className = 'tab-x';
    x.textContent = '×';
    x.title = 'Schließen';
    x.addEventListener('click', e => { e.stopPropagation(); closeTab(t.id); });

    btn.append(dot, name, x);
    btn.addEventListener('click', () => activateTab(t.id));
    tabsEl.insertBefore(btn, btnNew);
  });
}

function startRename(t, nameSpan) {
  const inp = document.createElement('input');
  inp.className = 'tab-rename';
  inp.value = t.name;

  function commit() {
    const v = inp.value.trim();
    if (v) t.name = v;
    renderTabs();
  }

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { inp.blur(); }
    if (e.key === 'Escape') {
      inp.removeEventListener('blur', commit);
      inp.blur();
      renderTabs();
    }
  });

  nameSpan.replaceWith(inp);
  inp.focus();
  inp.select();
}

// ── Gutter (line numbers + insert button) ────────────────────────────────────
function syncGutter() {
  const count    = editor.value.split('\n').length;
  const existing = gutter.children.length;

  for (let i = existing; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'ln';

    const addBtn = document.createElement('button');
    addBtn.className = 'ln-add';
    addBtn.textContent = '+';
    addBtn.title = 'Einfügen';
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      openCtxMenu(e.clientX, e.clientY, parseInt(row.dataset.i, 10));
    });

    const num = document.createElement('span');
    num.className = 'ln-num';
    num.textContent = i + 1;

    row.dataset.i = i;
    row.append(addBtn, num);
    gutter.appendChild(row);
  }

  while (gutter.children.length > count) {
    gutter.removeChild(gutter.lastChild);
  }

  Array.from(gutter.children).forEach((row, i) => {
    row.dataset.i = i;
    row.querySelector('.ln-num').textContent = i + 1;
  });

  gutter.scrollTop = editor.scrollTop;
}

editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });

// ── Context menu ──────────────────────────────────────────────────────────────
function openCtxMenu(x, y, lineIdx) {
  ctxLine = lineIdx;
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
  ctxMenu.classList.add('open');

  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    if (r.right  > window.innerWidth  - 8) ctxMenu.style.left = (x - r.width)  + 'px';
    if (r.bottom > window.innerHeight - 8) ctxMenu.style.top  = (y - r.height) + 'px';
  });
}

function closeCtxMenu() {
  ctxMenu.classList.remove('open');
  ctxLine = -1;
}

ctxMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (ctxLine >= 0) insertAtLine(ctxLine, btn.dataset.action);
    closeCtxMenu();
  });
});

document.addEventListener('click', e => {
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
});

// ── Preview ───────────────────────────────────────────────────────────────────
function updatePreview() {
  if (!previewActive) return;
  const t  = activeTab();
  const md = t ? (t.id === activeId ? editor.value : t.content) : '';
  previewEl.innerHTML = marked.parse(md);
}

function togglePreview() {
  previewActive = !previewActive;
  workspace.classList.toggle('preview-mode', previewActive);
  if (previewActive) updatePreview();
}

// ── Autosave ──────────────────────────────────────────────────────────────────
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const t = activeTab();
    if (t && t.serverPath) saveFile(t);
  }, 1500);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCtxMenu();
    openModal.classList.remove('open');
    saveModal.classList.remove('open');
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    const t = activeTab();
    if (!t) return;
    if (t.serverPath) saveFile(t);
    else promptSaveAs();
    return;
  }

  // Alt+O / Alt+I / Alt+D / Alt+S
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.tagName === 'INPUT') return;

  switch (e.key.toLowerCase()) {
    case 'o': e.preventDefault(); openFromServer(); break;
    case 'i': e.preventDefault(); fileInput.click(); break;
    case 'd': e.preventDefault(); downloadFile();   break;
    case 'p': e.preventDefault(); togglePreview();  break;
    case 's': {
      e.preventDefault();
      const t = activeTab();
      if (!t) return;
      if (t.serverPath) saveFile(t);
      else promptSaveAs();
      break;
    }
  }
});

// ── Modal controls ────────────────────────────────────────────────────────────
document.getElementById('cancelOpen').addEventListener('click', () => openModal.classList.remove('open'));
openModal.addEventListener('click', e => { if (e.target === openModal) openModal.classList.remove('open'); });

document.getElementById('cancelSave').addEventListener('click', () => saveModal.classList.remove('open'));
document.getElementById('confirmSave').addEventListener('click', confirmSaveAs);
saveInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmSaveAs(); });
saveModal.addEventListener('click', e => { if (e.target === saveModal) saveModal.classList.remove('open'); });

// ── File import (local upload) ────────────────────────────────────────────────
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  const content    = await file.text();
  const serverPath = file.name.endsWith('.md') ? file.name : file.name + '.md';
  const tab = makeTab(serverPath.replace(/\.md$/, ''), content, serverPath);
  tab.saved = false;
  openTab(tab);
  await saveFile(tab);
});

// ── Editor input ──────────────────────────────────────────────────────────────
editor.addEventListener('input', () => {
  const t = activeTab();
  if (t) t.content = editor.value;
  markUnsaved();
  syncGutter();
  scheduleAutosave();
  updatePreview();
});

// ── New tab / new doc ─────────────────────────────────────────────────────────
function newDoc() { openTab(makeTab()); }
btnNew.addEventListener('click', newDoc);

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ── Init ──────────────────────────────────────────────────────────────────────
newDoc();
