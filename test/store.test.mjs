import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryArea } from '../extension/shared/storage.js';
import { mergePrefs, createPrefsStore, DEFAULT_PREFS, PREFS_KEY } from '../extension/shared/prefs.js';
import { createSetListStore, SETLIST_KEY } from '../extension/shared/setlist.js';
import { normalizeSong } from '../extension/shared/ir.js';
import { hymn, refrain, long } from './fixtures/songs.mjs';

test('prefs: defaults, validation, theme colours', () => {
  assert.deepEqual(mergePrefs(undefined), DEFAULT_PREFS);
  const p = mergePrefs({
    word: { font: 'Evil\'; font-family:x', sizePt: 99, mode: 'lyrics', chordColor: false },
    text: { style: 'lyrics', chorusIndent: 2 },
    pptx: { theme: 'light', bg: 'zzzzzz', maxPt: 40, minPt: 50, maxLines: 6 },
    junk: { a: 1 },
  });
  assert.equal(p.word.font, 'Calibri', 'unknown font rejected');
  assert.equal(p.word.sizePt, 12, 'out-of-range size rejected');
  assert.equal(p.word.mode, 'lyrics');
  assert.equal(p.word.chordColor, false);
  assert.equal(p.text.style, 'lyrics');
  assert.equal(mergePrefs({ text: { style: 'chordpro' } }).text.style, 'chords', 'the removed ChordPro style falls back to the default');
  assert.deepEqual([p.pptx.bg, p.pptx.fg], ['FFFFFF', '000000'], 'named theme sets colours');
  assert.equal(p.pptx.minPt, 40, 'min never above max');
  assert.equal(p.junk, undefined);
  const custom = mergePrefs({ pptx: { theme: 'custom', bg: '112233', fg: 'abcdef' } });
  assert.deepEqual([custom.pptx.bg, custom.pptx.fg], ['112233', 'ABCDEF']);
});

test('prefs: store persists and notifies', async () => {
  const area = memoryArea();
  const store = createPrefsStore(area);
  await store.load();
  const seen = [];
  store.subscribe((p) => seen.push(p.text.style));
  await store.update('text', { style: 'lyrics' });
  assert.equal(area.data[PREFS_KEY].text.style, 'lyrics');
  assert.deepEqual(seen, ['lyrics']);
  const again = createPrefsStore(area);
  assert.equal((await again.load()).text.style, 'lyrics');
});

test('set list: add, duplicate detection, force, reorder, remove, rename, clear', async () => {
  const area = memoryArea();
  let n = 0;
  const store = createSetListStore(area, { uid: () => `u${++n}`, now: () => '2026-09-23T00:00:00Z' });
  await store.load();
  assert.deepEqual(store.get().items, []);
  assert.deepEqual(await store.add(hymn()), { added: 'u1' });
  assert.deepEqual(await store.add(refrain()), { added: 'u2' });
  assert.deepEqual(await store.add(hymn()), { duplicate: 'u1' }, 'same song, same chords');

  const transposed = hymn();
  transposed.groups[1].parts[0].lines[0].chords[0].name = 'Eb';
  assert.deepEqual(await store.add(normalizeSong(transposed)), { added: 'u3' }, 'a different key is not a duplicate');
  assert.deepEqual(await store.add(hymn(), { force: true }), { added: 'u4' });

  await store.move('u2', -1);
  assert.deepEqual(store.get().items.map((i) => i.uid), ['u2', 'u1', 'u3', 'u4']);
  await store.move('u2', -1);
  assert.deepEqual(store.get().items.map((i) => i.uid), ['u2', 'u1', 'u3', 'u4'], 'cannot move past the top');
  await store.remove('u3');
  await store.rename('  Sunday meeting  ');
  assert.equal(store.get().name, 'Sunday meeting');
  assert.equal(area.data[SETLIST_KEY].items.length, 3);

  const reloaded = createSetListStore(area);
  const loaded = await reloaded.load();
  assert.equal(loaded.items.length, 3);
  assert.equal(loaded.items[0].song.title, 'Song With A Refrain');
  await reloaded.clear();
  assert.equal(area.data[SETLIST_KEY].items.length, 0);
});

test('set list: drag-and-drop moves an item to an exact position', async () => {
  const store = createSetListStore(memoryArea(), { uid: (() => { let n = 0; return () => `u${++n}`; })() });
  await store.load();
  for (const s of [hymn(), refrain(), long(), hymn()]) await store.add(s, { force: true });
  const order = () => store.get().items.map((i) => i.uid).join(',');
  assert.equal(order(), 'u1,u2,u3,u4');
  await store.moveTo('u4', 0);
  assert.equal(order(), 'u4,u1,u2,u3', 'to the top');
  await store.moveTo('u4', 3);
  assert.equal(order(), 'u1,u2,u3,u4', 'to the end');
  await store.moveTo('u1', 2);
  assert.equal(order(), 'u2,u3,u1,u4', 'index counts the list without the dragged item');
  await store.moveTo('u2', 99);
  assert.equal(order(), 'u3,u1,u4,u2', 'past the end clamps');
  await store.moveTo('u3', -5);
  assert.equal(order(), 'u3,u1,u4,u2', 'before the start clamps');
  const stamp = store.get().updatedAt;
  await store.moveTo('u3', 0);
  assert.equal(store.get().updatedAt, stamp, 'dropping an item where it was writes nothing');
  await store.moveTo('nope', 1);
  assert.equal(order(), 'u3,u1,u4,u2', 'unknown id is ignored');
});

test('set list: Undo puts removed items back where they were, once', async () => {
  const store = createSetListStore(memoryArea(), { uid: (() => { let n = 0; return () => `u${++n}`; })() });
  await store.load();
  for (const s of [hymn(), refrain(), long()]) await store.add(s, { force: true });
  const [a, b, c] = store.get().items;
  const order = () => store.get().items.map((i) => i.uid).join(',');

  await store.remove('u2');
  assert.equal(order(), 'u1,u3');
  assert.equal(await store.insert([b], 1), 1, 'restored');
  assert.equal(order(), 'u1,u2,u3', 'back at its old position');
  assert.equal(await store.insert([b], 1), 0, 'a second Undo does not duplicate it');
  assert.equal(order(), 'u1,u2,u3');

  const before = store.get().items;
  await store.clear();
  await store.add(long(), { force: true }); // added since clearing
  assert.equal(await store.insert(before, 0), 3);
  assert.deepEqual(store.get().items.map((i) => i.song.title), ['Placeholder Hymn of Testing', 'Song With A Refrain', 'A Very Long Stanza', 'A Very Long Stanza'], 'cleared songs return in front of newer ones');
  assert.equal(await store.insert([{ uid: 'x', song: { irVersion: 99 } }, null, c], 0), 0, 'junk is dropped; songs already present are skipped');
  assert.equal(a.uid, 'u1');
});

test('prefs: which option panels are open is remembered, and validated', () => {
  assert.deepEqual([DEFAULT_PREFS.ui.optsWord, DEFAULT_PREFS.ui.optsText, DEFAULT_PREFS.ui.optsPptx], [false, false, false]);
  const p = mergePrefs({ ui: { optsWord: true, optsText: 'yes', optsPptx: 1 } });
  assert.deepEqual([p.ui.optsWord, p.ui.optsText, p.ui.optsPptx], [true, false, false], 'only real booleans are accepted');
});

test('set list: corrupt or old data is dropped, never thrown', async () => {
  const area = memoryArea({
    [SETLIST_KEY]: { schema: 1, name: 5, items: [{ uid: 'ok', song: hymn() }, { uid: 'bad', song: { irVersion: 99 } }, null, { song: hymn() }] },
  });
  const store = createSetListStore(area);
  const loaded = await store.load();
  assert.deepEqual(loaded.items.map((i) => i.uid), ['ok']);
  assert.equal(loaded.name, 'Set list');
  const garbage = createSetListStore(memoryArea({ [SETLIST_KEY]: 'nonsense' }));
  assert.deepEqual((await garbage.load()).items, []);
});

test('prefs: 0.2 (schema 1) data keeps its format, and its set-list scope becomes the Set list tab', () => {
  assert.equal(DEFAULT_PREFS.ui.format, 'text', 'Text is the default format');
  assert.equal(DEFAULT_PREFS.schema, 2);
  // Schema 1 stored no `schema` field at all in practice; both spellings are 0.2 data.
  for (const old of [{ ui: { tab: 'pptx', scope: 'setlist' } }, { schema: 1, ui: { tab: 'pptx', scope: 'setlist' } }]) {
    const p = mergePrefs(old);
    assert.equal(p.ui.tab, 'setlist', 'was exporting the set list: still is');
    assert.equal(p.ui.format, 'pptx');
    assert.equal(p.schema, 2, 'rewritten at the current schema');
    assert.equal('scope' in p.ui, false, 'the old scope switch is gone: the tab is the scope');
  }
  assert.deepEqual([mergePrefs({ ui: { tab: 'word', scope: 'song' } }).ui.tab, mergePrefs({ ui: { tab: 'word', scope: 'song' } }).ui.format], ['song', 'word']);
  assert.equal(mergePrefs({ ui: { tab: 'setlist', scope: 'song' } }).ui.tab, 'setlist', 'the old Set list tab stays the Set list tab');
  assert.equal(mergePrefs({ ui: { tab: 'word' } }).ui.tab, 'song', 'no scope stored: this song');
  // Current data is left alone, format and all.
  assert.deepEqual(mergePrefs({ schema: 2, ui: { tab: 'song', format: 'pptx' } }).ui, { ...DEFAULT_PREFS.ui, format: 'pptx' });
  assert.deepEqual(mergePrefs({ ui: { tab: 'nonsense', format: 'pdf' } }).ui, DEFAULT_PREFS.ui);
});
