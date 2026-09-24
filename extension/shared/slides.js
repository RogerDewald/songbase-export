// Slide planning for the PowerPoint export — pure, so it is testable without PowerPoint.
//
// One slide per blank-line group (a verse, a chorus, or a verse with its indented refrain),
// long groups split, an optional chorus repeat after every verse, and a font size WE
// compute: PptxGenJS `fit:'shrink'` only writes an autofit flag that PowerPoint applies
// after the text is edited, so a deck must already fit when it is opened.

import { groupKind, lyricParts } from './ir.js';
import { inlineChordLine, lyricText } from './layout.js';

export const DECK_DEFAULTS = {
  bg: '000000',
  fg: 'FFFFFF',
  font: 'Arial',
  maxPt: 44,
  minPt: 28,
  maxLines: 8,
  titleSlides: true,
  blankBetweenSongs: false,
  repeatChorus: true,
  chorusItalic: false,
  notes: true,
  lineSpacing: 1.0,
};

// LAYOUT_WIDE is 13.333 x 7.5 in (PowerPoint's default 16:9).
export const SLIDE = { w: 13.333, h: 7.5 };
export const TEXT_BOX = { x: 0.6, y: 0.45, w: 12.133, h: 6.6 };
export const TITLE_PT = 54;
export const SUBTITLE_PT = 28;
// PowerPoint's single line spacing is ~1.2 x the font size for Arial-like fonts.
export const LINE_HEIGHT = 1.2;

const PUNCT_END = /[.,;:!?’"')\]]\s*$/;

// Approximate advance widths (in em) for when no canvas is available (Node tests).
export function heuristicMeasure(text, pt, { bold = false } = {}) {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.278;
    else if ('ijlIft.,;:!|\'’`'.includes(ch)) em += 0.278;
    else if ('mwMW'.includes(ch)) em += 0.833;
    else if (/[A-Z]/.test(ch)) em += 0.667;
    else if (/[0-9]/.test(ch)) em += 0.556;
    else em += 0.52;
  }
  return (em * (bold ? 1.06 : 1) * pt) / 72;
}

export function repeatChorus(groups) {
  const kinds = groups.map(groupKind);
  const choruses = kinds.flatMap((k, i) => (k === 'chorus' ? [i] : []));
  if (choruses.length !== 1) return groups;
  if (kinds.filter((k) => k === 'verse').length < 2) return groups;
  // A verse that already carries an indented refrain is sung as written.
  if (groups.some((g, i) => kinds[i] === 'verse' && g.parts.some((p) => p.type === 'chorus'))) return groups;
  const chorus = groups[choruses[0]];
  const out = [];
  groups.forEach((g, i) => {
    out.push(g);
    if (kinds[i] === 'verse' && groups[i + 1] !== chorus) out.push(chorus);
  });
  return out;
}

const hasWords = (line) => lyricText(line).trim().length > 0;

// Split one group into slide-sized chunks of { part, line } entries.
export function splitGroup(group, maxLines) {
  const parts = lyricParts(group);
  const entriesOf = (p) => p.lines.filter(hasWords).map((line) => ({ part: p, line }));
  const entries = parts.flatMap(entriesOf);
  if (entries.length <= maxLines) return entries.length ? [entries] : [];
  if (parts.length > 1 && parts.every((p) => entriesOf(p).length <= maxLines)) {
    return parts.map(entriesOf).filter((e) => e.length);
  }
  const n = entries.length;
  const k = Math.ceil(n / maxLines);
  const cuts = [];
  for (let j = 1; j < k; j++) cuts.push(Math.round((j * n) / k));
  // Nudge each cut by one line onto the end of a phrase, if sizes stay legal.
  for (let j = 0; j < cuts.length; j++) {
    const ends = (c) => PUNCT_END.test(lyricText(entries[c - 1].line));
    if (ends(cuts[j])) continue;
    const prev = j ? cuts[j - 1] : 0;
    const next = j + 1 < cuts.length ? cuts[j + 1] : n;
    for (const c of [cuts[j] - 1, cuts[j] + 1]) {
      if (c - prev >= 1 && next - c >= 1 && c - prev <= maxLines && next - c <= maxLines && ends(c)) {
        cuts[j] = c;
        break;
      }
    }
  }
  const chunks = [];
  let start = 0;
  for (const c of [...cuts, n]) {
    chunks.push(entries.slice(start, c));
    start = c;
  }
  return chunks;
}

function runsOf(line) {
  const text = lyricText(line);
  if (!line.marks.length) return [{ text }];
  const cuts = new Set([0, text.length]);
  for (const m of line.marks) {
    cuts.add(Math.min(m.from, text.length));
    cuts.add(Math.min(m.to, text.length));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const runs = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [from, to] = [pts[k], pts[k + 1]];
    if (to <= from) continue;
    runs.push({
      text: text.slice(from, to),
      b: line.marks.some((m) => m.b && m.from <= from && m.to >= to),
      i: line.marks.some((m) => m.i && m.from <= from && m.to >= to),
    });
  }
  return runs;
}

// Largest size at which every slide of a song fits the text box: first without any
// wrapping, then allowing lines to wrap. One size per song keeps it visually steady.
export function fitFontSize(slideLines, { box = TEXT_BOX, maxPt, minPt, lineSpacing = 1, font, measure = heuristicMeasure }) {
  const lh = LINE_HEIGHT * lineSpacing;
  const width = (line, pt) => measure(line.text, pt, { font, italic: line.italic });
  for (let pt = maxPt; pt >= minPt; pt--) {
    const fits = slideLines.every((lines) => (lines.length * pt * lh) / 72 <= box.h && lines.every((l) => width(l, pt) <= box.w));
    if (fits) return { pt, wraps: false, overflow: false };
  }
  for (let pt = maxPt; pt >= minPt; pt--) {
    const fits = slideLines.every((lines) => {
      const rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(width(l, pt) / box.w)), 0);
      return (rows * pt * lh) / 72 <= box.h;
    });
    if (fits) return { pt, wraps: true, overflow: false };
  }
  return { pt: minPt, wraps: true, overflow: true };
}

// songs -> [{ kind:'title'|'lyrics'|'blank', ... }] plus warnings for the UI.
export function planDeck(songs, prefs = {}, measure = heuristicMeasure) {
  const o = { ...DECK_DEFAULTS, ...prefs };
  const slides = [];
  const warnings = [];
  songs.forEach((song, si) => {
    if (si > 0 && o.blankBetweenSongs) slides.push({ kind: 'blank', song: si });
    if (o.titleSlides) {
      const subtitle = song.books.map((b) => `${b.name} #${b.number}`).join(' · ');
      let titlePt = TITLE_PT;
      while (titlePt > 32 && measure(song.title, titlePt, { font: o.font, bold: true }) > TEXT_BOX.w * 2) titlePt -= 2;
      slides.push({ kind: 'title', song: si, title: song.title, subtitle, titlePt });
    }
    const lyricGroups = song.groups.filter((g) => groupKind(g) !== 'comment');
    const sequence = o.repeatChorus ? repeatChorus(lyricGroups) : lyricGroups;
    const songSlides = [];
    for (const group of sequence) {
      const kind = groupKind(group);
      for (const chunk of splitGroup(group, o.maxLines)) {
        const lines = chunk.map(({ part, line }) => ({
          text: lyricText(line),
          italic: o.chorusItalic && part.type === 'chorus',
          runs: runsOf(line),
        }));
        const notes = o.notes && song.hasChords ? chunk.map(({ line }) => inlineChordLine(line).replace(/\s+$/, '')).join('\n') : '';
        songSlides.push({ kind: 'lyrics', song: si, group: kind, lines, notes });
      }
    }
    const fit = fitFontSize(songSlides.map((s) => s.lines), { maxPt: o.maxPt, minPt: o.minPt, lineSpacing: o.lineSpacing, font: o.font, measure });
    if (fit.overflow) warnings.push(`"${song.title}" has a slide that may not fit even at ${o.minPt}pt`);
    for (const s of songSlides) Object.assign(s, { pt: fit.pt, wraps: fit.wraps });
    slides.push(...songSlides);
  });
  return { slides, warnings };
}
