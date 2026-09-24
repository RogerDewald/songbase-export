import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';

import { groupKind } from '../extension/shared/ir.js';
import { repeatChorus, splitGroup, planDeck, fitFontSize, heuristicMeasure } from '../extension/shared/slides.js';
import { renderPptx } from '../extension/shared/pptx.js';
import { hymn, refrain, long } from './fixtures/songs.mjs';

const lyricGroups = (song) => song.groups.filter((g) => groupKind(g) !== 'comment');

test('slides: chorus repeats after every verse', () => {
  const seq = repeatChorus(lyricGroups(hymn())).map(groupKind);
  assert.deepEqual(seq, ['verse', 'chorus', 'verse', 'chorus', 'verse', 'chorus']);
});

test('slides: no repeat when a verse already carries a refrain, or no single chorus', () => {
  const groups = lyricGroups(refrain());
  assert.equal(repeatChorus(groups), groups);
  const longGroups = lyricGroups(long());
  assert.equal(repeatChorus(longGroups), longGroups);
});

test('slides: long groups split in balance, nudged onto a phrase end', () => {
  const chunks = splitGroup(lyricGroups(long())[0], 8);
  assert.deepEqual(chunks.map((c) => c.length), [4, 6], 'cut moved from 5 to 4: line four ends with a period');
  const whole = splitGroup(lyricGroups(refrain())[0], 8);
  assert.equal(whole.length, 1, 'verse with its refrain stays on one slide');
  assert.equal(whole[0].length, 4);
  const perPart = splitGroup(lyricGroups(refrain())[0], 2);
  assert.deepEqual(perPart.map((c) => c.length), [2, 1, 1], 'one slide per part when each part fits');
});

test('slides: deck plan counts, blank slides, notes', () => {
  assert.equal(planDeck([hymn()]).slides.length, 1 + 6);
  assert.equal(planDeck([hymn()], { repeatChorus: false }).slides.length, 1 + 4);
  assert.equal(planDeck([hymn()], { titleSlides: false, repeatChorus: false }).slides.length, 4);
  const set = planDeck([hymn(), refrain(), long()], { blankBetweenSongs: true });
  assert.deepEqual(set.slides.map((s) => s.kind), [
    'title', 'lyrics', 'lyrics', 'lyrics', 'lyrics', 'lyrics', 'lyrics',
    'blank', 'title', 'lyrics', 'lyrics',
    'blank', 'title', 'lyrics', 'lyrics',
  ]);
  const first = planDeck([hymn()]).slides[1];
  assert.equal(first.notes.split('\n')[0], '[D]This is the [G]opening line of [A]verse one');
  assert.equal(planDeck([refrain()]).slides[1].notes, '', 'no chord notes for a song without chords');
  assert.equal(planDeck([hymn()]).slides[0].subtitle, 'Hymnal #12');
});

test('slides: one font size per song, within bounds, smaller for long lines', () => {
  const plan = planDeck([hymn()]);
  const sizes = new Set(plan.slides.filter((s) => s.kind === 'lyrics').map((s) => s.pt));
  assert.equal(sizes.size, 1);
  const pt = [...sizes][0];
  assert.ok(pt >= 28 && pt <= 44, `size ${pt}`);
  const short = fitFontSize([[{ text: 'Short line' }]], { maxPt: 44, minPt: 28 });
  assert.deepEqual(short, { pt: 44, wraps: false, overflow: false });
  const wide = fitFontSize([[{ text: 'W'.repeat(40) }]], { maxPt: 44, minPt: 28 });
  assert.ok(wide.pt < 44 || wide.wraps, 'a very wide line forces a smaller size or wrapping');
  const tooMuch = fitFontSize([Array.from({ length: 30 }, () => ({ text: 'Filler words for overflow' }))], { maxPt: 44, minPt: 28 });
  assert.equal(tooMuch.overflow, true);
  assert.ok(heuristicMeasure('mmmm', 44) > heuristicMeasure('iiii', 44));
});

test('pptx: a real deck builds, zips and carries the plan', async () => {
  const songs = [hymn(), refrain(), long()];
  const { data, plan } = await renderPptx(PptxGenJS, songs, { blankBetweenSongs: true }, undefined, 'nodebuffer');
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.equal(slideFiles.length, plan.slides.length);
  const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(s2, /<a:srgbClr val="000000"\/>/, 'black background');
  assert.match(s2, new RegExp(`sz="${plan.slides[1].pt * 100}"`), 'computed font size written');
  assert.match(s2, /This is the opening line of verse one/);
  const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
  assert.ok(notes.length >= 6, 'speaker notes present');
  const light = await renderPptx(PptxGenJS, [long()], { bg: 'FFFFFF', fg: '000000', titleSlides: false }, undefined, 'nodebuffer');
  const lz = await JSZip.loadAsync(light.data);
  assert.match(await lz.file('ppt/slides/slide1.xml').async('string'), /<a:srgbClr val="FFFFFF"\/>/);
});
