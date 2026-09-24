// PowerPoint samples for tools/gen-samples.mjs (placeholder fixtures only).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

import { renderPptx } from '../extension/shared/pptx.js';
import { hymn, refrain, long } from '../test/fixtures/songs.mjs';

export async function writePptxSamples(out) {
  const cases = [
    { name: 'sample-dark.pptx', songs: [hymn(), refrain(), long()], prefs: { blankBetweenSongs: true, docTitle: 'Sample set list' } },
    { name: 'sample-light.pptx', songs: [hymn()], prefs: { bg: 'FFFFFF', fg: '000000', repeatChorus: false, chorusItalic: true } },
  ];
  const expect = {};
  for (const c of cases) {
    const { data, plan } = await renderPptx(PptxGenJS, c.songs, c.prefs, undefined, 'nodebuffer');
    await writeFile(path.join(out, c.name), data);
    expect[c.name] = {
      slides: plan.slides.length,
      kinds: plan.slides.map((s) => s.kind),
      sizes: plan.slides.map((s) => (s.kind === 'lyrics' ? s.pt : null)),
      lines: plan.slides.map((s) => (s.kind === 'lyrics' ? s.lines.length : null)),
    };
  }
  return expect;
}
