// Writes sample exports built from the PLACEHOLDER fixtures into ./out, plus expect.json
// with the counts the Office checks (test/office/*.ps1) must find. Run: npm run samples
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import { hymn, refrain, long } from '../test/fixtures/songs.mjs';
import { songFromMarkup } from '../test/helpers.mjs';
import { renderDocx, buildDocxParts, packDocx } from '../extension/shared/docx.js';
import { renderWordHtml, wordOptions } from '../extension/shared/html.js';
import { renderText } from '../extension/shared/text.js';
import { planPages, songHeightPt, LINE_FACTOR } from '../extension/shared/pagination.js';
import { FONTS, MONO_FONTS } from '../extension/shared/prefs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
await mkdir(out, { recursive: true });

const setList = () => [hymn(), refrain(), long()];
const expect = { docx: {}, html: {}, pptx: {} };

for (const mode of ['lyrics', 'chords']) {
  const name = `sample-${mode}.docx`;
  await writeFile(path.join(out, name), await renderDocx(setList(), { mode, docTitle: 'Sample set list' }, JSZip, 'nodebuffer'));
  expect.docx[name] = {
    paragraphs: 16,
    headings: 3,
    pageBreakBefore: 2,
    // A tab follows each verse number in lyrics layout: 3 hymn verses + 1 long-song verse.
    // In chords mode only the hymn has chords; the long song falls back to lyrics layout.
    numberedTabs: mode === 'lyrics' ? 4 : 1,
    monoParagraphs: mode === 'chords' ? 4 : 0, // only the hymn has chords; others fall back to lyrics
  };

  const htmlName = `sample-word-${mode}.html`;
  await writeFile(path.join(out, htmlName), renderWordHtml(setList(), { mode }));
  expect.html[htmlName] = expect.docx[name];
}

// ---- page-sharing samples, checked in real Word by test/office/verify-pages.ps1.
// Invented songs of a chosen length; the plan comes from the real planner, and Word must then
// put every song where the plan says and never split one across two pages.
expect.pages = {};
const songOf = (n, title) => songFromMarkup(Array.from({ length: n }, (_, i) => `Line ${i + 1} of the placeholder song`).join('\n'), { id: title, title });
const short = (t) => songOf(6, t);
const tall = (t) => songOf(24, t); // about 63% of a page: two of them can never share one
const pairSet = [short('Short One'), short('Short Two'), tall('Tall One'), tall('Tall Two'), short('Short Three'), short('Short Four'), short('Short Five')];
const forcedSet = [tall('Forced One'), tall('Forced Two')]; // a plan the estimate would refuse
// The first song ends with a comment: that paragraph must not keep with the next song's title
// (its style once said keep-with-next, which chained the two songs into one unbreakable block).
const endsWithComment = songFromMarkup(`${Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of the placeholder song`).join('\n')}\n# Repeat the last line`, { id: 'Comment End', title: 'Comment End' });
const forcedCommentSet = [endsWithComment, tall('Forced Two')];
const pageCases = [
  { name: 'pairs', songs: pairSet, pages: planPages(pairSet, { mode: 'lyrics' }).pages, note: 'the planner\'s own plan' },
  // Over-pairs on purpose: the keep-together chain must then move song 2 whole to page 2.
  { name: 'forced', songs: forcedSet, pages: [[0, 1]], note: 'a pair that does not fit; Word must not split it' },
  { name: 'forced-comment', songs: forcedCommentSet, pages: [[0, 1]], note: 'the same, when song 1 ends with a comment' },
];
for (const c of pageCases) {
  const prefs = { mode: 'lyrics', pages: c.pages };
  await writeFile(path.join(out, `sample-${c.name}.docx`), await renderDocx(c.songs, prefs, JSZip, 'nodebuffer'));
  await writeFile(path.join(out, `sample-word-${c.name}.html`), renderWordHtml(c.songs, prefs));
  const titles = c.songs.map((s) => s.title);
  // Page each song should START on if the plan is followed; for `forced`, where song 2 lands after the fallback.
  const planned = [];
  c.pages.forEach((page, p) => page.forEach(() => planned.push(p + 1)));
  const startPages = c.name.startsWith('forced') ? [1, 2] : planned;
  expect.pages[`sample-${c.name}.docx`] = { kind: 'docx', titles, startPages, pageCount: Math.max(...startPages), note: c.note };
  expect.pages[`sample-word-${c.name}.html`] = { kind: 'html', titles, startPages, pageCount: Math.max(...startPages), note: c.note };
}

// ---- height accuracy: one song + a trailing sentinel paragraph; Word's distance from the title to
// the sentinel must match the planner's estimate. Songs that never wrap, so the estimate needs no
// font access and is the same here as in the panel.
expect.heights = {};
const noWrap = () => 0;
for (const [name, song, prefs] of [
  ['hymn-lyrics', hymn(), { mode: 'lyrics' }],
  ['hymn-chords', hymn(), { mode: 'chords' }],
  ['long-georgia14', long(), { mode: 'lyrics', font: 'Georgia', sizePt: 14 }],
]) {
  const parts = buildDocxParts([song], prefs);
  parts['word/document.xml'] = parts['word/document.xml'].replace('<w:sectPr>', '<w:p><w:r><w:t>SENTINEL</w:t></w:r></w:p><w:sectPr>');
  const file = `height-${name}.docx`;
  await writeFile(path.join(out, file), await packDocx(parts, JSZip, 'nodebuffer'));
  // The .docx text is 7in wide (the planner assumes 6.5in), so estimate at the file's own width.
  expect.heights[file] = { estimate: songHeightPt(song, wordOptions(song, prefs), 504, noWrap) };
}

// ---- line pitch: 21 one-line paragraphs per font; Word's line height must match LINE_FACTOR.
expect.pitch = {};
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
for (const font of [...FONTS, ...MONO_FONTS]) {
  const paras = Array.from({ length: 21 }, (_, i) => `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="24"/></w:rPr><w:t>Hxg line ${i}</w:t></w:r></w:p>`);
  const parts = buildDocxParts([hymn()], {});
  parts['word/document.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W_NS}"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const file = `pitch-${font.replace(/\W+/g, '_')}.docx`;
  await writeFile(path.join(out, file), await packDocx(parts, JSZip, 'nodebuffer'));
  expect.pitch[file] = { font, sizePt: 12, factor: LINE_FACTOR[font] };
}

await writeFile(path.join(out, 'sample-chords.txt'), renderText(setList(), { style: 'chords' }) + '\r\n');
await writeFile(path.join(out, 'sample-lyrics.txt'), renderText(setList(), { style: 'lyrics' }) + '\r\n');

// PowerPoint samples are appended by tools/gen-pptx-samples.mjs once the deck builder exists.
try {
  const { writePptxSamples } = await import('./gen-pptx-samples.mjs');
  Object.assign(expect.pptx, await writePptxSamples(out));
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

await writeFile(path.join(out, 'expect.json'), JSON.stringify(expect, null, 2));
console.log(`samples written to ${out}`);
