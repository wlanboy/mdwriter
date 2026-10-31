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

  if (!activeTab()) return;

  const lines = editor.value.split('\n');
  let lineEnd = -1;
  for (let i = 0; i <= lineIdx; i++) lineEnd += lines[i].length + 1;

  // insertText keeps Ctrl+Z working; its input event saves and redraws.
  editor.focus();
  editor.setSelectionRange(lineEnd, lineEnd);
  insertText('\n' + tmpl.text);
  const cursorPos = lineEnd + 1 + tmpl.cursor;
  editor.setSelectionRange(cursorPos, cursorPos);
}
