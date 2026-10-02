// Plain-text renderings: 'lyrics' (numbers + indented chorus) and 'chords' (monospace chord
// rows over lyric rows).

import { metaItems } from './ir.js';
import { partRows, songGutter } from './layout.js';

export const TEXT_STYLES = ['lyrics', 'chords'];

const DEFAULTS = { style: 'chords', chorusIndent: 4, numbers: true, meta: true, comments: true, eol: '\r\n' };

export function renderText(songs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const list = Array.isArray(songs) ? songs : [songs];
  return list.map((s) => monoLines(s, o).join(o.eol)).join(o.eol.repeat(3));
}

// Rows for one song in 'lyrics' or 'chords' style (also reused by previews).
export function monoLines(song, o) {
  const chords = o.style === 'chords' && song.hasChords;
  const lines = [song.title];
  if (o.meta) {
    const meta = metaItems(song, { chords });
    if (meta.length) lines.push(meta.join(' · '));
  }
  const gutter = songGutter(song, { numbers: o.numbers });
  const pad = ' '.repeat(gutter);
  for (const group of song.groups) {
    const rows = [];
    for (const part of group.parts) {
      if (part.type === 'comment') {
        if (o.comments && part.capo === undefined) rows.push(pad + part.text);
        continue;
      }
      const opts = { chords, numbers: o.numbers, gutter, chorusIndent: o.chorusIndent, tie: chords ? '_' : '‿' };
      for (const row of partRows(part, opts)) rows.push(row.text);
    }
    if (rows.length) lines.push('', ...rows);
  }
  return lines;
}
