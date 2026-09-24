// Writes sample exports built from the PLACEHOLDER fixtures into ./out, plus expect.json
// with the counts the Office checks (test/office/*.ps1) must find. Run: npm run samples
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import { hymn, refrain, long } from '../test/fixtures/songs.mjs';
import { renderDocx } from '../extension/shared/docx.js';
import { renderWordHtml } from '../extension/shared/html.js';
import { renderText } from '../extension/shared/text.js';

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

await writeFile(path.join(out, 'sample-chords.txt'), renderText(setList(), { style: 'chords' }) + '\r\n');
await writeFile(path.join(out, 'sample-lyrics.txt'), renderText(setList(), { style: 'lyrics' }) + '\r\n');
await writeFile(path.join(out, 'sample.chordpro.txt'), renderText(setList(), { style: 'chordpro' }) + '\r\n');

// PowerPoint samples are appended by tools/gen-pptx-samples.mjs once the deck builder exists.
try {
  const { writePptxSamples } = await import('./gen-pptx-samples.mjs');
  Object.assign(expect.pptx, await writePptxSamples(out));
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

await writeFile(path.join(out, 'expect.json'), JSON.stringify(expect, null, 2));
console.log(`samples written to ${out}`);
