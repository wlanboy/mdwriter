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
const editorHl   = document.getElementById('editorHl');
const measureEl  = document.getElementById('editorMeasure');

// ── State ─────────────────────────────────────────────────────────────────────
let tabs          = [];
let activeId      = 0;
let nextId        = 1;
let ctxLine       = -1;
let toastTmr      = null;
let previewActive = false;
let presenting    = false;

// ── Local store ───────────────────────────────────────────────────────────────
const STORE_KEY = 'mdwriter';

function saveState() {
  const cur = tab_(activeId);
  if (cur) cur.content = editor.value;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ tabs, activeId, nextId }));
  } catch { /* quota exceeded */ }
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tabs) || !s.tabs.length) return false;
    tabs   = s.tabs;
    nextId = s.nextId ?? (Math.max(...tabs.map(t => t.id)) + 1);
    const target = tabs.find(t => t.id === s.activeId) ? s.activeId : tabs[0].id;
    activateTab(target);
    return true;
  } catch {
    return false;
  }
}

// ── Tab helpers ───────────────────────────────────────────────────────────────
function makeTab(name = 'Unbenannt', content = '', serverPath = null) {
  return { id: nextId++, name, content, serverPath, project: null, etag: null, conflict: false, saved: false };
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
    const yaml = isYamlPath(t.serverPath);
    workspace.classList.toggle('yaml-mode', yaml);
    // Markdown is prose and wraps; YAML keeps its columns.
    editor.wrap = yaml ? 'off' : 'soft';
    syncHighlight();
    syncGutter();
    updatePreview();
    editor.focus();
  }
  renderTabs();
}

// An empty, never-saved tab has nothing to lose.
function hasUnsavedChanges(t) {
  return !t.saved && (t.serverPath || t.content !== '');
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = tabs[i];
  if (t.id === activeId) t.content = editor.value;
  if (hasUnsavedChanges(t) &&
      !confirm('„' + t.name + '" hat ungespeicherte Änderungen. Trotzdem schließen?')) return;
  cancelAutosave(id);
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

function renderTabs() {
  tabsEl.querySelectorAll('.tab').forEach(el => el.remove());
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.id === activeId ? ' active' : '') + (!t.saved ? ' unsaved' : '');
    if (t.project) btn.title = t.project + '/' + t.serverPath;

    const dot = document.createElement('span');
    dot.className = 'tab-dot';

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = t.name;
    name.addEventListener('click', e => {
      // Project files keep their repo name; only documents/ files can be renamed here.
      if (t.id !== activeId || t.project) return;
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
  syncExplorer(activeTab());
  saveState();
}

function startRename(t, nameSpan) {
  const inp = document.createElement('input');
  inp.className = 'tab-rename';
  inp.value = t.name;

  async function commit() {
    const v = inp.value.trim().replace(/\.md$/, '');
    if (v && v !== t.name) {
      // A tab bound to a server file keeps name and file in step.
      if (!t.serverPath || await renameFile(t, v + '.md')) t.name = v;
    }
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

  syncLineHeights();
  gutter.scrollTop = editor.scrollTop;
}

// Wrapped lines span several rows: a hidden copy of the text at the textarea's
// width tells how tall each line is, and the gutter row grows to match.
function syncLineHeights() {
  const rows = gutter.children;
  if (editor.wrap === 'off') {
    if (measureEl.childElementCount) {
      measureEl.replaceChildren();
      for (const row of rows) row.style.marginBottom = '';
    }
    return;
  }

  const lines = editor.value.split('\n');
  const cs    = getComputedStyle(editor);
  measureEl.style.width = (editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';

  while (measureEl.childElementCount < lines.length) measureEl.appendChild(document.createElement('div'));
  while (measureEl.childElementCount > lines.length) measureEl.lastChild.remove();
  lines.forEach((l, i) => {
    const el = measureEl.children[i];
    if (el.textContent !== l) el.textContent = l;
  });

  // Read all heights before writing any, so layout runs once.
  const lineH   = parseFloat(cs.lineHeight);
  const heights = Array.from(measureEl.children, el => el.offsetHeight);
  heights.forEach((h, i) => {
    const extra = Math.max(0, h - lineH);
    if (rows[i]) rows[i].style.marginBottom = extra ? extra + 'px' : '';
  });
}

new ResizeObserver(() => {
  syncLineHeights();
  gutter.scrollTop = editor.scrollTop;
}).observe(editor);

editor.addEventListener('scroll', () => {
  gutter.scrollTop     = editor.scrollTop;
  editorHl.scrollTop   = editor.scrollTop;
  editorHl.scrollLeft  = editor.scrollLeft;
  syncPreviewScroll();
});

// ── Editor highlighting ───────────────────────────────────────────────────────
// YAML tabs draw a highlighted copy of the text behind the transparent textarea.
function syncHighlight() {
  const yaml = workspace.classList.contains('yaml-mode');
  editorHl.firstChild.innerHTML = yaml ? DOMPurify.sanitize(highlightYaml(editor.value)) : '';
  editorHl.scrollTop  = editor.scrollTop;
  editorHl.scrollLeft = editor.scrollLeft;
}

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
  if (!previewActive && !presenting) return;
  const t    = activeTab();
  const text = t ? (t.id === activeId ? editor.value : t.content) : '';
  if (t && isYamlPath(t.serverPath)) {
    // The editor already highlights YAML; only the presentation needs a rendering.
    if (!presenting) return;
    previewEl.innerHTML = DOMPurify.sanitize(
      '<pre class="yaml-file"><code>' + highlightYaml(text) + '</code></pre>');
    return;
  }
  previewEl.innerHTML = DOMPurify.sanitize(marked.parse(text));
  previewEl.querySelectorAll('pre code.language-yaml, pre code.language-yml').forEach(code => {
    code.innerHTML = DOMPurify.sanitize(highlightYaml(code.textContent));
  });
  syncPreviewScroll();
}

// Proportional: the preview shows the same fraction of the document as the editor.
function syncPreviewScroll() {
  if (!previewActive || presenting) return;
  const range = editor.scrollHeight - editor.clientHeight;
  const ratio = range > 0 ? editor.scrollTop / range : 0;
  previewEl.scrollTop = ratio * (previewEl.scrollHeight - previewEl.clientHeight);
}

function togglePreview() {
  previewActive = !previewActive;
  workspace.classList.toggle('preview-mode', previewActive);
  if (previewActive) updatePreview();
}

// ── Presentation ──────────────────────────────────────────────────────────────
function togglePresentation() {
  presenting = !presenting;
  document.body.classList.toggle('presenting', presenting);
  if (presenting) {
    updatePreview();
    previewEl.focus();
    document.documentElement.requestFullscreen?.().catch(() => { /* not allowed: stay windowed */ });
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// Esc in fullscreen is swallowed by the browser; leaving fullscreen ends the presentation.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && presenting) togglePresentation();
});

document.getElementById('btnPresent').addEventListener('click', togglePresentation);

// ── Autosave ──────────────────────────────────────────────────────────────────
// One timer per tab, so switching tabs neither redirects nor cancels a pending save.
const saveTimers = new Map();

function scheduleAutosave(t) {
  cancelAutosave(t.id);
  saveTimers.set(t.id, setTimeout(() => {
    saveTimers.delete(t.id);
    // After a declined overwrite only an explicit save may ask again.
    if (t.serverPath && !t.conflict) saveFile(t);
  }, 1500));
}

function cancelAutosave(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (presenting) togglePresentation();
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
  if (e.target.matches('input:not([type=checkbox])')) return;

  switch (e.key.toLowerCase()) {
    case 'o': e.preventDefault(); openFromServer(); break;
    case 'i': e.preventDefault(); fileInput.click(); break;
    case 'd': e.preventDefault(); downloadFile();   break;
    case 'p': e.preventDefault(); togglePreview();  break;
    case 'c': e.preventDefault(); closeTab(activeId); break;
    case 'e': e.preventDefault(); toggleExplorer();   break;
    case 'f': e.preventDefault(); togglePresentation(); break;
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
  if (!(await saveFile(tab)) && tab.conflict) {
    // Overwrite declined: keep the import as an unsaved local tab.
    tab.serverPath = null;
    tab.conflict   = false;
    renderTabs();
  }
});

// ── Editor input ──────────────────────────────────────────────────────────────
editor.addEventListener('keydown', handleEditorKey);

editor.addEventListener('input', () => {
  const t = activeTab();
  if (t) t.content = editor.value;
  if (t && !t.saved) saveState();
  markUnsaved();
  syncHighlight();
  syncGutter();
  if (t) scheduleAutosave(t);
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
if (!restoreState()) newDoc();
