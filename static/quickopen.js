'use strict';

// ── Quick open (Ctrl+P) ───────────────────────────────────────────────────────
// Searches documents/ and the projects selected in the explorer, whatever its type filter.
const qoModal = document.getElementById('quickModal');
const qoInput = document.getElementById('quickInput');
const qoList  = document.getElementById('quickList');
const QO_MAX  = 50;

let qoItems = [];
let qoSel   = 0;

function openQuickOpen() {
  qoModal.classList.add('open');
  qoInput.value = '';
  qoSel = 0;
  renderQuickOpen();
  qoInput.focus();
  // Roots the explorer has not loaded yet come in while the user types.
  const roots = [null, ...exState.projects];
  Promise.all(roots.map(p => exCache.get(p)?.files ? null : loadRoot(p))).then(() => {
    if (qoModal.classList.contains('open')) renderQuickOpen(true);
  });
}

function closeQuickOpen() {
  if (!qoModal.classList.contains('open')) return;
  qoModal.classList.remove('open');
  editor.focus();
}

function qoCandidates() {
  const out = [];
  for (const project of [null, ...exState.projects]) {
    const files = exCache.get(project)?.files;
    if (!files) continue;
    const prefix = (project ?? 'Dokumente') + '/';
    for (const path of files) {
      out.push({ project, path, label: prefix + path, nameAt: prefix.length + path.lastIndexOf('/') + 1 });
    }
  }
  return out;
}

function qoBoundary(text, i) {
  return i === 0 || '/-_. '.includes(text[i - 1]);
}

// A substring wins; otherwise the letters in order, where runs and word starts score higher.
function qoMatch(q, text, from) {
  const sub = text.indexOf(q, from);
  if (sub >= 0) {
    const hits = Array.from(q, (_, k) => sub + k);
    return { score: 5 * q.length + (qoBoundary(text, sub) ? 4 : 0), hits };
  }
  const hits = [];
  let score = 0;
  let at    = from;
  for (const ch of q) {
    const i = text.indexOf(ch, at);
    if (i < 0) return null;
    if (hits.length && i === hits[hits.length - 1] + 1) score += 3;
    if (qoBoundary(text, i)) score += 2;
    hits.push(i);
    at = i + 1;
  }
  return { score, hits };
}

// A match within the file name beats one spread over the path.
function qoScore(q, item) {
  const text = item.label.toLowerCase();
  const inName = qoMatch(q, text, item.nameAt);
  if (inName) return { score: inName.score + 10, hits: inName.hits };
  return qoMatch(q, text, 0);
}

function renderQuickOpen(keepSel = false) {
  const prev = keepSel ? qoItems[qoSel]?.label : null;
  const q    = qoInput.value.toLowerCase().replace(/\s+/g, '');
  const byLabel = (a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });

  let matches;
  if (!q) {
    matches = qoCandidates().sort(byLabel).map(item => ({ item, hits: [] }));
  } else {
    matches = [];
    for (const item of qoCandidates()) {
      const m = qoScore(q, item);
      if (m) matches.push({ item, ...m });
    }
    matches.sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length ||
      byLabel(a.item, b.item));
  }

  qoItems = matches.slice(0, QO_MAX).map(m => m.item);
  const kept = qoItems.findIndex(item => item.label === prev);
  qoSel = kept >= 0 ? kept : 0;

  qoList.replaceChildren(...matches.slice(0, QO_MAX).map((m, i) => qoRow(m.item, new Set(m.hits), i)));
  if (matches.length > QO_MAX) {
    qoList.append(qoHint('… ' + (matches.length - QO_MAX) + ' weitere – Suche verfeinern'));
  }
  if (!matches.length) {
    const loading = [null, ...exState.projects].some(p => exCache.get(p)?.loading);
    qoList.append(qoHint(loading ? 'Lädt …' : q ? 'Kein Treffer' : 'Keine Dateien'));
  }
  qoList.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function qoRow(item, hits, i) {
  const row = document.createElement('div');
  row.className = 'qo-item' + (i === qoSel ? ' selected' : '');
  row.title = item.label;

  const type = isYamlPath(item.path) ? 'yaml' : 'md';
  const icon = document.createElement('span');
  icon.className = 'ficon ' + type;
  icon.textContent = type === 'yaml' ? 'YML' : 'MD';

  const name = document.createElement('span');
  name.className = 'qo-name';
  qoHighlight(name, item.label, item.nameAt, item.label.length, hits);

  const dir = document.createElement('span');
  dir.className = 'qo-dir';
  qoHighlight(dir, item.label, 0, item.nameAt - 1, hits);

  row.append(icon, name, dir);
  // Keep the focus in the search field.
  row.addEventListener('mousedown', e => e.preventDefault());
  row.addEventListener('click', () => qoOpen(item));
  return row;
}

function qoHighlight(el, text, from, to, hits) {
  for (let i = from; i < to;) {
    const hit = hits.has(i);
    let j = i;
    while (j < to && hits.has(j) === hit) j++;
    if (hit) {
      const mark = document.createElement('mark');
      mark.textContent = text.slice(i, j);
      el.append(mark);
    } else {
      el.append(text.slice(i, j));
    }
    i = j;
  }
}

function qoHint(text) {
  const el = document.createElement('div');
  el.className = 'file-empty';
  el.textContent = text;
  return el;
}

function qoOpen(item) {
  closeQuickOpen();
  openFile(item.project, item.path);
}

function qoMove(delta) {
  if (!qoItems.length) return;
  qoSel = (qoSel + delta + qoItems.length) % qoItems.length;
  qoList.querySelectorAll('.qo-item').forEach((row, i) => row.classList.toggle('selected', i === qoSel));
  qoList.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

qoInput.addEventListener('input', () => renderQuickOpen());
qoInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    qoMove(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (qoItems[qoSel]) qoOpen(qoItems[qoSel]);
  }
});
qoModal.addEventListener('click', e => { if (e.target === qoModal) closeQuickOpen(); });
