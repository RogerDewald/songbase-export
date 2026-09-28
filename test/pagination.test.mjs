import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import {
  planPages, songHeightPt, visualLines, approxMeasure, LINE_FACTOR, FILL, PAIR_EXTRA_PT, PLAN_MARGIN_PT,
} from '../extension/shared/pagination.js';
import { renderWordHtml, renderWordPreview, songSlots, wordOptions, PAPER_TWIPS } from '../extension/shared/html.js';
import { buildDocxParts, renderDocx } from '../extension/shared/docx.js';
import { mergePrefs } from '../extension/shared/prefs.js';
import { normalizeSong } from '../extension/shared/ir.js';
import { hymn, refrain, long } from './fixtures/songs.mjs';

const { DOMParser } = new JSDOM('').window;
const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const noWrap = () => 0; // a measure that never wraps: heights depend on line counts only

// A song of `n` plain lyric lines in one stanza, no numbers, no meta, no exotic glyphs.
function lines(n, title = 'Song') {
  return normalizeSong({
    id: title,
    title,
    groups: [{ parts: [{ type: 'stanza', lines: Array.from({ length: n }, (_, i) => ({ text: `Line ${i + 1} of the song`, chords: [], marks: [] })) }] }],
  });
}
const OPTS = { font: 'Calibri', sizePt: 12, mode: 'lyrics' };
const LINE = 12 * LINE_FACTOR.Calibri;

test('songSlots: a valid plan gives breaks and joins; a stale or malformed one falls back to one per page', () => {
  assert.deepEqual(songSlots([[0, 1], [2], [3, 4]], 5), [
    { breakBefore: false, joined: false },
    { breakBefore: false, joined: true },
    { breakBefore: true, joined: false },
    { breakBefore: true, joined: false },
    { breakBefore: false, joined: true },
  ]);
  const strict = [{ breakBefore: false, joined: false }, { breakBefore: true, joined: false }, { breakBefore: true, joined: false }];
  assert.deepEqual(songSlots(undefined, 3), strict, 'no plan');
  assert.deepEqual(songSlots([[0, 1]], 3), strict, 'plan for a different song count');
  assert.deepEqual(songSlots([[1, 0], [2]], 3), strict, 'out of order');
  assert.deepEqual(songSlots([[0, 1, 2]], 3), strict, 'three to a page is never valid');
  assert.deepEqual(songSlots([[0], []], 1), [{ breakBefore: false, joined: false }], 'an empty page is rejected');
});

test('visualLines: greedy word wrap, over-long words break, empty text is one line', () => {
  // 1pt per character, 12pt text: measure returns inches, so chars * pt / 72 * (1/pt)... use a direct fake.
  const measure = (text) => text.length / 72; // 1pt per character
  const wrap = (text, width) => visualLines(text, 12, {}, width, measure);
  assert.equal(wrap('', 100), 1);
  assert.equal(wrap('short', 100), 1);
  // width fudge (2%) applies to every measurement: 50 chars fit in 100pt, 99 do not fit on one line
  assert.equal(wrap('a '.repeat(40).trim(), 100), 1, '79 chars');
  assert.equal(wrap('word '.repeat(30).trim(), 100), 2, '149 chars wrap to two lines');
  assert.equal(wrap('x'.repeat(250), 100), 3, 'one 250-char word breaks across three lines');
  assert.equal(wrap('hello world', 0), 1, 'no width to wrap to: one line rather than a loop');
});

test('visualLines: spaces at the start of a chord row take room; spaces never start a line', () => {
  const measure = (text) => text.length / 72; // 1pt per character
  const wrap = (text, width) => visualLines(text, 12, {}, width, measure);
  // 7 gutter spaces + a 94-character run = 101 characters (+2%) on a 100pt line: the run moves down.
  assert.equal(wrap(`${' '.repeat(7)}${'A'.repeat(94)}`, 100), 2);
  assert.equal(wrap('A'.repeat(94), 100), 1, 'without the gutter it fits');
  // A row of chords spread by runs of spaces wraps where its width says, gutter included.
  const row = `${' '.repeat(4)}D${' '.repeat(20)}G${' '.repeat(20)}A${' '.repeat(20)}Em${' '.repeat(20)}C`;
  assert.equal(wrap(row, 200), 1);
  // At 60pt the run of spaces before "Em" hangs past the edge and "Em ... C" fits on line 2.
  assert.equal(wrap(row, 60), 2, 'spaces hang at the wrap instead of opening a new line');
  assert.equal(wrap(row, 40), 3);
  // Trailing and doubled spaces at a wrap point do not add an empty line.
  assert.equal(wrap(`${'w'.repeat(60)}${' '.repeat(30)}${'w'.repeat(60)}`, 100), 2);
});

test('height model: title, meta, paragraphs and gaps, checked by hand', () => {
  // 5 lines, no meta: title (18pt) + 4pt, empty meta (10pt) + 10pt gap, 5 lines, 10pt group gap
  const expected = 18 * LINE_FACTOR.Calibri + 4 + 10 * LINE_FACTOR.Calibri + 10 + 5 * LINE + 10;
  assert.ok(Math.abs(songHeightPt(lines(5), wordOptions(lines(5), OPTS), 504, noWrap) - expected) < 1e-9);
  // Two groups: each ends with its own 10pt gap.
  const two = normalizeSong({
    title: 'Two',
    groups: [
      { parts: [{ type: 'stanza', lines: [{ text: 'a', chords: [], marks: [] }] }] },
      { parts: [{ type: 'stanza', lines: [{ text: 'b', chords: [], marks: [] }] }] },
    ],
  });
  const expectedTwo = 18 * LINE_FACTOR.Calibri + 4 + 10 * LINE_FACTOR.Calibri + 10 + 2 * (LINE + 10);
  assert.ok(Math.abs(songHeightPt(two, wordOptions(two, OPTS), 504, noWrap) - expectedTwo) < 1e-9);
});

test('height model: a line the font cannot draw is taller, as measured in Word', () => {
  const plain = lines(4);
  const tied = normalizeSong({ title: 'Song', groups: [{ parts: [{ type: 'stanza', lines: plain.groups[0].parts[0].lines.map((l) => ({ ...l, text: 'two‿words' })) }] }] });
  const hangul = normalizeSong({ title: 'Song', groups: [{ parts: [{ type: 'stanza', lines: plain.groups[0].parts[0].lines.map((l) => ({ ...l, text: '할레루야' })) }] }] });
  const h = (song) => songHeightPt(song, wordOptions(song, OPTS), 504, noWrap);
  // Symbols grow a line to 1.34x the text size, Hangul to 1.8x (Calibri's own is 1.22x).
  assert.ok(Math.abs(h(tied) - h(plain) - 4 * 12 * (1.34 - LINE_FACTOR.Calibri)) < 1e-9);
  assert.ok(Math.abs(h(hangul) - h(plain) - 4 * 12 * (1.8 - LINE_FACTOR.Calibri)) < 1e-9);
  // ...but accents and Cyrillic do not.
  const accents = normalizeSong({ title: 'Song', groups: [{ parts: [{ type: 'stanza', lines: plain.groups[0].parts[0].lines.map((l) => ({ ...l, text: 'café Мир' })) }] }] });
  assert.equal(h(accents), h(plain));
});

test('planner: two songs share a page only when both fit whole, to the line', () => {
  // Room = page text height * FILL. A pair costs both songs + the gap and rule between them.
  const room = (PAPER_TWIPS.letter.h / 20 - 2 * PLAN_MARGIN_PT) * FILL;
  const fixed = 18 * LINE_FACTOR.Calibri + 4 + 10 * LINE_FACTOR.Calibri + 10 + 10; // title + meta + group gap
  const fits = Math.floor((room - PAIR_EXTRA_PT - 2 * fixed) / LINE); // most lines two songs may share
  const plan = (a, b, extra = {}) => planPages([lines(a, 'A'), lines(b, 'B')], { ...OPTS, ...extra }, { measure: noWrap });

  assert.deepEqual(plan(Math.ceil(fits / 2), Math.floor(fits / 2)).pages, [[0, 1]], `${fits} lines between them fit`);
  assert.deepEqual(plan(Math.ceil((fits + 1) / 2), Math.floor((fits + 1) / 2)).pages, [[0], [1]], 'one more line does not');
  assert.deepEqual(plan(3, 3, { pairShort: false }).pages, [[0], [1]], 'pairing switched off');
  assert.deepEqual(plan(3, 3, { page: 'a4' }).pages, [[0, 1]]);
  // A4 is about three lines taller than Letter: two lines over Letter's limit still fit A4.
  const total = fits + 2;
  assert.deepEqual(plan(Math.ceil(total / 2), Math.floor(total / 2)).pages, [[0], [1]], 'too big for Letter');
  assert.deepEqual(plan(Math.ceil(total / 2), Math.floor(total / 2), { page: 'a4' }).pages, [[0, 1]], 'fits A4');
});

test('planner: order is kept, pairs are neighbours, a long song is never shared', () => {
  const [s, m, l] = [lines(3, 'S'), lines(10, 'M'), lines(60, 'L')];
  const at = (songs) => planPages(songs, OPTS, { measure: noWrap });
  assert.deepEqual(at([s, m, s, m]).pages, [[0, 1], [2, 3]], 'greedy from the left');
  assert.deepEqual(at([s, l, s]).pages, [[0], [1], [2]], 'the long song stands alone; songs are not reshuffled around it');
  assert.deepEqual(at([l, s, s]).pages, [[0], [1, 2]]);
  assert.deepEqual(at([s, s, s]).pages, [[0, 1], [2]], 'never three on a page');
  assert.deepEqual(at([s]).pages, [[0]]);
  assert.equal(at([l]).pageCount, 2, 'a song longer than a page counts every page it spans');
  assert.equal(at([s, s, s]).pairedPages, 1);
  assert.deepEqual(at([]).pages, []);
});

test('planner: a wider measure can only make songs taller, never fewer pages', () => {
  const songs = [hymn(), refrain(), long(), hymn()];
  const narrow = planPages(songs, { mode: 'lyrics' }, { measure: () => 0 });
  const wide = planPages(songs, { mode: 'lyrics' }, { measure: (t, pt) => (t.length * 0.9 * pt) / 72 });
  assert.ok(wide.heights.every((h, i) => h >= narrow.heights[i]));
  assert.ok(wide.pages.length >= narrow.pages.length);
  // The Node fallback measure is generous on purpose: at least as wide as Calibri really is.
  assert.ok(approxMeasure('The quick brown fox', 12, { font: 'Calibri' }) * 72 > 12 * 0.49 * 19);
});

// ---------------------------------------------------------------- the output follows the plan

test('word html: a shared page has no break, a rule and a keep-together chain; the next page has a break', () => {
  const songs = [lines(3, 'One'), lines(3, 'Two'), lines(3, 'Three')];
  const doc = new JSDOM(renderWordHtml(songs, { ...OPTS, pages: [[0, 1], [2]] })).window.document;
  const h1 = [...doc.querySelectorAll('h1')];
  assert.doesNotMatch(h1[0].getAttribute('style'), /page-break-before|border-top/);
  assert.doesNotMatch(h1[1].getAttribute('style'), /page-break-before/, 'the second song shares the page');
  assert.match(h1[1].getAttribute('style'), /margin:20pt 0in 4pt 0in/);
  assert.match(h1[1].getAttribute('style'), /border-top:\.75pt solid #BFBFBF;padding-top:6pt/);
  assert.match(h1[2].getAttribute('style'), /page-break-before:always/);
  assert.doesNotMatch(h1[2].getAttribute('style'), /border-top/);

  const paras = [...doc.querySelectorAll('p')]; // per song: meta + one stanza
  assert.equal(paras.length, 6);
  const keeps = paras.map((p) => /page-break-after:avoid/.test(p.getAttribute('style')));
  // Song One (first of the pair) is unchanged: meta keeps with its stanza, the stanza does not chain.
  assert.deepEqual(keeps.slice(0, 2), [true, false]);
  // Song Two (joined): meta chains to the stanza, and the stanza -- its last paragraph -- ends the chain.
  assert.deepEqual(keeps.slice(2, 4), [true, false]);
});

test('word html: every paragraph of a joined song but the last chains, across groups', () => {
  const doc = new JSDOM(renderWordHtml([lines(2, 'One'), hymn()], { mode: 'lyrics', pages: [[0, 1]] })).window.document;
  const paras = [...doc.querySelectorAll('p')].slice(2); // drop song One's meta + stanza
  const keeps = paras.map((p) => /page-break-after:avoid/.test(p.getAttribute('style')));
  assert.ok(paras.length > 4);
  assert.deepEqual(keeps.slice(0, -1).filter((k) => !k), [], 'every paragraph but the last keeps with the next');
  assert.equal(keeps.at(-1), false, 'the last one does not, or the chain would run into whatever follows');
});

test('word html: no plan means one song per page, exactly as before', () => {
  const doc = new JSDOM(renderWordHtml([lines(2, 'A'), lines(2, 'B'), lines(2, 'C')], OPTS)).window.document;
  const h1 = [...doc.querySelectorAll('h1')];
  assert.doesNotMatch(h1[0].getAttribute('style'), /page-break-before/);
  assert.match(h1[1].getAttribute('style'), /page-break-before:always/);
  assert.match(h1[2].getAttribute('style'), /page-break-before:always/);
  assert.equal(doc.querySelectorAll('[style*="border-top"]').length, 0);
  // A stale plan (wrong song count) is ignored rather than dropping page breaks.
  const stale = new JSDOM(renderWordHtml([lines(2, 'A'), lines(2, 'B'), lines(2, 'C')], { ...OPTS, pages: [[0, 1]] })).window.document;
  assert.equal(stale.querySelectorAll('h1[style*="page-break-before:always"]').length, 2);
});

test('word preview: one sheet per planned page', () => {
  const songs = [lines(2, 'A'), lines(2, 'B'), lines(2, 'C')];
  const doc = new JSDOM(`<body>${renderWordPreview(songs, { ...OPTS, pages: [[0, 1], [2]] })}</body>`).window.document;
  const sheets = [...doc.querySelectorAll('section.sbx-sheet')];
  assert.deepEqual(sheets.map((s) => [s.dataset.sheet, s.dataset.songs, s.querySelectorAll('h1').length]), [['1', '2', 2], ['2', '1', 1]]);
});

test('docx: pageBreakBefore follows the plan; a joined title gets a rule and space; its paragraphs chain', () => {
  const two = hymn(); // several paragraphs across groups, so the chain is visible
  two.title = 'Two';
  const songs = [lines(3, 'One'), two, lines(3, 'Three')];
  const parts = buildDocxParts(songs, { ...OPTS, pages: [[0, 1], [2]] });
  const doc = parseXml(parts['word/document.xml']);
  assert.equal(doc.getElementsByTagName('parsererror').length, 0);
  const paras = [...doc.getElementsByTagNameNS(W, 'p')];
  const styleOf = (p) => p.getElementsByTagNameNS(W, 'pStyle')[0].getAttributeNS(W, 'val');
  const titles = paras.filter((p) => styleOf(p) === 'Heading1');
  assert.deepEqual(titles.map((p) => p.getElementsByTagNameNS(W, 'pageBreakBefore').length), [0, 0, 1]);
  assert.deepEqual(titles.map((p) => p.getElementsByTagNameNS(W, 'pBdr').length), [0, 1, 0], 'the rule is only on the joined title');
  const joined = titles[1].getElementsByTagNameNS(W, 'spacing')[0];
  assert.equal(joined.getAttributeNS(W, 'before'), '400', '20pt above');
  assert.equal(joined.getAttributeNS(W, 'after'), '80');
  const top = titles[1].getElementsByTagNameNS(W, 'top')[0];
  assert.deepEqual([top.getAttributeNS(W, 'val'), top.getAttributeNS(W, 'sz'), top.getAttributeNS(W, 'space'), top.getAttributeNS(W, 'color')], ['single', '6', '6', 'BFBFBF']);
  // OOXML wants pBdr after pageBreakBefore/keepNext and before spacing.
  const order = [...titles[1].getElementsByTagNameNS(W, 'pPr')[0].children].map((c) => c.localName);
  assert.deepEqual(order, ['pStyle', 'pBdr', 'spacing']);

  // Song Two's content paragraphs (after its title and meta line) chain to the next, all but the last.
  const keepNext = (p) => p.getElementsByTagNameNS(W, 'keepNext').length > 0;
  const bodyOf = (title) => {
    const at = paras.findIndex((p) => p.textContent === title && styleOf(p) === 'Heading1');
    const rest = paras.slice(at + 2); // skip the title and the meta line
    const end = rest.findIndex((p) => styleOf(p) === 'Heading1');
    return end < 0 ? rest : rest.slice(0, end);
  };
  const joinedBody = bodyOf('Two');
  assert.ok(joinedBody.length >= 5, 'the hymn has several paragraphs');
  assert.deepEqual(joinedBody.slice(0, -1).map(keepNext).filter((k) => !k), [], 'every paragraph but the last keeps with the next');
  assert.equal(keepNext(joinedBody.at(-1)), false, 'the last paragraph ends the chain');
  // A song that is not joined keeps only within its groups: its last paragraph of a group does not chain.
  assert.ok(bodyOf('Three').every((p) => !keepNext(p)), 'one-paragraph songs never chain');
  assert.ok(hymnUnjoinedHasBreaks(), 'unjoined hymn still ends each group without a chain');
});

function hymnUnjoinedHasBreaks() {
  const doc = parseXml(buildDocxParts([hymn()], { mode: 'lyrics' })['word/document.xml']);
  const body = [...doc.getElementsByTagNameNS(W, 'p')].filter((p) => p.getElementsByTagNameNS(W, 'pStyle')[0].getAttributeNS(W, 'val') !== 'Heading1').slice(1);
  return body.some((p) => p.getElementsByTagNameNS(W, 'keepNext').length === 0);
}

test('docx: a song that ends with a comment does not keep with the next song', () => {
  // The comment style once carried keep-with-next, which a paragraph cannot switch off by omission:
  // the last paragraph of the first song chained into the second song's title.
  const commentLast = normalizeSong({
    title: 'One',
    groups: [{ parts: [{ type: 'stanza', lines: [{ text: 'Only stanza line', chords: [], marks: [] }] }, { type: 'comment', text: 'Tune: placeholder' }] }],
  });
  for (const pages of [undefined, [[0, 1]]]) {
    const parts = buildDocxParts([commentLast, lines(2, 'Two')], { ...OPTS, pages });
    const styleXml = /w:styleId="SongComment".*?<\/w:style>/.exec(parts['word/styles.xml'])[0];
    assert.doesNotMatch(styleXml, /keepNext/, 'no style says keep-with-next for a comment');
    const paras = [...parseXml(parts['word/document.xml']).getElementsByTagNameNS(W, 'p')];
    const comment = paras.find((p) => p.textContent === 'Tune: placeholder');
    assert.equal(comment.getElementsByTagNameNS(W, 'keepNext').length, 0);
    // ...while a comment that is followed by the stanza it introduces still chains to it.
    const intro = normalizeSong({ title: 'Intro', groups: [{ parts: [{ type: 'comment', text: 'Tune: intro' }, { type: 'stanza', lines: [{ text: 'A line', chords: [], marks: [] }] }] }] });
    const introParas = [...parseXml(buildDocxParts([intro], OPTS)['word/document.xml']).getElementsByTagNameNS(W, 'p')];
    assert.equal(introParas.find((p) => p.textContent === 'Tune: intro').getElementsByTagNameNS(W, 'keepNext').length, 1);
  }
});

test('docx: no plan means one song per page, and pairShort without a plan changes nothing', async () => {
  const songs = [lines(2, 'A'), lines(2, 'B'), lines(2, 'C')];
  for (const prefs of [OPTS, { ...OPTS, pairShort: true }]) {
    const doc = parseXml(buildDocxParts(songs, prefs)['word/document.xml']);
    assert.equal(doc.getElementsByTagNameNS(W, 'pageBreakBefore').length, 2);
    assert.equal(doc.getElementsByTagNameNS(W, 'pBdr').length, 0);
  }
  const buf = await renderDocx(songs, { ...OPTS, pages: [[0, 1], [2]] }, JSZip, 'nodebuffer');
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 1);
});

test('prefs: pairShort defaults on, is validated, and survives a round trip', () => {
  assert.equal(mergePrefs(null).word.pairShort, true);
  assert.equal(mergePrefs({ word: { pairShort: false } }).word.pairShort, false);
  assert.equal(mergePrefs({ word: { pairShort: 'yes' } }).word.pairShort, true, 'a non-boolean falls back to the default');
});

// ---------------------------------------------------------------- the estimate reads the artefacts

// Recomputes a song's height from what docx.js actually wrote -- paragraph styles, sizes, line
// breaks and spacing read back out of the XML -- without going through the planner. If the
// renderer's geometry changes and the estimator does not follow, this fails.
function heightFromDocx(parts) {
  const styles = parseXml(parts['word/styles.xml']);
  const doc = parseXml(parts['word/document.xml']);
  const twips = (el, name) => (el?.getAttributeNS(W, name) ? Number(el.getAttributeNS(W, name)) / 20 : null);
  const defaults = styles.getElementsByTagNameNS(W, 'rPrDefault')[0];
  const defaultSize = Number(defaults.getElementsByTagNameNS(W, 'sz')[0].getAttributeNS(W, 'val')) / 2;
  const defaultFont = defaults.getElementsByTagNameNS(W, 'rFonts')[0].getAttributeNS(W, 'ascii');
  const styleById = new Map([...styles.getElementsByTagNameNS(W, 'style')].map((s) => [s.getAttributeNS(W, 'styleId'), s]));
  const chain = (id) => {
    const out = [];
    for (let s = styleById.get(id); s; s = styleById.get(s.getElementsByTagNameNS(W, 'basedOn')[0]?.getAttributeNS(W, 'val'))) out.push(s);
    return out;
  };
  const inherited = (id, pick) => {
    for (const s of chain(id)) {
      const v = pick(s);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  let total = 0;
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const id = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || 'Normal';
    const size = inherited(id, (s) => {
      const sz = s.getElementsByTagNameNS(W, 'rPr')[0]?.getElementsByTagNameNS(W, 'sz')[0];
      return sz ? Number(sz.getAttributeNS(W, 'val')) / 2 : null;
    }) ?? defaultSize;
    const font = inherited(id, (s) => s.getElementsByTagNameNS(W, 'rPr')[0]?.getElementsByTagNameNS(W, 'rFonts')[0]?.getAttributeNS(W, 'ascii') ?? null) ?? defaultFont;
    const direct = p.getElementsByTagNameNS(W, 'pPr')[0]?.getElementsByTagNameNS(W, 'spacing')[0];
    const after = twips(direct, 'after') ?? inherited(id, (s) => twips(s.getElementsByTagNameNS(W, 'pPr')[0]?.getElementsByTagNameNS(W, 'spacing')[0], 'after')) ?? 0;
    const before = twips(direct, 'before') ?? 0;
    const rows = 1 + p.getElementsByTagNameNS(W, 'br').length;
    total += rows * size * LINE_FACTOR[font] + before + after;
  }
  return total;
}

test('drift guard: the planner\'s height for a song equals the height of the .docx paragraphs', () => {
  const cases = [
    [hymn(), { mode: 'chords' }],
    [hymn(), { mode: 'lyrics', sizePt: 10, font: 'Georgia' }],
    [long(), { mode: 'lyrics', comments: false, meta: false }],
    [lines(7, 'Seven'), { mode: 'lyrics', font: 'Arial', sizePt: 14, chorusItalic: true }],
    [hymn(), { mode: 'chords', mono: 'Courier New', sizePt: 11, numbers: false, meta: false }],
  ];
  for (const [song, prefs] of cases) {
    const o = wordOptions(song, { font: 'Calibri', sizePt: 12, ...prefs });
    const expected = heightFromDocx(buildDocxParts([song], { font: 'Calibri', sizePt: 12, ...prefs }));
    const actual = songHeightPt(song, o, 504, noWrap);
    assert.ok(Math.abs(actual - expected) < 1e-6, `${song.title} ${JSON.stringify(prefs)}: planner ${actual.toFixed(3)} vs docx ${expected.toFixed(3)}`);
  }
});

// The same for the clipboard HTML: sizes, <br> counts and margins read from inline styles.
function heightFromHtml(html, font, mono) {
  const doc = new JSDOM(html).window.document;
  const pt = (style, prop) => {
    const m = new RegExp(`(?:^|;)${prop}:([^;]*)`).exec(style);
    return m ? Number(/(-?[\d.]+)pt/.exec(m[1])?.[1] ?? NaN) : null;
  };
  let total = 0;
  for (const el of doc.body.querySelectorAll('h1, p')) {
    const style = el.getAttribute('style');
    const family = /font-family:'([^']+)'/.exec(style)[1];
    const size = pt(style, 'font-size');
    const margin = /margin:([^;]*)/.exec(style)[1].split(/\s+/); // top right bottom left
    const rows = 1 + el.querySelectorAll('br').length;
    total += rows * size * LINE_FACTOR[family] + (parseFloat(margin[0]) ? Number(/([\d.]+)pt/.exec(margin[0])?.[1] ?? 0) : 0) + Number(/([\d.]+)pt/.exec(margin[2])?.[1] ?? 0);
  }
  return total;
}

test('drift guard: the planner\'s height for a song equals the height of the clipboard HTML', () => {
  for (const [song, prefs] of [
    [hymn(), { mode: 'chords' }],
    [hymn(), { mode: 'lyrics' }],
    [long(), { mode: 'lyrics', sizePt: 14, font: 'Verdana' }],
  ]) {
    const o = wordOptions(song, { font: 'Calibri', sizePt: 12, ...prefs });
    const html = renderWordHtml([song], { font: 'Calibri', sizePt: 12, ...prefs });
    const expected = heightFromHtml(html);
    const actual = songHeightPt(song, o, 504, noWrap);
    assert.ok(Math.abs(actual - expected) < 1e-6, `${song.title} ${JSON.stringify(prefs)}: planner ${actual.toFixed(3)} vs html ${expected.toFixed(3)}`);
  }
});
