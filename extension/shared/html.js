// HTML for "Copy for Word" (and the panel's Word preview).
//
// Word's HTML import honours inline styles on <p>/<h1> in pt/in units, <br> as a line
// break, &nbsp;, mso-tab-count tabs, page-break-before and "keep" hints. It ignores
// white-space:pre (outside <pre>), ::before/::after content (why the site's own copy loses
// chords), positioning, flex/grid, CSS variables and class rules. So everything here is
// inline, every paragraph sets explicit margins (else Word adds ~14pt "Normal (Web)"
// spacing), and each stanza/chorus is ONE paragraph with <br> soft breaks + keep-together.

import { escapeHtml, nbspRuns } from './escape.js';
import { metaItems } from './ir.js';
import { partRows, songGutter } from './layout.js';

export const WORD_DEFAULTS = {
  mode: 'chords', // 'chords' | 'lyrics'
  font: 'Calibri',
  sizePt: 12,
  mono: 'Consolas',
  chordColor: true,
  chorusItalic: false,
  numbers: true,
  meta: true,
  comments: true,
  page: 'letter',
};

export const CHORD_COLOR = '#1F4E79';
const HANG_IN = 0.35; // hanging indent for verse numbers, and the chorus step
const GROUP_GAP_PT = 10;
const KEEP_LINES = 'page-break-inside:avoid;mso-pagination:widow-orphan lines-together';

export function wordOptions(song, prefs = {}) {
  const o = { ...WORD_DEFAULTS, ...prefs };
  if (o.mode === 'chords' && !song.hasChords) o.mode = 'lyrics';
  return o;
}

// Bold/italic runs of one line as HTML.
export function lineHtml(line) {
  const text = line.text.replace(/\s+$/, '');
  if (!line.marks.length) return escapeHtml(text);
  const cuts = new Set([0, text.length]);
  for (const m of line.marks) {
    cuts.add(Math.min(m.from, text.length));
    cuts.add(Math.min(m.to, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = '';
  for (let k = 0; k < points.length - 1; k++) {
    const [from, to] = [points[k], points[k + 1]];
    if (to <= from) continue;
    const b = line.marks.some((m) => m.b && m.from <= from && m.to >= to);
    const i = line.marks.some((m) => m.i && m.from <= from && m.to >= to);
    let seg = escapeHtml(text.slice(from, to));
    if (i) seg = `<i>${seg}</i>`;
    if (b) seg = `<b>${seg}</b>`;
    out += seg;
  }
  return out;
}

const hasWords = (line) => line.text.trim().length > 0;

// The paragraphs one blank-line group turns into. Shared with docx.js so both skip the
// same things: capo comments (they live in the meta line), disabled comments, and in
// lyrics layout any line without words (a chord-only intro line would otherwise leave
// the verse number alone on an empty line).
export function groupBlocks(group, o, { chords, gutter }) {
  const blocks = [];
  for (const part of group.parts) {
    if (part.type === 'comment') {
      if (o.comments && part.capo === undefined) blocks.push({ part });
    } else if (chords) {
      const rows = partRows(part, { chords: true, numbers: o.numbers, gutter, chorusIndent: 4, tie: '_' });
      if (rows.length) blocks.push({ part, rows });
    } else {
      const lines = part.lines.filter(hasWords);
      if (lines.length) blocks.push({ part, lines });
    }
  }
  return blocks;
}

function pStyle({ font, sizePt, marginBottomPt, leftIn = 0, indentIn = 0, italic = false, color = null, keepNext = false, keepLines = true }) {
  const parts = [
    `margin:0in 0in ${marginBottomPt}pt ${leftIn}in`,
    `text-indent:${indentIn}in`,
    `font-family:'${font}'`,
    `font-size:${sizePt}pt`,
    'line-height:normal',
  ];
  if (italic) parts.push('font-style:italic');
  if (color) parts.push(`color:${color}`);
  if (keepLines) parts.push(KEEP_LINES);
  if (keepNext) parts.push('page-break-after:avoid');
  return parts.join(';');
}

function songHtml(song, o, first) {
  const chords = o.mode === 'chords' && song.hasChords;
  const out = [];
  const titleStyle = [
    'margin:0in 0in 4pt 0in',
    `font-family:'${o.font}'`,
    `font-size:${o.sizePt + 6}pt`,
    'font-weight:bold',
    'color:#000000',
    // Word pastes <h1> as Normal + direct formatting; this keeps the title in the
    // Navigation Pane outline anyway.
    'mso-outline-level:1',
    'page-break-after:avoid',
    ...(first ? [] : ['page-break-before:always']),
  ].join(';');
  out.push(`<h1 style="${titleStyle}">${escapeHtml(song.title)}</h1>`);

  const meta = o.meta ? metaItems(song, { chords }) : [];
  out.push(
    `<p class="MsoNormal" style="${pStyle({ font: o.font, sizePt: o.sizePt - 2, marginBottomPt: GROUP_GAP_PT, color: '#595959', keepNext: true, keepLines: false })}">${meta.length ? escapeHtml(meta.join(' · ')) : '&nbsp;'}</p>`,
  );

  const numbered = o.numbers && songGutter(song) > 0;
  const gutter = chords ? songGutter(song, { numbers: o.numbers }) : 0;
  const monoSize = Math.max(8, o.sizePt - 1);

  for (const group of song.groups) {
    const blocks = groupBlocks(group, o, { chords, gutter });
    blocks.forEach(({ part, rows, lines }, idx) => {
      const last = idx === blocks.length - 1;
      const marginBottomPt = last ? GROUP_GAP_PT : 0;
      const keepNext = !last;
      if (part.type === 'comment') {
        const leftIn = !chords && numbered ? HANG_IN : 0;
        out.push(`<p class="MsoNormal" style="${pStyle({ font: o.font, sizePt: o.sizePt - 1, marginBottomPt, leftIn, italic: true, color: '#7F7F7F', keepNext, keepLines: false })}">${escapeHtml(part.text)}</p>`);
        return;
      }
      if (chords) {
        const body = rows
          .map((r) => {
            const text = nbspRuns(escapeHtml(r.text));
            if (r.kind !== 'chord') return text;
            return `<span style="font-weight:bold${o.chordColor ? `;color:${CHORD_COLOR}` : ''}">${text}</span>`;
          })
          .join('<br>');
        out.push(`<p class="MsoNormal" style="${pStyle({ font: o.mono, sizePt: monoSize, marginBottomPt, keepNext })}">${body}</p>`);
        return;
      }
      const chorus = part.type === 'chorus';
      const base = numbered ? HANG_IN : 0;
      const leftIn = chorus ? base + HANG_IN : base;
      const hasNum = numbered && !chorus && part.number;
      const lead = hasNum
        ? `<span class="sbx-num">${escapeHtml(part.number)}</span><span class="sbx-tab" style="mso-tab-count:1">&nbsp;</span>`
        : '';
      const body = lines.map(lineHtml).join('<br>');
      const italic = chorus && o.chorusItalic;
      out.push(
        `<p class="MsoNormal" style="${pStyle({ font: o.font, sizePt: o.sizePt, marginBottomPt, leftIn, indentIn: hasNum ? -HANG_IN : 0, italic, keepNext })}">${lead}${body}</p>`,
      );
    });
  }
  return out.join('\n');
}

// Returns an HTML document string (fragment wrapped in <html><body>) for the clipboard.
export function renderWordHtml(songs, prefs = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  const body = list.map((s, i) => songHtml(s, wordOptions(s, prefs), i === 0)).join('\n');
  return `<html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>`;
}

// Inner body only, for rendering the preview inside the panel.
export function renderWordPreview(songs, prefs = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  return list.map((s, i) => songHtml(s, wordOptions(s, prefs), i === 0)).join('\n');
}
