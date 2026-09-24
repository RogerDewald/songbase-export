// The Song IR: one normalized shape that every renderer consumes.
//
// Song { irVersion, id, url, tune, title, books:[{name, number}], key, capo, transpose,
//        hasChords, chordsHidden, capturedAt, warnings[], groups:[{ parts: Part[] }] }
// Part = { type:'stanza'|'chorus', number?, lines: Line[] } | { type:'comment', text, capo? }
// Line = { text, chords:[{ at, name }], marks:[{ from, to, b?, i? }] }
//
// `groups` are the blank-line-separated blocks of the song; a group can mix a stanza
// with an indented refrain ("chorus" on Songbase means "indented lines").
// `at` is a UTF-16 offset into `text` and may exceed text.length (chord after the words).

import { detectKey } from './music.js';
import { isXmlInvalidChar, stripXmlInvalid } from './escape.js';

export const IR_VERSION = 1;

// Removes characters that no output format can carry (control characters, lone
// surrogates) and returns a map from old UTF-16 offsets to new ones, so chord and
// formatting offsets stay on the right characters.
function stripInvalidMapped(text) {
  const map = new Array(text.length + 1);
  let out = '';
  let i = 0;
  for (const ch of text) {
    map[i] = out.length;
    if (ch.length === 2) map[i + 1] = out.length;
    if (!isXmlInvalidChar(ch)) out += ch;
    i += ch.length;
  }
  map[text.length] = out.length;
  const at = (old) => (old <= text.length ? map[old] : out.length + (old - text.length));
  return { text: out, at };
}

function normalizeLine(line) {
  const cleaned = stripInvalidMapped(String(line?.text ?? ''));
  // NBSP and stray tabs become plain spaces, one for one, so chord offsets stay valid
  // and monospace output never depends on a tab width.
  const text = cleaned.text.replace(/[ \t]/g, ' ');
  const chords = (line?.chords || [])
    .map((c, i) => ({ at: cleaned.at(Math.max(0, Math.trunc(Number(c?.at) || 0))), name: stripXmlInvalid(c?.name).trim(), i }))
    .filter((c) => c.name)
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ at, name }) => ({ at, name }));
  const marks = [];
  for (const m of line?.marks || []) {
    const from = cleaned.at(Math.max(0, Math.trunc(Number(m?.from) || 0)));
    const to = Math.min(text.length, cleaned.at(Math.max(0, Math.trunc(Number(m?.to) || 0))));
    if (to > from && (m.b || m.i)) marks.push({ from, to, ...(m.b ? { b: true } : {}), ...(m.i ? { i: true } : {}) });
  }
  return { text, chords, marks };
}

function normalizePart(part) {
  if (part?.type === 'comment') {
    const text = stripXmlInvalid(part.text).replace(/\s+/g, ' ').trim();
    const capo = part.capo === null || part.capo === undefined || part.capo === '' ? NaN : Number(part.capo);
    if (Number.isFinite(capo)) return { type: 'comment', text: text || `Capo ${capo}`, capo };
    return text ? { type: 'comment', text } : null;
  }
  if (part?.type === 'stanza' || part?.type === 'chorus') {
    const lines = (part.lines || []).map(normalizeLine);
    if (!lines.length) return null;
    const out = { type: part.type, lines };
    const number = part.number === null || part.number === undefined ? '' : String(part.number).trim();
    if (number) out.number = number;
    return out;
  }
  return null;
}

export function normalizeSong(raw) {
  const groups = [];
  for (const group of raw?.groups || []) {
    const parts = (group?.parts || []).map(normalizePart).filter(Boolean);
    if (parts.length) groups.push({ parts });
  }
  const chordNames = [];
  let capo = null;
  for (const group of groups) {
    for (const part of group.parts) {
      if (part.type === 'comment') {
        if (capo === null && part.capo !== undefined) capo = part.capo;
        continue;
      }
      for (const line of part.lines) for (const c of line.chords) chordNames.push(c.name);
    }
  }
  const transpose = Number(raw?.transpose);
  return {
    irVersion: IR_VERSION,
    id: raw?.id ?? null,
    url: raw?.url ? String(raw.url) : null,
    tune: raw?.tune === null || raw?.tune === undefined || raw?.tune === '' ? null : String(raw.tune),
    title: stripXmlInvalid(raw?.title).replace(/\s+/g, ' ').trim() || 'Untitled song',
    books: (raw?.books || [])
      .filter((b) => b && b.name && b.number !== null && b.number !== undefined && String(b.number) !== '')
      .map((b) => ({ name: stripXmlInvalid(b.name), number: stripXmlInvalid(b.number) })),
    key: chordNames.length ? detectKey(chordNames) : null,
    capo,
    transpose: Number.isFinite(transpose) ? transpose : 0,
    hasChords: chordNames.length > 0,
    chordsHidden: Boolean(raw?.chordsHidden),
    capturedAt: raw?.capturedAt ? String(raw.capturedAt) : new Date().toISOString(),
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : [],
    groups,
  };
}

// Stored set-list snapshots go through here, so an older IR shape is upgraded (or
// rejected) in one place.
export function migrateSong(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.irVersion === IR_VERSION) return normalizeSong(obj);
  return null;
}

export const lyricParts = (group) => group.parts.filter((p) => p.type !== 'comment');

// 'chorus' when every lyric part of the group is indented, 'verse' otherwise,
// 'comment' when the group holds only comments.
export function groupKind(group) {
  const parts = lyricParts(group);
  if (!parts.length) return 'comment';
  return parts.every((p) => p.type === 'chorus') ? 'chorus' : 'verse';
}

export function hasNumbers(song) {
  return song.groups.some((g) => g.parts.some((p) => p.number));
}

export function maxNumberLength(song) {
  let max = 0;
  for (const g of song.groups) for (const p of g.parts) if (p.number) max = Math.max(max, p.number.length);
  return max;
}

// Identity used for set-list duplicate detection: same song, same tune, same chords as
// displayed (so the same song in a different key is NOT a duplicate).
export function songSig(song) {
  const chords = [];
  for (const g of song.groups) for (const p of lyricParts(g)) for (const l of p.lines) for (const c of l.chords) chords.push(c.name);
  return `${song.id ?? song.title}|${song.tune ?? ''}|${chords.slice(0, 60).join(',')}`;
}

// The short metadata line under a title: "Hymnal #12 · Key: D · Capo 2".
// Key and capo only mean something when chords are part of the output.
export function metaItems(song, { chords = false } = {}) {
  const items = song.books.map((b) => `${b.name} #${b.number}`);
  if (chords && song.hasChords) {
    if (song.key) items.push(`Key: ${song.key}`);
    if (song.capo !== null && song.capo !== undefined) items.push(`Capo ${song.capo}`);
  }
  return items;
}
