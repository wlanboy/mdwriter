'use strict';

// ── Insert templates ──────────────────────────────────────────────────────────
const TEMPLATES = {
  heading:          { text: '## Überschrift',                                                     cursor: 3 },
  'codeblock-code': { text: '```\n\n```',                                                         cursor: 4 },
  'codeblock-yaml': { text: '```yaml\n\n```',                                                     cursor: 8 },
  'codeblock-text': { text: '```text\n\n```',                                                     cursor: 8 },
  table:            { text: '| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Zelle | Zelle |', cursor: 2 },
  link:             { text: '[Linktext](https://)',                                                cursor: 1 },
  image:            { text: '![Alttext](https://)',                                               cursor: 2 },
};

function insertAtLine(lineIdx, action) {
  const tmpl = TEMPLATES[action];
  if (!tmpl) return;

  const t = activeTab();
  if (!t) return;

  const lines = editor.value.split('\n');

  let insertOffset = 0;
  for (let i = 0; i <= lineIdx; i++) insertOffset += lines[i].length + 1;

  const insertLines = tmpl.text.split('\n');
  lines.splice(lineIdx + 1, 0, ...insertLines);
  const newVal = lines.join('\n');

  editor.value = newVal;
  const cursorPos = insertOffset + tmpl.cursor;
  editor.setSelectionRange(cursorPos, cursorPos);
  editor.focus();

  t.content = newVal;
  t.saved = false;
  renderTabs();
  syncGutter();
  scheduleAutosave();
}
