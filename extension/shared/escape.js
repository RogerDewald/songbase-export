// Escaping for every string that leaves the Song IR as markup. Song text is untrusted
// (it is user-contributed on Songbase) and the side panel is a privileged page.

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

// Characters XML 1.0 cannot carry at all (control chars, lone surrogates, U+FFFE/FFFF).
const XML_INVALID = /[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;
const XML_INVALID_ONE = /^[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]$/u;

export const isXmlInvalidChar = (ch) => XML_INVALID_ONE.test(ch);
export const stripXmlInvalid = (value) => String(value ?? '').replace(XML_INVALID, '');

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(XML_INVALID, '')
    .replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

// Word's HTML import collapses runs of ordinary spaces and ignores `white-space: pre`
// outside <pre>. A run of n interior spaces becomes n-1 NBSP + 1 space (so lines can
// still wrap there); a leading run is all NBSP, because a leading ordinary space after
// <br> is dropped. Expects text that is already HTML-escaped (spaces are untouched by that).
export function nbspRuns(escaped) {
  return escaped
    .replace(/^ +/, (run) => '&nbsp;'.repeat(run.length))
    .replace(/ {2,}/g, (run) => '&nbsp;'.repeat(run.length - 1) + ' ');
}
