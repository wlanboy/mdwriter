'use strict';

// ── YAML highlighting ─────────────────────────────────────────────────────────
// Line-based, no parser: good enough for config files and slides, never throws.
const YAML_KEY    = /^((?:-[ \t]+)*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|<<|[^\s#'"{[\-?][^#]*?|-[^\s#][^#]*?)([ \t]*:)(?=\s|$)(.*)$/;
const YAML_DASHES = /^((?:-[ \t]+|-$)+)(.*)$/;
const YAML_BOOL   = /^(true|false|yes|no|on|off|null|~)$/i;
const YAML_NUM    = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.nan)$/i;
const YAML_BLOCK  = /^[|>][-+0-9]*$/;

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ySpan(cls, text) {
  return text ? '<span class="' + cls + '">' + escHtml(text) + '</span>' : '';
}

// Splits "value  # comment" outside of quotes.
function splitComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return [s.slice(0, i), s.slice(i)];
  }
  return [s, ''];
}

// Returns [html, startsBlockScalar].
function yValue(raw) {
  const [body, comment] = splitComment(raw);
  const lead  = body.match(/^\s*/)[0];
  let   v     = body.slice(lead.length);
  const trail = v.match(/\s*$/)[0];
  v = v.slice(0, v.length - trail.length);

  let html = escHtml(lead);
  // Anchors, aliases and tags prefix the actual value.
  let m;
  while ((m = v.match(/^([&*!][^\s]*)(\s*)/)) && m[1]) {
    html += ySpan(m[1][0] === '!' ? 'y-tag' : 'y-anchor', m[1]) + m[2];
    v = v.slice(m[0].length);
  }

  let block = false;
  if (!v) { /* nothing */ }
  else if (YAML_BLOCK.test(v))       { html += ySpan('y-block', v); block = true; }
  else if (/^["']/.test(v))          html += ySpan('y-str', v);
  else if (YAML_BOOL.test(v))        html += ySpan('y-bool', v);
  else if (YAML_NUM.test(v))         html += ySpan('y-num', v);
  else if (/^[[{]/.test(v))          html += yFlow(v);
  else                               html += ySpan('y-str', v);

  return [html + escHtml(trail) + ySpan('y-com', comment), block];
}

// Inline {a: 1, b: [x, y]}: keys and brackets only, values stay plain.
function yFlow(v) {
  return escHtml(v)
    .replace(/([{,]\s*)([^\s{}[\],:][^{}[\],:]*?)(\s*:)(?=\s)/g, '$1<span class="y-key">$2</span>$3')
    .replace(/[[\]{},]/g, c => '<span class="y-punct">' + c + '</span>');
}

function yIndent(s) {
  return s ? '<span class="y-ind">' + s + '</span>' : '';
}

function highlightYaml(src) {
  const out = [];
  // Column a block scalar's content must exceed; -1 outside block scalars.
  let blockCol = -1;

  for (const line of src.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')) {
    const indent = line.match(/^[ \t]*/)[0];
    const rest   = line.slice(indent.length);

    if (blockCol >= 0) {
      if (!rest || indent.length > blockCol) {
        out.push(yIndent(indent) + ySpan('y-str', rest));
        continue;
      }
      blockCol = -1;
    }

    let html = yIndent(indent);
    if (!rest) {
      // empty line
    } else if (rest[0] === '#') {
      html += ySpan('y-com', rest);
    } else if (/^(---|\.\.\.)(\s|$)/.test(rest)) {
      const [, mark, tail] = rest.match(/^(---|\.\.\.)(.*)$/);
      html += ySpan('y-doc', mark) + yValue(tail)[0];
    } else {
      let m = rest.match(YAML_KEY);
      let block;
      if (m) {
        const [, dashes, key, colon, val] = m;
        let vHtml;
        [vHtml, block] = yValue(val);
        html += ySpan('y-dash', dashes) + ySpan('y-key', key) + ySpan('y-punct', colon) + vHtml;
        if (block) blockCol = indent.length + dashes.length;
      } else {
        m = rest.match(YAML_DASHES);
        const dashes = m ? m[1] : '';
        let vHtml;
        [vHtml, block] = yValue(m ? m[2] : rest);
        html += ySpan('y-dash', dashes) + vHtml;
        if (block) blockCol = indent.length + dashes.length - 1;
      }
    }
    out.push(html);
  }

  return out.map(l => '<span class="y-line">' + l + '</span>').join('');
}

function isYamlPath(path) {
  return /\.ya?ml$/i.test(path || '');
}
