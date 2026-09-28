// Page planning for Word output: which songs share a page.
//
// The rule: every song starts on its own page, except that two NEIGHBOURING songs share
// one when both fit on it whole, with room to spare. A song is never split to make that
// work, and songs are never reordered (a set list is in worship order).
//
// The plan is worked out here, from an estimate of each song's height, because a Word
// file can only say "break before this paragraph" — it has no "break if the next song
// does not fit". The estimate is deliberately safe: the second song of a shared page also
// keeps together in the file itself (see html.js / docx.js), so if Word disagrees the
// worst outcome is a page holding one song, never a song cut in two.
//
// Same paragraphs as the renderers: groupBlocks() is shared, and every size, gap and
// indent is imported from html.js, so the arithmetic below cannot drift from the output.

import { metaItems } from './ir.js';
import { displayWidth, songGutter } from './layout.js';
import {
  wordOptions, groupBlocks, PAPER_TWIPS,
  HANG_IN, GROUP_GAP_PT, TITLE_EXTRA_PT, TITLE_AFTER_PT, META_LESS_PT, COMMENT_LESS_PT, monoSizePt,
  PAIR_GAP_PT, PAIR_RULE_PAD_PT,
} from './html.js';

// The plan targets a page with Word's standard 1-inch margins, whatever the .docx uses
// (0.75in): the same plan then also holds when the text is pasted into a blank Word
// document, and the .docx gets a little slack instead of pairs packed to the last line.
export const PLAN_MARGIN_PT = 72;
// Share of the page a pair may fill. Below 1 to absorb the estimate's error.
export const FILL = 0.98;
// Everything a shared page spends besides the two songs: space above the second title,
// its rule (0.75pt, counted as 1) and the padding under the rule. Deliberately generous:
// Word measures 10pt less, because it lays two adjacent paragraphs out with the LARGER of
// the first one's space-after (10pt) and the next one's space-before (20pt), not their sum.
// A layout engine that does add them still fits, at a cost of under one line of text.
export const PAIR_EXTRA_PT = PAIR_GAP_PT + PAIR_RULE_PAD_PT + 1;
// Bold and italic runs are a little wider than the plain text that gets measured.
const WIDTH_FUDGE = 1.02;

// Height of one line of single-spaced text, as a multiple of the font size — what Word
// uses for "single" line spacing (font ascent + descent + line gap). Measured in Word
// 365 on Windows (test/office/verify-pages.ps1 re-checks them); an unlisted font gets the
// tallest known, which errs safe. Aptos measures the same as Calibri.
export const LINE_FACTOR = {
  Calibri: 1.2207,
  Aptos: 1.2207,
  Arial: 1.1499,
  Cambria: 1.1719,
  Georgia: 1.1362,
  Garamond: 1.125,
  'Segoe UI': 1.3301,
  'Times New Roman': 1.1499,
  Verdana: 1.2153,
  Consolas: 1.1699,
  'Courier New': 1.1328,
  'Cascadia Mono': 1.1625,
  'Lucida Console': 1.0,
};
export const DEFAULT_LINE_FACTOR = 1.3301;

// A glyph the font lacks is drawn from a fallback font and the whole line grows to fit
// it. Measured in Word: about 1.34x the text size for symbols (the tie ‿, ♫, emoji, CJK)
// and about 1.8x for Hangul. Latin, Greek, Cyrillic and ordinary punctuation are covered.
const SYMBOL_LINE_FACTOR = 1.34;
const HANGUL_LINE_FACTOR = 1.8;
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const COVERED = /^[\u0000-\u024F\u0370-\u04FF\u2010-\u203A\u20A0-\u20BF\u2122]*$/;
const glyphFactor = (text) => (HANGUL.test(text) ? HANGUL_LINE_FACTOR : COVERED.test(text) ? 0 : SYMBOL_LINE_FACTOR);

const MONO_ADVANCE_EM = { Consolas: 0.5498, 'Courier New': 0.6, 'Cascadia Mono': 0.5859, 'Lucida Console': 0.6 };
const PROPORTIONAL_ADVANCE_EM = 0.56; // wider than Calibri or Arial, about Verdana

// Text width in inches with no font access: the fallback when no measure() is supplied
// (tests, Node). Same contract as the panel's canvasMeasure(text, pt, { font, bold, italic }).
export function approxMeasure(text, pt, { font = 'Calibri', bold = false } = {}) {
  const em = MONO_ADVANCE_EM[font] ?? PROPORTIONAL_ADVANCE_EM * (bold ? 1.05 : 1);
  return (displayWidth(text) * em * pt) / 72;
}

// How many lines `text` takes when wrapped to `widthPt`. Greedy word wrap, like Word: a
// word moves to the next line when it does not fit, and spaces never start a line
// themselves (at a wrap they hang off the end of the line before). Spaces at the start of
// the text do take room on the first line: chord rows begin with a gutter of them.
export function visualLines(text, pt, style, widthPt, measure) {
  if (!text) return 1;
  const width = (s) => measure(s, pt, style) * 72 * WIDTH_FUDGE;
  if (widthPt <= 0 || width(text) <= widthPt) return 1;
  let lines = 1;
  let used = 0; // room taken on the current line
  let placed = false; // a word has been placed on it already
  for (const token of text.match(/\s+|\S+/g)) {
    const w = width(token);
    if (/^\s/.test(token)) {
      if (placed || lines === 1) used += w;
      continue;
    }
    if (placed && used + w > widthPt) {
      lines += 1;
      used = 0;
    }
    used += w;
    placed = true;
    if (used > widthPt) {
      // A single word wider than the line breaks across lines.
      lines += Math.floor(used / widthPt);
      used %= widthPt;
    }
  }
  return lines;
}

// Height in points of `text` set in `font` at `pt`, wrapped to `widthPt - indentIn`.
function textHeight(text, pt, font, widthPt, measure, style = {}, indentIn = 0) {
  const lines = visualLines(text, pt, { font, ...style }, widthPt - indentIn * 72, measure);
  return lines * pt * Math.max(LINE_FACTOR[font] ?? DEFAULT_LINE_FACTOR, glyphFactor(text));
}

// Height in points of one song as the renderers lay it out: title, meta line, then every
// paragraph with its trailing gap.
export function songHeightPt(song, o, widthPt, measure = approxMeasure) {
  const chords = o.mode === 'chords' && song.hasChords;
  const height = (text, pt, font, style, indentIn) => textHeight(text, pt, font, widthPt, measure, style, indentIn);

  let h = height(song.title, o.sizePt + TITLE_EXTRA_PT, o.font, { bold: true }) + TITLE_AFTER_PT;
  const meta = o.meta ? metaItems(song, { chords }).join(' · ') : '';
  h += height(meta, o.sizePt - META_LESS_PT, o.font) + GROUP_GAP_PT;

  const numbered = o.numbers && songGutter(song) > 0;
  const gutter = chords ? songGutter(song, { numbers: o.numbers }) : 0;
  const monoPt = monoSizePt(o.sizePt);

  for (const group of song.groups) {
    const blocks = groupBlocks(group, o, { chords, gutter });
    blocks.forEach(({ part, rows, lines }, idx) => {
      if (idx === blocks.length - 1) h += GROUP_GAP_PT;
      if (part.type === 'comment') {
        h += height(part.text, o.sizePt - COMMENT_LESS_PT, o.font, { italic: true }, !chords && numbered ? HANG_IN : 0);
      } else if (chords) {
        for (const r of rows) h += height(r.text, monoPt, o.mono);
      } else {
        const chorus = part.type === 'chorus';
        const base = numbered ? HANG_IN : 0;
        const left = chorus ? base + HANG_IN : base;
        const style = chorus && o.chorusItalic ? { italic: true } : {};
        for (const l of lines) h += height(l.text.replace(/\s+$/, ''), o.sizePt, o.font, style, left);
      }
    });
  }
  return h;
}

// Decides which songs share a page. `songs` in export order; `prefs` the Word options
// (`pairShort` off means one song per page). `measure` should be the panel's canvas
// measure so line wrapping follows the real font; without it a generous estimate is used.
//
// Returns { pages, heights, content, pairedPages, pageCount }:
//   pages   [[0, 1], [2], ...] — song indexes per page, the input html.js/docx.js take
//   heights each song's estimated height in points
//   content the assumed text area of a page, in points
//   pageCount pages the export will run to (a song longer than a page counts each page)
export function planPages(songs, prefs = {}, { measure = approxMeasure } = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  const base = wordOptions({ hasChords: true }, prefs);
  const paper = PAPER_TWIPS[base.page] || PAPER_TWIPS.letter;
  const content = { widthPt: paper.w / 20 - 2 * PLAN_MARGIN_PT, heightPt: paper.h / 20 - 2 * PLAN_MARGIN_PT };
  const room = content.heightPt * FILL;
  const heights = list.map((song) => songHeightPt(song, wordOptions(song, prefs), content.widthPt, measure));

  const pages = [];
  for (let i = 0; i < list.length; ) {
    const shares = base.pairShort && i + 1 < list.length && heights[i] + PAIR_EXTRA_PT + heights[i + 1] <= room;
    pages.push(shares ? [i, i + 1] : [i]);
    i += shares ? 2 : 1;
  }
  const pageCount = pages.reduce((n, page) => n + Math.max(1, Math.ceil(page.reduce((sum, i) => sum + heights[i], 0) / content.heightPt)), 0);
  return { pages, heights, content, pairedPages: pages.filter((p) => p.length === 2).length, pageCount };
}
