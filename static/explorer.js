'use strict';

// ── Project explorer ──────────────────────────────────────────────────────────
const EX_KEY   = 'mdwriter.explorer';
const EX_TYPES = { md: /\.md$/i, yaml: /\.ya?ml$/i };

const exSidebar  = document.getElementById('sidebar');
const exBtn      = document.getElementById('btnExplorer');
const exTreeView = document.getElementById('explorerView');
const exSetView  = document.getElementById('settingsView');
const exTree     = document.getElementById('tree');
const exTypes    = document.querySelectorAll('#typeFilter input');
const exSearch   = document.getElementById('projectSearch');
const exProjList = document.getElementById('projectList');
const exCount    = document.getElementById('projectCount');

const exState    = loadExplorerState();
const exExpanded = new Set(exState.expanded);
// project (null = documents/) → { files, truncated } | { loading } | { error }
const exCache    = new Map();
let exProjects   = [];
let exActive     = null;

function loadExplorerState() {
  const def = { open: false, projects: [], types: ['md', 'yaml'], expanded: [] };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(EX_KEY) || '{}') };
  } catch {
    return def;
  }
}

function saveExplorerState() {
  exState.expanded = [...exExpanded];
  try {
    localStorage.setItem(EX_KEY, JSON.stringify(exState));
  } catch { /* quota exceeded */ }
}

function exKey(project, path) { return JSON.stringify([project, path]); }

// ── Open / close ──────────────────────────────────────────────────────────────
function toggleExplorer() {
  exState.open = !exState.open;
  saveExplorerState();
  applyExplorerOpen();
}

function applyExplorerOpen() {
  exSidebar.classList.toggle('open', exState.open);
  exBtn.classList.toggle('active', exState.open);
  if (exState.open && !exTreeView.hidden) renderTree();
}

exBtn.addEventListener('click', toggleExplorer);
document.getElementById('btnSettings').addEventListener('click', showSettings);
document.getElementById('btnBack').addEventListener('click', showTree);
document.getElementById('btnRefresh').addEventListener('click', () => {
  exCache.clear();
  renderTree();
});

// ── Tree ──────────────────────────────────────────────────────────────────────
// project → pending load, so the tree and the quick open share one request.
const exLoads = new Map();

function loadRoot(project) {
  if (!exLoads.has(project)) {
    exCache.set(project, { loading: true });
    exLoads.set(project, fetchRoot(project).finally(() => {
      exLoads.delete(project);
      renderTree();
    }));
  }
  return exLoads.get(project);
}

async function fetchRoot(project) {
  try {
    const url = project === null ? '/api/files'
      : '/api/projects/' + encodeURIComponent(project) + '/tree';
    const res = await fetch(url);
    if (!res.ok) throw res.status;
    const body = await res.json();
    exCache.set(project, project === null ? { files: body, truncated: false } : body);
  } catch (status) {
    exCache.set(project, { error: status === 404 ? 'Nicht gefunden' : 'Fehler beim Laden' });
  }
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const path of files) {
    if (!exState.types.some(k => EX_TYPES[k].test(path))) continue;
    const parts = path.split('/');
    let node = root;
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(path);
  }
  return root;
}

function renderTree() {
  if (!exState.open) return;
  exTree.replaceChildren();
  if (!exState.types.length) {
    exTree.append(exHint('Kein Dateityp ausgewählt'));
    return;
  }
  for (const p of [null, ...exState.projects]) renderRoot(p);
  if (!exState.projects.length) {
    exTree.append(exHint('Keine Projekte ausgewählt – über das Regler-Symbol oben auswählen.'));
  }
}

function renderRoot(project) {
  const key  = exKey(project, '');
  const open = exExpanded.has(key);
  const row  = exRow(0, project ?? 'Dokumente', 'tree-root');
  exChevron(row, open);
  row.title = project === null ? 'Lokale Dokumente (documents/)' : project;
  row.addEventListener('click', () => exToggle(key));
  exTree.append(row);
  if (!open) return;

  const data = exCache.get(project);
  if (!data) { loadRoot(project); exTree.append(exHint('Lädt …', 1)); return; }
  if (data.loading) { exTree.append(exHint('Lädt …', 1)); return; }
  if (data.error) { exTree.append(exHint(data.error, 1)); return; }

  const tree = buildTree(data.files);
  if (!tree.dirs.size && !tree.files.length) exTree.append(exHint('Keine passenden Dateien', 1));
  renderNode(project, tree, '', 1);
  if (data.truncated) exTree.append(exHint('Liste gekürzt – zu viele Dateien', 1));
}

function renderNode(project, node, prefix, depth) {
  const byName = (a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' });

  for (const name of [...node.dirs.keys()].sort(byName)) {
    const dir  = prefix + name;
    const key  = exKey(project, dir);
    const open = exExpanded.has(key);
    const row  = exRow(depth, name, 'tree-dir');
    exChevron(row, open);
    row.addEventListener('click', () => exToggle(key));
    exTree.append(row);
    if (open) renderNode(project, node.dirs.get(name), dir + '/', depth + 1);
  }

  for (const path of node.files.sort((a, b) => byName(a.split('/').pop(), b.split('/').pop()))) {
    const row = exRow(depth, path.split('/').pop(), 'tree-file');
    const type = isYamlPath(path) ? 'yaml' : 'md';
    const icon = document.createElement('span');
    icon.className = 'ficon ' + type;
    icon.textContent = type === 'yaml' ? 'YML' : 'MD';
    row.prepend(icon);
    row.dataset.ref = exKey(project, path);
    row.title = (project ?? 'documents') + '/' + path;
    row.classList.toggle('active', row.dataset.ref === exActive);
    row.addEventListener('click', () => openFile(project, path));
    exTree.append(row);
  }
}

function exRow(depth, label, cls) {
  const row = document.createElement('div');
  row.className = 'tree-row ' + cls;
  row.style.setProperty('--depth', depth);
  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = label;
  row.append(name);
  return row;
}

function exChevron(row, open) {
  const c = document.createElement('span');
  c.className = 'tree-chevron' + (open ? ' open' : '');
  row.prepend(c);
}

function exHint(text, depth = 0) {
  const el = document.createElement('div');
  el.className = 'tree-hint';
  el.style.setProperty('--depth', depth);
  el.textContent = text;
  return el;
}

function exToggle(key) {
  if (!exExpanded.delete(key)) exExpanded.add(key);
  saveExplorerState();
  renderTree();
}

// Called by renderTabs so the open file stays highlighted.
function syncExplorer(t) {
  exActive = t && t.serverPath ? exKey(t.project || null, t.serverPath) : null;
  exTree.querySelectorAll('.tree-file').forEach(row => {
    row.classList.toggle('active', row.dataset.ref === exActive);
  });
}

// ── Type filter ───────────────────────────────────────────────────────────────
exTypes.forEach(box => {
  box.checked = exState.types.includes(box.value);
  box.addEventListener('change', () => {
    exState.types = [...exTypes].filter(b => b.checked).map(b => b.value);
    saveExplorerState();
    renderTree();
  });
});

// ── Project settings ──────────────────────────────────────────────────────────
async function showSettings() {
  exTreeView.hidden = true;
  exSetView.hidden  = false;
  exSearch.value    = '';
  exProjList.replaceChildren(exHint('Lädt …'));
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw res.status;
    exProjects = await res.json();
  } catch {
    exProjects = [];
    toast('Fehler beim Laden der Projekte');
  }
  renderProjectList();
  exSearch.focus();
}

function showTree() {
  exSetView.hidden  = true;
  exTreeView.hidden = false;
  renderTree();
}

function renderProjectList() {
  const q = exSearch.value.trim().toLowerCase();
  // Selected projects that vanished from disk stay listed so they can be unticked.
  const names = [...new Set([...exProjects, ...exState.projects])]
    .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
    .filter(n => n.toLowerCase().includes(q));

  exProjList.replaceChildren();
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'project-item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = exState.projects.includes(name);
    box.addEventListener('change', () => {
      exState.projects = box.checked
        ? [...exState.projects, name].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
        : exState.projects.filter(p => p !== name);
      saveExplorerState();
      renderProjectCount();
    });
    const span = document.createElement('span');
    span.textContent = name;
    label.append(box, span);
    exProjList.append(label);
  }
  if (!names.length) exProjList.append(exHint(q ? 'Kein Treffer' : 'Keine Projekte gefunden'));
  renderProjectCount();
}

function renderProjectCount() {
  exCount.textContent = exState.projects.length + ' von ' + exProjects.length + ' ausgewählt';
}

exSearch.addEventListener('input', renderProjectList);
exSearch.addEventListener('keydown', e => {
  if (e.key === 'Escape' && exSearch.value) {
    e.stopPropagation();
    exSearch.value = '';
    renderProjectList();
  }
});

applyExplorerOpen();
