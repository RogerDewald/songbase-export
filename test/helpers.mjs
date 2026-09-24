// Test-only helpers. Fixtures are written in Songbase's markup (the site's own grammar:
// [chords] inline, a digits-only line = verse number, two leading spaces = indented
// "chorus" line, # = comment, "capo N" = capo preset, blank line = group break) and
// contain ORIGINAL placeholder words only — never real song lyrics.
import { normalizeSong } from '../extension/shared/ir.js';

export function songFromMarkup(markup, meta = {}) {
  const groups = [];
  let group = null;
  let part = null;
  let pendingNumber = null;
  for (const raw of markup.replace(/\r/g, '').split('\n')) {
    if (/^\s*$/.test(raw)) {
      group = null;
      part = null;
      continue;
    }
    if (!group) {
      group = { parts: [] };
      groups.push(group);
    }
    const capo = /capo (\d+)/i.exec(raw);
    if (capo) {
      group.parts.push({ type: 'comment', text: `Capo ${capo[1]}`, capo: Number(capo[1]) });
      part = null;
      continue;
    }
    if (raw.startsWith('#')) {
      group.parts.push({ type: 'comment', text: raw.replace(/^# ?/, '') });
      part = null;
      continue;
    }
    if (/^\d+$/.test(raw)) {
      pendingNumber = raw;
      part = null;
      continue;
    }
    const type = raw.startsWith('  ') ? 'chorus' : 'stanza';
    if (!part || part.type !== type) {
      part = { type, lines: [] };
      if (type === 'stanza' && pendingNumber) {
        part.number = pendingNumber;
        pendingNumber = null;
      }
      group.parts.push(part);
    }
    part.lines.push(parseLine(type === 'chorus' ? raw.slice(2) : raw));
  }
  return normalizeSong({ id: 1, title: 'Test Song', ...meta, groups });
}

function parseLine(markup) {
  // Like the site: **bold** / *italic* markers are formatting, not text.
  const src = markup.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  let text = '';
  const chords = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    text += src.slice(last, m.index);
    chords.push({ at: text.length, name: m[1] });
    last = re.lastIndex;
  }
  text += src.slice(last);
  return { text: text.replace(/_/g, '‿'), chords, marks: [] };
}

export const line = (text, chords = [], marks = []) => ({ text, chords, marks });
