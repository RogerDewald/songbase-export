// Minimal WordprocessingML (.docx) with NAMED styles, so a user can restyle every chord,
// verse or title in Word with one click. Zipped with JSZip (passed in, so the same code
// runs in the panel and in Node tests).
//
// OOXML is order-sensitive: pPr = pStyle, keepNext, keepLines, pageBreakBefore, spacing,
// ind; rPr = rStyle, rFonts, b, bCs, i, iCs, color, sz, szCs; style = name, basedOn, next,
// uiPriority, qFormat, pPr, rPr. Units: twips (1440/in), half-points (sz 24 = 12pt).

import { escapeXml } from './escape.js';
import { metaItems } from './ir.js';
import { songGutter } from './layout.js';
import { wordOptions, groupBlocks, CHORD_COLOR } from './html.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const HANG = 504; // 0.35in: verse-number hanging indent and chorus step
const GROUP_GAP = 200; // twips after the last paragraph of a group (10pt)
const PAGE = { letter: { w: 12240, h: 15840 }, a4: { w: 11906, h: 16838 } };

const wt = (text) => `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`;
const BR = '<w:r><w:br/></w:r>';
const TAB = '<w:r><w:tab/></w:r>';

function run(text, { style = null, b = false, i = false } = {}) {
  let rPr = '';
  if (style) rPr += `<w:rStyle w:val="${style}"/>`;
  if (b) rPr += '<w:b/><w:bCs/>';
  if (i) rPr += '<w:i/><w:iCs/>';
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${wt(text)}</w:r>`;
}

function para(style, content, { keepNext = false, pageBreakBefore = false, spacingAfter = null, ind = null } = {}) {
  let pPr = `<w:pStyle w:val="${style}"/>`;
  if (keepNext) pPr += '<w:keepNext/>';
  if (pageBreakBefore) pPr += '<w:pageBreakBefore/>';
  if (spacingAfter !== null) pPr += `<w:spacing w:after="${spacingAfter}"/>`;
  if (ind) pPr += `<w:ind w:left="${ind.left}" w:hanging="${ind.hanging}"/>`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;
}

// Runs for one lyric line, honouring bold/italic marks.
function lineRuns(line, italicAll) {
  const text = line.text.replace(/\s+$/, '');
  if (!text) return '';
  const cuts = new Set([0, text.length]);
  for (const m of line.marks) {
    cuts.add(Math.min(m.from, text.length));
    cuts.add(Math.min(m.to, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = '';
  for (let k = 0; k < points.length - 1; k++) {
    const [from, to] = [points[k], points[k + 1]];
    if (to <= from) continue;
    const b = line.marks.some((m) => m.b && m.from <= from && m.to >= to);
    const i = italicAll || line.marks.some((m) => m.i && m.from <= from && m.to >= to);
    out += run(text.slice(from, to), { b, i });
  }
  return out;
}

function songXml(song, o, first) {
  const chords = o.mode === 'chords' && song.hasChords;
  const out = [];
  out.push(para('Heading1', run(song.title), { pageBreakBefore: !first }));
  const meta = o.meta ? metaItems(song, { chords }) : [];
  out.push(para('SongMeta', meta.length ? run(meta.join(' · ')) : ''));

  const numbered = o.numbers && songGutter(song) > 0;
  const gutter = chords ? songGutter(song, { numbers: o.numbers }) : 0;

  for (const group of song.groups) {
    const blocks = groupBlocks(group, o, { chords, gutter });
    blocks.forEach(({ part, rows, lines }, idx) => {
      const last = idx === blocks.length - 1;
      const keep = { keepNext: !last, spacingAfter: last ? GROUP_GAP : 0 };
      if (part.type === 'comment') {
        const left = !chords && numbered ? HANG : 0;
        out.push(para('SongComment', run(part.text), { ...keep, ind: { left, hanging: 0 } }));
        return;
      }
      if (chords) {
        const body = rows.map((r) => run(r.text, r.kind === 'chord' ? { style: 'Chord' } : {})).join(BR);
        out.push(para(part.type === 'chorus' ? 'ChorusMono' : 'VerseMono', body, keep));
        return;
      }
      const chorus = part.type === 'chorus';
      const base = numbered ? HANG : 0;
      const hasNum = numbered && !chorus && part.number;
      const lead = hasNum ? run(part.number, { style: 'VerseNumber' }) + TAB : '';
      const body = lines.map((l) => lineRuns(l, chorus && o.chorusItalic)).join(BR);
      const ind = { left: chorus ? base + HANG : base, hanging: hasNum ? HANG : 0 };
      out.push(para(chorus ? 'Chorus' : 'Verse', lead + body, { ...keep, ind }));
    });
  }
  return out.join('');
}

function stylesXml(o) {
  const hp = (pt) => Math.round(pt * 2);
  const font = escapeXml(o.font);
  const mono = escapeXml(o.mono);
  const size = hp(o.sizePt);
  const monoSize = hp(Math.max(8, o.sizePt - 1));
  const chordColor = o.chordColor ? `<w:color w:val="${CHORD_COLOR.slice(1)}"/>` : '';
  return (
    XML_HEAD +
    `<w:styles xmlns:w="${W}">` +
    '<w:docDefaults>' +
    `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="${hp(o.sizePt + 6)}"/><w:szCs w:val="${hp(o.sizePt + 6)}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SongMeta"><w:name w:val="Song Meta"/><w:basedOn w:val="Normal"/><w:next w:val="Verse"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="${GROUP_GAP}"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="${hp(o.sizePt - 2)}"/><w:szCs w:val="${hp(o.sizePt - 2)}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SongComment"><w:name w:val="Song Comment"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="120"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="7F7F7F"/><w:sz w:val="${hp(o.sizePt - 1)}"/><w:szCs w:val="${hp(o.sizePt - 1)}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Verse"><w:name w:val="Verse"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepLines/><w:spacing w:after="${GROUP_GAP}"/><w:ind w:left="${HANG}" w:hanging="${HANG}"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Chorus"><w:name w:val="Chorus"/><w:basedOn w:val="Verse"/><w:qFormat/><w:pPr><w:ind w:left="${HANG * 2}" w:hanging="0"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="VerseMono"><w:name w:val="Verse (chords)"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepLines/><w:spacing w:after="${GROUP_GAP}"/></w:pPr><w:rPr><w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:eastAsia="${mono}" w:cs="${mono}"/><w:sz w:val="${monoSize}"/><w:szCs w:val="${monoSize}"/></w:rPr></w:style>` +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="ChorusMono"><w:name w:val="Chorus (chords)"/><w:basedOn w:val="VerseMono"/><w:qFormat/></w:style>' +
    `<w:style w:type="character" w:customStyle="1" w:styleId="Chord"><w:name w:val="Chord"/><w:uiPriority w:val="1"/><w:qFormat/><w:rPr><w:b/><w:bCs/>${chordColor}</w:rPr></w:style>` +
    '<w:style w:type="character" w:customStyle="1" w:styleId="VerseNumber"><w:name w:val="Verse Number"/><w:uiPriority w:val="1"/><w:qFormat/></w:style>' +
    '</w:styles>'
  );
}

export function buildDocxParts(songs, prefs = {}) {
  const list = Array.isArray(songs) ? songs : [songs];
  if (!list.length) throw new Error('Nothing to export');
  const base = { ...wordOptionsBase(prefs) };
  const body = list.map((s, i) => songXml(s, wordOptions(s, prefs), i === 0)).join('');
  const page = PAGE[base.page] || PAGE.letter;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const title = prefs.docTitle || list[0].title;

  return {
    '[Content_Types].xml':
      XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
    '_rels/.rels':
      XML_HEAD +
      `<Relationships xmlns="${PR}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>',
    'docProps/core.xml':
      XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${escapeXml(title)}</dc:title>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
    'word/_rels/document.xml.rels':
      XML_HEAD +
      `<Relationships xmlns="${PR}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      '</Relationships>',
    'word/settings.xml':
      XML_HEAD +
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="${HANG}"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '</w:settings>',
    'word/styles.xml': stylesXml(base),
    'word/document.xml':
      XML_HEAD +
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
      `<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
      '</w:body></w:document>',
  };
}

function wordOptionsBase(prefs) {
  // Document-wide settings (fonts, sizes, page) — per-song mode is resolved in songXml.
  return wordOptions({ hasChords: true }, prefs);
}

export async function packDocx(parts, JSZip, type = 'blob') {
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(parts)) zip.file(path, xml);
  return zip.generateAsync({ type, compression: 'DEFLATE', mimeType: DOCX_MIME });
}

export function renderDocx(songs, prefs, JSZip, type = 'blob') {
  return packDocx(buildDocxParts(songs, prefs), JSZip, type);
}
