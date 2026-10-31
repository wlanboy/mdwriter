'use strict';

// ── Editing keys ──────────────────────────────────────────────────────────────
// All edits go through execCommand so the browser's undo stack stays intact.
const INDENT  = '  ';
const MD_LIST = /^([ \t]*)([-*+]|(\d+)([.)]))( +)(\[[ xX]\] +)?/;

function isYamlMode() {
  return workspace.classList.contains('yaml-mode');
}

// Replaces the selection; the resulting input event runs the usual sync.
function insertText(text) {
  if (!text && editor.selectionStart === editor.selectionEnd) return;
  const ok = text ? document.execCommand('insertText', false, text)
                  : document.execCommand('delete');
  if (!ok) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

function lineStartAt(pos) {
  return editor.value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndAt(pos) {
  const i = editor.value.indexOf('\n', pos);
  return i < 0 ? editor.value.length : i;
}

// Shift+Tab, or Tab over several lines: (un)indent every touched line.
function shiftLines(outdent) {
  const { selectionStart: start, selectionEnd: end } = editor;
  const from = lineStartAt(start);
  // A selection ending at column 0 does not include that line.
  const to   = lineEndAt(end > start && editor.value[end - 1] === '\n' ? end - 1 : end);
  const lines = editor.value.slice(from, to).split('\n');

  const deltas = lines.map(l => {
    if (!outdent) return INDENT.length;
    return -(l.match(/^(\t| {1,2})/)?.[0].length ?? 0);
  });
  if (deltas.every(d => d === 0)) return;
  const block = lines.map((l, i) => deltas[i] > 0 ? INDENT + l : l.slice(-deltas[i])).join('\n');

  editor.setSelectionRange(from, to);
  insertText(block);
  const total = deltas.reduce((a, b) => a + b, 0);
  editor.setSelectionRange(Math.max(from, start + deltas[0]), Math.max(from, end + total));
}

function onTab(e) {
  e.preventDefault();
  const { selectionStart: start, selectionEnd: end } = editor;
  if (e.shiftKey || start !== end) {
    shiftLines(e.shiftKey);
    return;
  }
  // Pad to the next indent stop.
  const col = start - lineStartAt(start);
  insertText(' '.repeat(INDENT.length - col % INDENT.length));
}

// Prefix for the line after `before` (the current line up to the caret).
function continuation(before) {
  const indent = before.match(/^[ \t]*/)[0];

  if (isYamlMode()) {
    const rest = before.slice(indent.length);
    const m = rest.match(YAML_KEY);
    if (m) {
      // The next key of the same mapping lines up behind the dashes.
      const col   = ' '.repeat(indent.length + m[1].length);
      const value = splitComment(m[4])[0].trim();
      return !value || YAML_BLOCK.test(value) ? col + INDENT : col;
    }
    const d = rest.match(/^(?:- +)+/);
    return d ? indent + d[0] : indent;
  }

  const m = before.match(MD_LIST);
  if (!m) return indent;
  const [, , bullet, num, delim, space, task] = m;
  return indent + (num ? (parseInt(num, 10) + 1) + delim : bullet) + space + (task ? '[ ] ' : '');
}

function onEnter(e) {
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  e.preventDefault();
  const pos    = editor.selectionStart;
  const from   = lineStartAt(pos);
  const before = editor.value.slice(from, pos);

  // Enter on an empty list item ends the list instead of adding another one.
  const empty = isYamlMode() ? /^[ \t]*(- +)+$/ : new RegExp(MD_LIST.source + '$');
  if (empty.test(before) && editor.selectionEnd === lineEndAt(pos) && pos === editor.selectionEnd) {
    editor.setSelectionRange(from, pos);
    insertText('');
    return;
  }

  insertText('\n' + continuation(before));
}

function handleEditorKey(e) {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) onTab(e);
  else if (e.key === 'Enter') onEnter(e);
}
