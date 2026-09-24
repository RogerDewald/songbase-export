// Plain-text renderings: 'lyrics' (numbers + indented chorus), 'chords' (monospace chord
// rows over lyric rows) and 'chordpro' (for OnSong / SongbookPro / Planning Center ...).

import { metaItems } from './ir.js';
import { partRows, songGutter, inlineChordLine, lyricText } from './layout.js';

export const TEXT_STYLES = ['lyrics', 'chords', 'chordpro'];

const DEFAULTS = { style: 'chords', chorusIndent: 4, numbers: true, meta: true, comments: true, eol: '\r\n' };

export function renderText(songs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const list = Array.isArray(songs) ? songs : [songs];
  if (o.style === 'chordpro') {
    return list.map((s) => chordProLines(s, o).join(o.eol)).join(`${o.eol}${o.eol}{new_song}${o.eol}${o.eol}`);
  }
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

const directiveValue = (s) => String(s).replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).trim();

export function chordProLines(song, o) {
  const lines = [`{title: ${directiveValue(song.title)}}`];
  if (o.meta) {
    for (const b of song.books) lines.push(`{subtitle: ${directiveValue(`${b.name} #${b.number}`)}}`);
    if (song.hasChords && song.key) lines.push(`{key: ${directiveValue(song.key)}}`);
    if (song.hasChords && song.capo !== null && song.capo !== undefined) lines.push(`{capo: ${song.capo}}`);
  }
  for (const group of song.groups) {
    const block = [];
    for (const part of group.parts) {
      if (part.type === 'comment') {
        if (o.comments && part.capo === undefined) block.push(`{comment: ${directiveValue(part.text)}}`);
        continue;
      }
      const chorus = part.type === 'chorus';
      block.push(chorus ? '{start_of_chorus}' : part.number ? `{start_of_verse: Verse ${part.number}}` : '{start_of_verse}');
      for (const line of part.lines) {
        block.push((song.hasChords ? inlineChordLine(line) : lyricText(line)).replace(/\s+$/, ''));
      }
      block.push(chorus ? '{end_of_chorus}' : '{end_of_verse}');
    }
    if (block.length) lines.push('', ...block);
  }
  return lines;
}
