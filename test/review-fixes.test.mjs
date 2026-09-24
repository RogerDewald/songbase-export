// Regression tests for the code-review findings. All text is invented placeholder text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';

import { normalizeSong } from '../extension/shared/ir.js';
import { alignLine, displayWidth } from '../extension/shared/layout.js';
import { renderWordHtml } from '../extension/shared/html.js';
import { buildDocxParts } from '../extension/shared/docx.js';
import { renderPptx } from '../extension/shared/pptx.js';
import { safeFileName } from '../extension/shared/filename.js';
import { songFromMarkup, line } from './helpers.mjs';
import { renderLyricsHtml } from './site-render.mjs';
import { HYMN_MARKUP } from './fixtures/songs.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const { DOMParser } = new JSDOM('').window;

// Finding 1: chord-only lines must not become empty lines in lyrics layout.
const INTRO_MARKUP = `1
[G]   [C]   [D]
Words start on this line
Second line of words [G]
[D]

2
Another verse with words
Its closing line`;

test('lyrics layout skips chord-only lines; the verse number stays on the first line with words', () => {
  const song = songFromMarkup(INTRO_MARKUP, { title: 'Intro Test' });
  const doc = new JSDOM(renderWordHtml(song, { mode: 'lyrics' })).window.document;
  const verse = doc.querySelectorAll('p')[1];
  const lines = verse.innerHTML.split('<br>');
  assert.equal(lines.length, 2, 'two lines with words, no blank ones');
  assert.match(lines[0], /sbx-num">1<\/span>.*Words start on this line$/);

  const xml = new DOMParser().parseFromString(buildDocxParts(song, { mode: 'lyrics' })['word/document.xml'], 'application/xml');
  const p = xml.getElementsByTagNameNS(W, 'p')[2];
  assert.equal(p.getElementsByTagNameNS(W, 'br').length, 1);
  const texts = [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent);
  assert.deepEqual(texts, ['1', 'Words start on this line', 'Second line of words']);

  // Chords layout keeps the intro as a chord row and puts the number on the first lyric row.
  const chordDoc = new JSDOM(renderWordHtml(song, { mode: 'chords' })).window.document;
  const rows = chordDoc.querySelectorAll('p')[1].innerHTML.split('<br>');
  // Chords at offsets 0/3/6 -> "G  C  D"; each 2-space run becomes NBSP + space.
  assert.match(rows[0], /&nbsp;&nbsp;&nbsp;G&nbsp; C&nbsp; D<\/span>$/);
  assert.match(rows[1].replace(/&nbsp;/g, ' '), /^1  Words start/, 'gutter "1  " -> 1 + NBSP + space');
});

// Finding 3: characters Chromium's download API rejects.
test('filenames drop format and control characters', () => {
  assert.equal(safeFileName('Soft­hyphen​word ‏title\u0085⁠', 'txt'), 'Softhyphenword title.txt');
  assert.equal(safeFileName('​​', 'pptx'), 'song.pptx');
});

// Finding 4: XML-illegal characters are removed once, in the model, with offsets kept.
test('control characters are stripped from the model and never reach the .pptx', async () => {
  const song = normalizeSong({
    id: 9,
    title: 'Bell\u0007 title',
    books: [{ name: 'Book\u0001', number: '7' }],
    groups: [{ parts: [{ type: 'stanza', lines: [{ text: 'Ab\u0008cd ef', chords: [{ at: 3, name: 'G' }, { at: 7, name: 'D\u0002' }], marks: [{ from: 3, to: 5, b: true }] }] }] }],
  });
  const l = song.groups[0].parts[0].lines[0];
  assert.equal(song.title, 'Bell title');
  assert.equal(song.books[0].name, 'Book');
  assert.equal(l.text, 'Abcd ef');
  assert.deepEqual(l.chords, [{ at: 2, name: 'G' }, { at: 6, name: 'D' }], 'offsets follow their characters');
  assert.deepEqual(l.marks, [{ from: 2, to: 4, b: true }]);
  const { data } = await renderPptx(PptxGenJS, [song], {}, undefined, 'nodebuffer');
  const zip = await JSZip.loadAsync(data);
  for (const name of Object.keys(zip.files).filter((f) => f.endsWith('.xml'))) {
    assert.doesNotMatch(await zip.file(name).async('string'), /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, name);
  }
});

// Finding 6: alignment by display column (wide CJK characters, combining marks).
test('chord alignment uses display columns for CJK and combining characters', () => {
  assert.equal(displayWidth('测试'), 4);
  assert.equal(displayWidth('é'), 1);
  assert.deepEqual(alignLine(line('测试一二三四', [{ at: 0, name: 'G' }, { at: 3, name: 'D' }])), { chord: 'G     D', lyric: '测试一二三四' });
  assert.deepEqual(alignLine(line('테스트 문장', [{ at: 4, name: 'A' }])), { chord: '       A', lyric: '테스트 문장' });
  assert.deepEqual(alignLine(line('Café ok', [{ at: 6, name: 'C' }])), { chord: '     C', lyric: 'Café ok' });
  const collide = alignLine(line('测试一二', [{ at: 0, name: 'Gmaj7' }, { at: 1, name: 'C' }]));
  assert.deepEqual(collide, { chord: 'Gmaj7 C', lyric: '测----试一二' });
  assert.equal(displayWidth(collide.lyric.slice(0, collide.lyric.indexOf('试'))), collide.chord.indexOf('C'), 'C sits over its character');
});

// Finding 2: the content script's hymn-number lookup under slow / not-yet-filled caches.
const EXTRACT_SRC = readFileSync(new URL('../extension/content/extract.js', import.meta.url), 'utf8');
const CONTENT_SRC = readFileSync(new URL('../extension/content/content.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeIndexedDB({ booksDelay, booksSequence }) {
  const stats = { opens: 0, closes: 0, bookReads: 0 };
  const later = (value, ms) => {
    const req = {};
    setTimeout(() => {
      req.result = value;
      req.onsuccess && req.onsuccess();
    }, ms);
    return req;
  };
  const db = {
    close: () => stats.closes++,
    transaction: (store) => ({
      objectStore: () => ({
        getAll: () => later(booksSequence[Math.min(stats.bookReads++, booksSequence.length - 1)], booksDelay),
        get: () => later(store === 'songs' ? { title: 'Canonical Placeholder Title' } : null, 5),
      }),
    }),
  };
  return {
    stats,
    api: {
      databases: async () => [{ name: 'songbaseDB', version: 50 }],
      open() {
        stats.opens++;
        return later(db, 2);
      },
    },
  };
}

function contentPage(idb) {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Page Title</title></head><body><div class="application-container"><div class="lyrics">${renderLyricsHtml(HYMN_MARKUP)}</div></div></body></html>`,
    { url: 'https://songbase.life/101', runScripts: 'outside-only' },
  );
  let onConnect = null;
  dom.window.chrome = { runtime: { id: 'test', onConnect: { addListener: (fn) => (onConnect = fn) } } };
  dom.window.indexedDB = idb.api;
  const ctx = dom.getInternalVMContext();
  vm.runInContext(EXTRACT_SRC, ctx);
  vm.runInContext(CONTENT_SRC, ctx);
  const received = [];
  let onMessage = null;
  const port = {
    name: 'sbx',
    postMessage: (msg) => received.push(JSON.parse(JSON.stringify(msg))),
    onMessage: { addListener: (fn) => (onMessage = fn) },
    onDisconnect: { addListener: () => {} },
    disconnect() {},
  };
  onConnect(port);
  return { dom, received, refresh: () => onMessage({ type: 'refresh' }) };
}

const BOOKS = [{ name: 'Hymnal', songs: { 101: 12 } }];

test('content script: a slow books read never produces a final message without hymn numbers', async () => {
  const idb = fakeIndexedDB({ booksDelay: 250, booksSequence: [BOOKS] });
  const page = contentPage(idb);
  page.refresh();
  await sleep(900);
  const songs = page.received.filter((m) => m.type === 'song');
  assert.ok(songs.length >= 1);
  for (const m of songs) assert.deepEqual(m.song.books, [{ name: 'Hymnal', number: '12' }], 'every delivered song has its hymn number');
  assert.equal(songs.at(-1).song.title, 'Canonical Placeholder Title');
  assert.equal(idb.stats.bookReads, 1, 'concurrent lookups share one read');
  assert.equal(idb.stats.opens, idb.stats.closes, 'every connection is closed');
  page.dom.window.close();
});

test('content script: an empty first books read (cache still filling) is retried, not cached', async () => {
  const idb = fakeIndexedDB({ booksDelay: 20, booksSequence: [[], BOOKS] });
  const page = contentPage(idb);
  page.refresh();
  await sleep(500);
  const songs = page.received.filter((m) => m.type === 'song');
  assert.deepEqual(songs[0].song.books, [], 'the immediate reply had nothing to show yet');
  assert.deepEqual(songs.at(-1).song.books, [{ name: 'Hymnal', number: '12' }], 'the follow-up broadcast retried and found it');
  assert.equal(idb.stats.bookReads, 2);
  page.refresh();
  await sleep(400);
  assert.deepEqual(page.received.filter((m) => m.type === 'song').at(-1).song.books, [{ name: 'Hymnal', number: '12' }]);
  assert.equal(idb.stats.bookReads, 2, 'a non-empty index is cached');
  assert.equal(idb.stats.opens, idb.stats.closes);
  page.dom.window.close();
});
