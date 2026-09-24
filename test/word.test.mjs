import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { renderWordHtml, wordOptions } from '../extension/shared/html.js';
import { buildDocxParts, renderDocx } from '../extension/shared/docx.js';
import { hymn, refrain, long } from './fixtures/songs.mjs';

const { DOMParser } = new JSDOM('').window;
const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parseHtml(html) {
  return new JSDOM(html).window.document;
}

test('word html: chords mode', () => {
  const doc = parseHtml(renderWordHtml(hymn(), { mode: 'chords' }));
  const h1 = doc.querySelectorAll('h1');
  assert.equal(h1.length, 1);
  assert.equal(h1[0].textContent, 'Placeholder Hymn of Testing');
  const paras = [...doc.querySelectorAll('p')];
  assert.equal(paras.length, 6, 'meta + 5 group parts (capo comment excluded)');
  assert.equal(paras[0].textContent, 'Hymnal #12 · Key: D · Capo 2');
  const verse = paras[2];
  assert.match(verse.getAttribute('style'), /font-family:'Consolas'/);
  assert.match(verse.getAttribute('style'), /mso-pagination:widow-orphan lines-together/);
  const chordSpan = verse.querySelector('span');
  assert.match(chordSpan.getAttribute('style'), /font-weight:bold;color:#1F4E79/);
  // Leading gutter spaces became NBSP so Word keeps them; text is otherwise intact.
  assert.equal(chordSpan.textContent, '   D           G               A');
  assert.equal(verse.innerHTML.split('<br>').length, 8, '4 chord rows + 4 lyric rows');
  assert.match(paras[1].getAttribute('style'), /font-style:italic/, 'comment paragraph');
});

test('word html: lyrics mode hanging numbers, chorus indent, keep-with-next inside groups', () => {
  const doc = parseHtml(renderWordHtml(refrain(), { mode: 'lyrics' }));
  const paras = [...doc.querySelectorAll('p')];
  assert.equal(paras.length, 1 + 4);
  const [, stanza, chorus, after] = paras;
  assert.match(stanza.getAttribute('style'), /margin:0in 0in 0pt 0in/, 'not last in group: no gap');
  assert.match(stanza.getAttribute('style'), /page-break-after:avoid/);
  assert.match(chorus.getAttribute('style'), /margin:0in 0in 0pt 0.35in/, 'refrain indented');
  assert.match(after.getAttribute('style'), /margin:0in 0in 10pt 0in/, 'last in group: gap');
  assert.doesNotMatch(after.getAttribute('style'), /page-break-after/);

  const numbered = parseHtml(renderWordHtml(hymn(), { mode: 'lyrics' }));
  const verse = [...numbered.querySelectorAll('p')][2];
  assert.match(verse.getAttribute('style'), /margin:0in 0in 10pt 0.35in;text-indent:-0.35in/);
  assert.equal(verse.querySelector('.sbx-num').textContent, '1');
  assert.match(verse.querySelector('.sbx-tab').getAttribute('style'), /mso-tab-count:1/);
  const chorusP = [...numbered.querySelectorAll('p')][3];
  assert.match(chorusP.getAttribute('style'), /margin:0in 0in 10pt 0.7in;text-indent:0in/);
  assert.equal(paras[0].textContent, ' ', 'meta line kept as spacer even when empty');
});

test('word html: set list page breaks, escaping, chord fallback', () => {
  const evil = hymn();
  evil.title = '<script>x</script> & "quotes"';
  const doc = parseHtml(renderWordHtml([evil, refrain(), long()], { mode: 'chords' }));
  const h1 = [...doc.querySelectorAll('h1')];
  assert.equal(h1.length, 3);
  assert.doesNotMatch(h1[0].getAttribute('style'), /page-break-before/);
  assert.match(h1[1].getAttribute('style'), /page-break-before:always/);
  assert.match(h1[2].getAttribute('style'), /page-break-before:always/);
  assert.equal(h1[0].textContent, '<script>x</script> & "quotes"');
  assert.equal(doc.querySelectorAll('script').length, 0);
  assert.equal(wordOptions(refrain(), { mode: 'chords' }).mode, 'lyrics', 'songs without chords fall back to lyrics');
});

test('docx: parts are well-formed XML with the expected structure', () => {
  const parts = buildDocxParts([hymn(), refrain(), long()], { mode: 'lyrics' });
  assert.equal(Object.keys(parts)[0], '[Content_Types].xml');
  for (const [name, xml] of Object.entries(parts)) {
    const doc = parseXml(xml);
    assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${name} parses`);
  }
  const doc = parseXml(parts['word/document.xml']);
  const paras = doc.getElementsByTagNameNS(W, 'p');
  assert.equal(paras.length, 7 + 6 + 3);
  assert.equal(doc.getElementsByTagNameNS(W, 'pageBreakBefore').length, 2);
  assert.equal(doc.getElementsByTagNameNS(W, 'tab').length, 3 + 1, 'one tab per numbered verse');
  const styles = parseXml(parts['word/styles.xml']);
  const ids = [...styles.getElementsByTagNameNS(W, 'style')].map((s) => s.getAttributeNS(W, 'styleId'));
  for (const id of ['Heading1', 'SongMeta', 'SongComment', 'Verse', 'Chorus', 'VerseMono', 'ChorusMono', 'Chord', 'VerseNumber']) {
    assert.ok(ids.includes(id), `style ${id}`);
  }
  assert.match(parts['word/settings.xml'], /compatibilityMode" w:uri="http:\/\/schemas.microsoft.com\/office\/word" w:val="15"/);
});

test('docx: chords mode uses the Chord character style and keeps spacing', () => {
  const parts = buildDocxParts(hymn(), { mode: 'chords', chordColor: true });
  const doc = parseXml(parts['word/document.xml']);
  const chordRuns = [...doc.getElementsByTagNameNS(W, 'rStyle')].filter((e) => e.getAttributeNS(W, 'val') === 'Chord');
  assert.equal(chordRuns.length, 4 + 2, 'one chord row per chorded line');
  const texts = [...doc.getElementsByTagNameNS(W, 't')].map((t) => t.textContent);
  assert.ok(texts.includes('   D           G               A'), 'spaces preserved verbatim');
  assert.ok(texts.every((t) => !t.includes(' ')), 'no NBSP needed in docx');
  assert.match(parts['word/styles.xml'], /w:styleId="Chord".*?<w:color w:val="1F4E79"\/>/);
});

test('docx: escaping and invalid XML characters', () => {
  const s = refrain();
  s.title = 'A < B & C > "D" \u0007bell';
  const parts = buildDocxParts(s, {});
  const doc = parseXml(parts['word/document.xml']);
  assert.equal(doc.getElementsByTagName('parsererror').length, 0);
  assert.equal(doc.getElementsByTagNameNS(W, 't')[0].textContent, 'A < B & C > "D" bell');
});

test('docx: zips and re-opens', async () => {
  const buf = await renderDocx([hymn(), long()], { page: 'a4' }, JSZip, 'nodebuffer');
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
  const zip = await JSZip.loadAsync(buf);
  assert.deepEqual(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/settings.xml',
    'word/styles.xml',
  ]);
  const docXml = await zip.file('word/document.xml').async('string');
  assert.match(docXml, /<w:pgSz w:w="11906" w:h="16838"\/>/, 'A4');
});
