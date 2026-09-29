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
  pairShort: true, // let two neighbouring songs share a page when both fit whole
};

export const CHORD_COLOR = '#1F4E79';

// Geometry shared by this renderer, docx.js and the page planner (pagination.js), so the
// planner's arithmetic cannot drift from what is actually written out.
export const HANG_IN = 0.35; // hanging indent for verse numbers, and the chorus step
export const GROUP_GAP_PT = 10; // space after the last paragraph of a group
export const TITLE_EXTRA_PT = 6; // title size = body size + this
export const TITLE_AFTER_PT = 4;
export const META_LESS_PT = 2; // the hymn-number/key line is this much smaller than the body
export const COMMENT_LESS_PT = 1;
export const monoSizePt = (sizePt) => Math.max(8, sizePt - 1);
// Two songs on one page: space above the second title, then a hairline rule, then a
// little padding under the rule.
export const PAIR_GAP_PT = 20;
export const PAIR_RULE_PAD_PT = 6;
export const PAIR_RULE_COLOR = 'BFBFBF';
export const PAPER_TWIPS = { letter: { w: 12240, h: 15840 }, a4: { w: 11906, h: 16838 } };
const KEEP_LINES = 'page-break-inside:avoid;mso-pagination:widow-orphan lines-together';

// A page plan is `[[0, 1], [2], ...]`: song indexes in order, one or two per page. Turns it
// into per-song flags: `breakBefore` (starts a new page; every page but the first opens
// with one) and `joined` (second song on a page it shares). A missing or stale plan —
// wrong song count, out of order, three to a page — falls back to one song per page, so
// a mismatch can only cost pairing, never lose a page break.
export function songSlots(pages, count) {
  const strict = () => Array.from({ length: count }, (_, i) => ({ breakBefore: i > 0, joined: false }));
  if (!Array.isArray(pages)) return strict();
  const flat = pages.flat();
  const sane =
    pages.every((p) => Array.isArray(p) && (p.length === 1 || p.length === 2)) &&
    flat.length === count &&
    flat.every((v, i) => v === i);
  if (!sane) return strict();
  const slots = new Array(count);
  pages.forEach((page, p) => page.forEach((index, k) => (slots[index] = { breakBefore: p > 0 && k === 0, joined: k > 0 })));
  return slots;
}

export function wordOptions(song, prefs = {}) {
  // An explicit `undefined` must not beat a default (it would silently turn pairing off).
  const o = { ...WORD_DEFAULTS, ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined)) };
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

// `slot` comes from songSlots(): where this song sits in the page plan.
//  - breakBefore: hard page break above the title.
//  - joined: second song on a shared page. Its title gets space and a hairline rule above
//    it, and EVERY paragraph keeps with the next, so the song moves to the next page as
//    one piece if the planner's estimate was optimistic (the worst case is a page that
//    holds one song, never a song split across two).
function songHtml(song, o, slot) {
  const chords = o.mode === 'chords' && song.hasChords;
  const out = [];
  const titleStyle = [
    slot.joined ? `margin:${PAIR_GAP_PT}pt 0in ${TITLE_AFTER_PT}pt 0in` : `margin:0in 0in ${TITLE_AFTER_PT}pt 0in`,
    `font-family:'${o.font}'`,
    `font-size:${o.sizePt + TITLE_EXTRA_PT}pt`,
    'font-weight:bold',
    'color:#000000',
    // Word pastes <h1> as Normal + direct formatting; this keeps the title in the
    // Navigation Pane outline anyway.
    'mso-outline-level:1',
    'page-break-after:avoid',
    ...(slot.joined ? [`border-top:.75pt solid #${PAIR_RULE_COLOR}`, `padding-top:${PAIR_RULE_PAD_PT}pt`] : []),
    ...(slot.breakBefore ? ['page-break-before:always'] : []),
  ].join(';');
  out.push(`<h1 style="${titleStyle}">${escapeHtml(song.title)}</h1>`);

  const meta = o.meta ? metaItems(song, { chords }) : [];
  out.push(
    `<p class="MsoNormal" style="${pStyle({ font: o.font, sizePt: o.sizePt - META_LESS_PT, marginBottomPt: GROUP_GAP_PT, color: '#595959', keepNext: true, keepLines: false })}">${meta.length ? escapeHtml(meta.join(' · ')) : '&nbsp;'}</p>`,
  );

  const numbered = o.numbers && songGutter(song) > 0;
  const gutter = chords ? songGutter(song, { numbers: o.numbers }) : 0;
  const monoSize = monoSizePt(o.sizePt);

  const grouped = song.groups.map((group) => groupBlocks(group, o, { chords, gutter }));
  const lastGroup = grouped.map((b) => b.length > 0).lastIndexOf(true);
  grouped.forEach((blocks, gi) => {
    blocks.forEach(({ part, rows, lines }, idx) => {
      const last = idx === blocks.length - 1;
      const marginBottomPt = last ? GROUP_GAP_PT : 0;
      // A joined song chains every paragraph but its very last.
      const keepNext = slot.joined ? !(last && gi === lastGroup) : !last;
      if (part.type === 'comment') {
        const leftIn = !chords && numbered ? HANG_IN : 0;
        out.push(`<p class="MsoNormal" style="${pStyle({ font: o.font, sizePt: o.sizePt - COMMENT_LESS_PT, marginBottomPt, leftIn, italic: true, color: '#7F7F7F', keepNext, keepLines: false })}">${escapeHtml(part.text)}</p>`);
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
  });
  return out.join('\n');
}

// Returns an HTML document string (fragment wrapped in <html><body>) for the clipboard.
// `prefs.pages` is the page plan from pagination.js; without one, every song gets its own page.
export function renderWordHtml(songs, prefs = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  const slots = songSlots(prefs.pages, list.length);
  const body = list.map((s, i) => songHtml(s, wordOptions(s, prefs), slots[i])).join('\n');
  return `<html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>`;
}

// The panel's preview: the same markup as the copy, but grouped one <section> per page of
// the plan, so a shared page shows both songs together.
export function renderWordPreview(songs, prefs = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  const slots = songSlots(prefs.pages, list.length);
  const sheets = [];
  list.forEach((s, i) => {
    if (!sheets.length || slots[i].breakBefore) sheets.push([]);
    sheets[sheets.length - 1].push(songHtml(s, wordOptions(s, prefs), slots[i]));
  });
  return sheets
    .map((html, n) => `<section class="sbx-sheet" data-sheet="${n + 1}" data-songs="${html.length}">${html.join('\n')}</section>`)
    .join('\n');
}
