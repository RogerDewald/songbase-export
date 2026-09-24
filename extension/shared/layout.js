// The one chord-over-lyric layout engine. Plain text, Word-HTML chord mode and .docx
// chord mode all use it, so they align identically in a monospace font.

import { hasNumbers, maxNumberLength } from './ir.js';

const TIE = '‿';
const WORD_CHAR = /[\p{L}\p{N}'’]/u;
const isWordChar = (ch) => ch !== undefined && ch !== '' && WORD_CHAR.test(ch);

// Columns a character occupies in a monospace font: combining marks and format
// characters take none, East Asian wide/fullwidth characters (CJK, Hangul, kana,
// fullwidth forms) take two. Chord offsets are UTF-16 indices; alignment is by column.
const ZERO_WIDTH = /[\p{M}\p{Cf}]/u;
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

export function charWidth(ch) {
  return ZERO_WIDTH.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1;
}

export function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

// cols[i] = display width of text.slice(0, i) for every UTF-16 index i; an index inside
// a surrogate pair maps to the column where that character starts.
function columnMap(text) {
  const cols = new Array(text.length + 1);
  cols[0] = 0;
  let col = 0;
  let i = 0;
  for (const ch of text) {
    for (let k = 1; k < ch.length; k++) cols[i + k] = col;
    col += charWidth(ch);
    i += ch.length;
    cols[i] = col;
  }
  return cols;
}

function charBefore(text, at) {
  if (at <= 0) return undefined;
  const low = text.charCodeAt(at - 1);
  return low >= 0xdc00 && low <= 0xdfff && at >= 2 ? text.slice(at - 2, at) : text[at - 1];
}

// Lay out one line as a chord row over a lyric row.
// - Each chord sits at the display column of its syllable.
// - A chord that would come within `minGap` of the previous chord name pushes the rest
//   of the lyric right: '-' inside a word, ' ' otherwise, so later chords stay aligned.
// - Chords past the end of the text just extend the chord row.
// Returns { chord, lyric }; either may be null (chord-only line / no chords).
export function alignLine(line, { minGap = 1, tie = '_' } = {}) {
  const text = line.text.split(TIE).join(tie).replace(/\s+$/, '');
  const chords = line.chords.filter((c) => c.name && c.name.trim());
  if (!chords.length) return { chord: null, lyric: text.length ? text : null };

  const cols = columnMap(text);
  const endCol = cols[text.length];
  const colAt = (at) => (at <= text.length ? cols[at] : endCol + (at - text.length));
  const inserts = new Map(); // UTF-16 index -> padding placed before that character
  let row = '';
  let rowWidth = 0;
  let shift = 0; // columns of padding inserted so far (all at or before this chord)
  for (const c of chords) {
    let col = colAt(c.at) + shift;
    const need = rowWidth ? rowWidth + minGap : 0;
    if (col < need) {
      const pad = need - col;
      if (c.at < text.length) {
        const after = String.fromCodePoint(text.codePointAt(c.at));
        const fill = isWordChar(charBefore(text, c.at)) && isWordChar(after) ? '-' : ' ';
        inserts.set(c.at, (inserts.get(c.at) || '') + fill.repeat(pad));
        shift += pad;
      }
      col = need;
    }
    row += ' '.repeat(col - rowWidth) + c.name;
    rowWidth = col + displayWidth(c.name);
  }
  let out = '';
  let last = 0;
  for (const at of [...inserts.keys()].sort((a, b) => a - b)) {
    out += text.slice(last, at) + inserts.get(at);
    last = at;
  }
  out = (out + text.slice(last)).replace(/\s+$/, '');
  return { chord: row, lyric: out.trim().length ? out : null };
}

export function songGutter(song, { numbers = true } = {}) {
  return numbers && hasNumbers(song) ? maxNumberLength(song) + 2 : 0;
}

// Monospace rows for one stanza/chorus part.
// opts: { chords, numbers, gutter, chorusIndent, tie }
// Rows: [{ kind: 'chord'|'lyric', text, number? }]. The verse number goes on the first
// LYRIC row (not the chord row above it), inside the fixed-width gutter.
export function partRows(part, { chords = true, numbers = true, gutter = 0, chorusIndent = 4, tie = '_' } = {}) {
  const indent = part.type === 'chorus' ? ' '.repeat(chorusIndent) : '';
  const blankGutter = ' '.repeat(gutter);
  let pendingNumber = numbers && part.number && gutter ? part.number : null;
  const rows = [];
  for (const line of part.lines) {
    const laid = chords ? alignLine(line, { tie }) : { chord: null, lyric: plainLyric(line, tie) };
    if (laid.chord !== null) rows.push({ kind: 'chord', text: (blankGutter + indent + laid.chord).replace(/\s+$/, '') });
    if (laid.lyric !== null) {
      const lead = pendingNumber !== null ? pendingNumber.padEnd(gutter, ' ') : blankGutter;
      rows.push({ kind: 'lyric', text: lead + indent + laid.lyric, ...(pendingNumber !== null ? { number: pendingNumber } : {}) });
      pendingNumber = null;
    }
  }
  return rows;
}

function plainLyric(line, tie) {
  const text = line.text.split(TIE).join(tie).replace(/\s+$/, '');
  return text.trim().length ? text : null;
}

// Proportional-font text of a line (no alignment concerns): keeps the tie glyph.
export function lyricText(line) {
  return line.text.replace(/\s+$/, '');
}

// Inline-chord ("ChordPro") form of a line: "[G]Words [D]here".
export function inlineChordLine(line) {
  let text = line.text.replace(/\s+$/, '');
  const chords = line.chords.filter((c) => c.name && c.name.trim());
  const maxAt = chords.reduce((m, c) => Math.max(m, c.at), 0);
  if (maxAt > text.length) text = text.padEnd(maxAt, ' ');
  let out = '';
  let pos = 0;
  for (const c of chords) {
    out += text.slice(pos, c.at) + `[${c.name}]`;
    pos = c.at;
  }
  return out + text.slice(pos);
}
