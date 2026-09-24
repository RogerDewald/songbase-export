import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryArea } from '../extension/shared/storage.js';
import { mergePrefs, createPrefsStore, DEFAULT_PREFS, PREFS_KEY } from '../extension/shared/prefs.js';
import { createSetListStore, SETLIST_KEY } from '../extension/shared/setlist.js';
import { normalizeSong } from '../extension/shared/ir.js';
import { hymn, refrain } from './fixtures/songs.mjs';

test('prefs: defaults, validation, theme colours', () => {
  assert.deepEqual(mergePrefs(undefined), DEFAULT_PREFS);
  const p = mergePrefs({
    word: { font: 'Evil\'; font-family:x', sizePt: 99, mode: 'lyrics', chordColor: false },
    text: { style: 'chordpro', chorusIndent: 2 },
    pptx: { theme: 'light', bg: 'zzzzzz', maxPt: 40, minPt: 50, maxLines: 6 },
    junk: { a: 1 },
  });
  assert.equal(p.word.font, 'Calibri', 'unknown font rejected');
  assert.equal(p.word.sizePt, 12, 'out-of-range size rejected');
  assert.equal(p.word.mode, 'lyrics');
  assert.equal(p.word.chordColor, false);
  assert.equal(p.text.style, 'chordpro');
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
