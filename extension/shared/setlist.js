// The set list: song snapshots collected across pages, stored as `sbx.setlist`.
// A snapshot keeps the song exactly as it was displayed when added (transpose included).

import { migrateSong, normalizeSong, songSig } from './ir.js';

export const SETLIST_KEY = 'sbx.setlist';
export const SETLIST_SCHEMA = 1;

const empty = () => ({ schema: SETLIST_SCHEMA, name: 'Set list', updatedAt: null, items: [] });

function clean(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== SETLIST_SCHEMA || !Array.isArray(raw.items)) return empty();
  const items = [];
  for (const item of raw.items) {
    const song = migrateSong(item?.song);
    if (song && typeof item.uid === 'string') items.push({ uid: item.uid, addedAt: String(item.addedAt || ''), song });
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Set list';
  return { schema: SETLIST_SCHEMA, name, updatedAt: raw.updatedAt || null, items };
}

export function createSetListStore(area, { now = () => new Date().toISOString(), uid = () => crypto.randomUUID() } = {}) {
  let current = empty();
  const save = async (next) => {
    current = { ...next, updatedAt: now() };
    await area.set(SETLIST_KEY, current);
    return current;
  };
  return {
    async load() {
      current = clean(await area.get(SETLIST_KEY));
      return current;
    },
    get: () => current,
    findDuplicate(song) {
      const sig = songSig(song);
      return current.items.find((it) => songSig(it.song) === sig) || null;
    },
    // Adds a snapshot. Returns { added } or { duplicate } unless `force` is set.
    async add(song, { force = false } = {}) {
      const snapshot = normalizeSong(song);
      const dup = this.findDuplicate(snapshot);
      if (dup && !force) return { duplicate: dup.uid };
      const item = { uid: uid(), addedAt: now(), song: snapshot };
      await save({ ...current, items: [...current.items, item] });
      return { added: item.uid };
    },
    async replaceSong(itemUid, song) {
      await save({ ...current, items: current.items.map((it) => (it.uid === itemUid ? { ...it, song: normalizeSong(song) } : it)) });
    },
    async remove(itemUid) {
      await save({ ...current, items: current.items.filter((it) => it.uid !== itemUid) });
    },
    async move(itemUid, delta) {
      const items = [...current.items];
      const i = items.findIndex((it) => it.uid === itemUid);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      await save({ ...current, items });
    },
    // Drag and drop: the item ends up at `index` (0-based, counted in the list without it).
    async moveTo(itemUid, index) {
      const items = [...current.items];
      const from = items.findIndex((it) => it.uid === itemUid);
      if (from < 0) return;
      const [item] = items.splice(from, 1);
      const to = Math.max(0, Math.min(Math.trunc(index) || 0, items.length));
      if (to === from) return;
      items.splice(to, 0, item);
      await save({ ...current, items });
    },
    // Puts removed items back (Undo). Items already present are skipped, so undoing twice, or
    // after the song was added again, cannot duplicate one. Returns how many came back.
    async insert(items, index = 0) {
      const have = new Set(current.items.map((it) => it.uid));
      const back = clean({ schema: SETLIST_SCHEMA, items }).items.filter((it) => !have.has(it.uid));
      if (!back.length) return 0;
      const next = [...current.items];
      next.splice(Math.max(0, Math.min(Math.trunc(index) || 0, next.length)), 0, ...back);
      await save({ ...current, items: next });
      return back.length;
    },
    async rename(name) {
      await save({ ...current, name: String(name || '').trim().slice(0, 80) || 'Set list' });
    },
    async clear() {
      await save({ ...current, items: [] });
    },
    subscribe(cb) {
      return area.subscribe(SETLIST_KEY, (v) => {
        current = clean(v);
        cb(current);
      });
    },
  };
}
