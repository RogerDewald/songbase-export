import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

import { normalizeSong } from '../extension/shared/ir.js';
import { renderLyricsHtml } from './site-render.mjs';
import { songFromMarkup } from './helpers.mjs';
import { HYMN_MARKUP, REFRAIN_MARKUP, LONG_MARKUP } from './fixtures/songs.mjs';

const EXTRACT_SRC = readFileSync(new URL('../extension/content/extract.js', import.meta.url), 'utf8');

// Invented placeholder text covering the awkward cases seen on the live site.
const EDGE_MARKUP = `1
[C]First edge line with **bold words** and *slanted words*
 A line that starts with one space
Two [G][D]chords at one spot
Capo 3 appears inside this stanza
Final line with a tie_mark

  [Am]Indented [G]refrain line
  Second refrain line [E7]`;

function page(lyricsHtml, { url = 'https://songbase.life/101', title = 'Fixture Title', showChords } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body><div class="application-container"><div class="lyrics">${lyricsHtml}</div></div></body></html>`,
    { url, runScripts: 'outside-only' },
  );
  if (showChords === false) dom.window.localStorage.setItem('showChords', 'false');
  vm.runInContext(EXTRACT_SRC, dom.getInternalVMContext());
  return dom;
}

function extract(dom) {
  const w = dom.window;
  // Cross-realm objects: compare as plain JSON.
  return JSON.parse(JSON.stringify(w.SBX_extract(w.document, w.location, w.localStorage)));
}

// Flatten to a structure both parsers must agree on, regardless of how parts are split.
function flat(song) {
  const rows = [];
  for (const g of song.groups) {
    for (const p of g.parts) {
      if (p.type === 'comment') rows.push({ comment: p.text, capo: p.capo ?? null });
      else p.lines.forEach((l, i) => rows.push({ type: p.type, number: i === 0 ? p.number ?? null : null, text: l.text, chords: l.chords }));
    }
  }
  return rows;
}

for (const [name, markup] of Object.entries({ HYMN_MARKUP, REFRAIN_MARKUP, LONG_MARKUP, EDGE_MARKUP })) {
  test(`extract: ${name} matches the markup`, () => {
    const res = extract(page(renderLyricsHtml(markup)));
    assert.equal(res.ok, true);
    assert.deepEqual(res.song.warnings, []);
    const got = normalizeSong(res.song);
    const want = songFromMarkup(markup);
    assert.deepEqual(flat(got), flat(want));
    assert.equal(got.groups.length, want.groups.length, 'blank-line groups preserved');
    assert.equal(got.key, want.key);
  });
}

test('extract: metadata from the page', () => {
  const res = extract(page(renderLyricsHtml(HYMN_MARKUP), { url: 'https://songbase.life/4321?tune=2', title: 'A &amp; B' }));
  assert.equal(res.song.id, 4321);
  assert.equal(res.song.tune, '2');
  assert.equal(res.song.title, 'A & B');
  assert.equal(res.song.transpose, 0);
  assert.equal(res.song.chordsHidden, false);
  assert.equal(res.song.url, 'https://songbase.life/4321?tune=2');
});

test('extract: bold/italic marks and edge cases', () => {
  const song = normalizeSong(extract(page(renderLyricsHtml(EDGE_MARKUP))).song);
  const first = song.groups[0].parts[0].lines[0];
  const boldText = first.marks.filter((m) => m.b).map((m) => first.text.slice(m.from, m.to)).join('');
  const italicText = first.marks.filter((m) => m.i).map((m) => first.text.slice(m.from, m.to)).join('');
  assert.equal(boldText, 'bold words');
  assert.equal(italicText, 'slanted words');
  const all = flat(song);
  assert.ok(all.some((r) => r.text === ' A line that starts with one space'), 'single-space line kept');
  assert.deepEqual(all.find((r) => r.text === 'Two chords at one spot').chords, [{ at: 4, name: 'G' }, { at: 4, name: 'D' }]);
  assert.ok(all.some((r) => r.capo === 3), 'capo line inside a stanza becomes a comment');
  assert.ok(all.some((r) => r.text === 'Final line with a tie‿mark'));
  assert.equal(song.capo, 3);
});

test('extract: transposed chords are read as displayed', () => {
  const up = (c) => ({ D: 'Eb', G: 'Ab', A: 'Bb' })[c] || c;
  const song = normalizeSong(extract(page(renderLyricsHtml(HYMN_MARKUP, { transposeChord: up }))).song);
  assert.deepEqual(song.groups[1].parts[0].lines[0].chords.map((c) => c.name), ['Eb', 'Ab', 'Bb']);
  assert.equal(song.key, 'Eb');
});

test('extract: chords hidden on the site', () => {
  const res = extract(page(renderLyricsHtml(HYMN_MARKUP, { showChords: false }), { showChords: false }));
  assert.equal(res.song.chordsHidden, true);
  const song = normalizeSong(res.song);
  assert.equal(song.hasChords, false);
  assert.ok(!flat(song).some((r) => r.capo), 'site strips the capo comment when chords are hidden');
});

test('extract: not a song page / still loading / site error', () => {
  assert.deepEqual(extract(page('', { url: 'https://songbase.life/' })), { ok: false, reason: 'not-song' });
  const loading = new JSDOM('<!doctype html><body><div class="application-container"></div></body>', { url: 'https://songbase.life/5', runScripts: 'outside-only' });
  vm.runInContext(EXTRACT_SRC, loading.getInternalVMContext());
  assert.deepEqual(extract(loading), { ok: false, reason: 'loading' });
  const err = extract(page("<div class='song-controls'></div>ERROR: HTML tags are forbidden."));
  assert.deepEqual(err, { ok: false, reason: 'site-error' });
});

test('extract: self-check flags markup it does not understand', () => {
  const html = renderLyricsHtml(REFRAIN_MARKUP) + "<br><div class='new-wrapper'><div class='line'>Hidden placeholder line</div></div>";
  const res = extract(page(html));
  assert.equal(res.ok, true);
  assert.ok(res.song.warnings.some((w) => /self-check: 7 lines on the page, 6 read/.test(w)), res.song.warnings.join(' | '));
  assert.ok(res.song.warnings.some((w) => /unknown elements/.test(w)));
  assert.ok(flat(normalizeSong(res.song)).some((r) => r.comment === 'Hidden placeholder line'), 'text is never silently dropped');
});
