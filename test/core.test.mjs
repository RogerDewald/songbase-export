import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, escapeXml, nbspRuns } from '../extension/shared/escape.js';
import { safeFileName } from '../extension/shared/filename.js';
import { detectKey, chordRoot } from '../extension/shared/music.js';
import { normalizeSong, migrateSong, groupKind, songSig, metaItems, IR_VERSION } from '../extension/shared/ir.js';
import { alignLine, partRows, songGutter, inlineChordLine } from '../extension/shared/layout.js';
import { renderText } from '../extension/shared/text.js';
import { line } from './helpers.mjs';
import { hymn, refrain, HYMN_MARKUP } from './fixtures/songs.mjs';

const LF = { eol: '\n' };

test('escape: html, xml, nbsp runs', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jo'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jo&#39;&lt;/a&gt;');
  assert.equal(escapeXml('a\u0001b<c>&￾'), 'ab&lt;c&gt;&amp;');
  assert.equal(escapeXml('ok 🎵 note'), 'ok 🎵 note', 'astral chars survive');
  assert.equal(escapeXml('lone \uD800 surrogate'), 'lone  surrogate');
  assert.equal(nbspRuns('   G    C'), '&nbsp;&nbsp;&nbsp;G&nbsp;&nbsp;&nbsp; C');
  assert.equal(nbspRuns('a b'), 'a b', 'single spaces untouched');
});

test('filename: windows-safe', () => {
  assert.equal(safeFileName('Con', 'txt'), '_Con.txt');
  assert.equal(safeFileName('a/b:c?*"d"', 'pptx'), 'a b c d.pptx');
  assert.equal(safeFileName('  ...Trailing dots...  ', 'docx'), 'Trailing dots.docx');
  assert.equal(safeFileName('', 'txt'), 'song.txt');
  assert.equal(safeFileName('x'.repeat(300), 'txt').length, 124);
});

test('key: parity with the site', () => {
  const site = (chords) => detectKey(chords, { sitePure: true });
  assert.equal(site(['G', 'C', 'D', 'G']), 'G', 'first == last, major');
  assert.equal(site(['Am', 'F', 'C', 'G', 'Am']), 'C', 'first == last, minor -> relative major');
  assert.equal(site(['D', 'G', 'A', 'Bm']), 'D', 'best common-chord match');
  assert.equal(site(['Bb/D', 'Eb', 'F7', 'Gm']), 'Bb', 'slash chords use the first root');
  assert.equal(site([]), null);
  assert.equal(site(['-', ' G']), null, 'names not starting with A-G are ignored, like the site');
});

test('key: the two deliberate fixes', () => {
  // Site quirk 1: C#m falls off the flat-spelled table and returns B.
  assert.equal(detectKey(['C#m', 'E', 'A', 'C#m'], { sitePure: true }), 'B');
  assert.equal(detectKey(['C#m', 'E', 'A', 'C#m']), 'E');
  // Site quirk 2: [Dmaj7] is read as D minor.
  assert.equal(detectKey(['Dmaj7', 'Em', 'A', 'Dmaj7'], { sitePure: true }), 'F');
  assert.equal(detectKey(['Dmaj7', 'Em', 'A', 'Dmaj7']), 'D');
  assert.equal(chordRoot('Dmaj7'), 'D');
  assert.equal(chordRoot('Dm7'), 'Dm');
  // Sharp-spelled songs get a sharp key name.
  assert.equal(detectKey(['F#', 'B', 'C#', 'D#m', 'G#m']), 'F#');
});

test('ir: normalize drops empty chords, sorts, derives key/capo/hasChords', () => {
  const song = normalizeSong({
    id: 7,
    title: '  Spaced   title ',
    groups: [
      { parts: [{ type: 'comment', text: 'Capo 3', capo: '3' }] },
      { parts: [{ type: 'stanza', number: 1, lines: [{ text: 'Words here', chords: [{ at: 6, name: 'D' }, { at: 0, name: 'G' }, { at: 2, name: ' ' }] }] }] },
      { parts: [] },
    ],
  });
  assert.equal(song.irVersion, IR_VERSION);
  assert.equal(song.title, 'Spaced title');
  assert.equal(song.groups.length, 2, 'empty group dropped');
  assert.deepEqual(song.groups[1].parts[0].lines[0].chords, [{ at: 0, name: 'G' }, { at: 6, name: 'D' }]);
  assert.equal(song.groups[1].parts[0].lines[0].text, 'Words here', 'NBSP -> space');
  assert.equal(song.groups[1].parts[0].number, '1');
  assert.equal(song.capo, 3);
  assert.equal(song.hasChords, true);
  // G then D: keys D and G tie on common chords; ties go to the earlier KEYS entry (D), as on the site.
  assert.equal(song.key, 'D');
  assert.equal(detectKey(['G', 'D'], { sitePure: true }), 'D');
  assert.deepEqual(migrateSong(JSON.parse(JSON.stringify(song))), song);
  assert.equal(migrateSong({ irVersion: 999 }), null);
});

test('ir: group kinds, signature, meta line', () => {
  const s = hymn();
  assert.deepEqual(s.groups.map(groupKind), ['comment', 'verse', 'chorus', 'verse', 'verse']);
  assert.deepEqual(refrain().groups.map(groupKind), ['verse', 'verse'], 'refrain inside a verse group stays a verse');
  assert.match(songSig(s), /^101\|\|D,G,A,/);
  assert.deepEqual(metaItems(s, { chords: true }), ['Hymnal #12', 'Key: D', 'Capo 2']);
  assert.deepEqual(metaItems(s, { chords: false }), ['Hymnal #12']);
});

test('layout: chord alignment cases', () => {
  const cases = [
    { name: 'simple', l: line('Hello world', [{ at: 0, name: 'G' }, { at: 6, name: 'C' }]), chord: 'G     C', lyric: 'Hello world' },
    { name: 'collision inside a word pads with hyphens', l: line('This is', [{ at: 1, name: 'Am7' }, { at: 3, name: 'D' }]), chord: ' Am7 D', lyric: 'Thi--s is' },
    { name: 'collision at a space pads with spaces', l: line('Go on', [{ at: 0, name: 'Gmaj7' }, { at: 3, name: 'C' }]), chord: 'Gmaj7 C', lyric: 'Go    on' },
    { name: 'chord past the end', l: line('End', [{ at: 0, name: 'C' }, { at: 5, name: 'G' }]), chord: 'C    G', lyric: 'End' },
    { name: 'chord-only line', l: line('   ', [{ at: 0, name: 'G' }, { at: 2, name: 'C' }]), chord: 'G C', lyric: null },
    { name: 'two chords at one offset', l: line('Word', [{ at: 0, name: 'G' }, { at: 0, name: 'D' }]), chord: 'G D', lyric: '  Word' },
    { name: 'no chords', l: line('Just words  '), chord: null, lyric: 'Just words' },
    { name: 'tie becomes underscore in monospace', l: line('to‿gether', [{ at: 3, name: 'F' }]), chord: '   F', lyric: 'to_gether' },
  ];
  for (const c of cases) {
    assert.deepEqual(alignLine(c.l), { chord: c.chord, lyric: c.lyric }, c.name);
  }
  // Every chord must still sit over its original character after padding.
  const l = line('Singing along again', [{ at: 0, name: 'Cmaj7' }, { at: 2, name: 'Dm' }, { at: 4, name: 'G7' }, { at: 8, name: 'C' }]);
  const { chord, lyric } = alignLine(l);
  const letters = [];
  for (let col = 0; col < chord.length; col++) {
    if (chord[col] !== ' ' && (col === 0 || chord[col - 1] === ' ')) letters.push(lyric[col]);
  }
  assert.deepEqual(letters, ['S', 'n', 'i', 'a'], `chords over the right letters: ${chord} / ${lyric}`);
});

test('layout: gutter numbers sit on the first lyric row; chorus indents', () => {
  const s = hymn();
  const gutter = songGutter(s);
  assert.equal(gutter, 3);
  const verse = partRows(s.groups[1].parts[0], { gutter });
  assert.equal(verse[0].kind, 'chord');
  assert.equal(verse[0].text, '   D           G               A');
  assert.equal(verse[1].text, '1  This is the opening line of verse one');
  assert.equal(verse[1].number, '1');
  assert.equal(verse[3].text, '   The second line keeps the test going');
  const chorus = partRows(s.groups[2].parts[0], { gutter });
  assert.equal(chorus[0].text, '       G                D');
  assert.equal(chorus[1].text, '       Chorus words are indented here');
  const plain = partRows(s.groups[1].parts[0], { gutter, chords: false });
  assert.equal(plain.length, 4);
  assert.ok(plain.every((r) => r.kind === 'lyric'));
});

test('layout: inline chord lines round-trip the source markup', () => {
  const s = hymn();
  const markupLines = HYMN_MARKUP.split('\n').filter((l) => /\[/.test(l)).map((l) => l.replace(/^ {2}/, ''));
  const rendered = s.groups.flatMap((g) => g.parts.flatMap((p) => (p.lines || []).filter((l) => l.chords.length).map(inlineChordLine)));
  assert.deepEqual(rendered, markupLines);
  assert.equal(inlineChordLine(line('End', [{ at: 5, name: 'G' }])), 'End  [G]');
});

test('text: chords style', () => {
  const out = renderText(hymn(), { style: 'chords', ...LF }).split('\n');
  assert.equal(out[0], 'Placeholder Hymn of Testing');
  assert.equal(out[1], 'Hymnal #12 · Key: D · Capo 2');
  assert.equal(out[2], '');
  assert.equal(out[3], '   Tune: Placeholder melody');
  assert.equal(out[4], '');
  assert.equal(out[5], '   D           G               A');
  assert.equal(out[6], '1  This is the opening line of verse one');
  assert.ok(!out.some((l) => /Capo 2$/.test(l) && l !== out[1]), 'capo only in the meta line');
  assert.ok(out.includes('2  Second verse has no chords at all'));
  assert.ok(out.includes('       Chorus words are indented here'));
});

test('text: lyrics style drops chords, key and capo', () => {
  const out = renderText(hymn(), { style: 'lyrics', ...LF }).split('\n');
  assert.equal(out[1], 'Hymnal #12');
  assert.ok(out.includes('1  This is the opening line of verse one'));
  assert.ok(!out.some((l) => /^\s*[A-G]\s{2,}/.test(l)), 'no chord rows');
});

test('text: refrain inside a verse, ties, no numbers, chords style falls back', () => {
  const expected = [
    'Song With A Refrain',
    '',
    'Opening words of a song without numbers',
    'Here a tie joins two‿words together',
    '    An indented refrain line inside the verse',
    'Back to the verse for the closing line',
    '',
    'Second group opening line',
    'Second group closing line',
  ].join('\n');
  assert.equal(renderText(refrain(), { style: 'lyrics', ...LF }), expected);
  assert.equal(renderText(refrain(), { style: 'chords', ...LF }), expected);
});

test('text: chordpro', () => {
  const out = renderText(hymn(), { style: 'chordpro', ...LF }).split('\n');
  assert.deepEqual(out.slice(0, 4), ['{title: Placeholder Hymn of Testing}', '{subtitle: Hymnal #12}', '{key: D}', '{capo: 2}']);
  assert.ok(out.includes('{comment: Tune: Placeholder melody}'));
  assert.ok(out.includes('{start_of_verse: Verse 1}'));
  assert.ok(out.includes('[D]This is the [G]opening line of [A]verse one'));
  assert.ok(out.includes('{start_of_chorus}'));
  assert.equal(out.filter((l) => l === '{end_of_verse}').length, 3);
});

test('text: set list joins songs; CRLF by default', () => {
  const two = renderText([hymn(), refrain()], { style: 'lyrics' });
  assert.ok(two.includes('\r\n\r\n\r\nSong With A Refrain'));
  assert.ok(!/[^\r]\n/.test(two), 'every newline is CRLF');
  const pro = renderText([hymn(), refrain()], { style: 'chordpro', ...LF });
  assert.equal(pro.split('{new_song}').length, 2);
});
