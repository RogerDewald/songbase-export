// Builds the Windows clipboard "HTML Format" (CF_HTML) payload for an HTML document —
// the same shape a browser writes — so test/office/verify-paste.ps1 can paste our
// "Copy for Word" HTML into Word without a browser in the loop.
// Usage: node tools/cfhtml.mjs out/sample-word-lyrics.html   (writes <file>.cfhtml)
import { readFile, writeFile } from 'node:fs/promises';

export function toCfHtml(html) {
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const fragment = bodyMatch ? bodyMatch[1] : html;
  const doc = `<html><head><meta charset="utf-8"></head><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;
  const header = (o) =>
    'Version:0.9\r\n' +
    `StartHTML:${String(o.startHtml).padStart(10, '0')}\r\n` +
    `EndHTML:${String(o.endHtml).padStart(10, '0')}\r\n` +
    `StartFragment:${String(o.startFragment).padStart(10, '0')}\r\n` +
    `EndFragment:${String(o.endFragment).padStart(10, '0')}\r\n`;
  const headerLen = Buffer.byteLength(header({ startHtml: 0, endHtml: 0, startFragment: 0, endFragment: 0 }), 'utf8');
  const docBytes = Buffer.from(doc, 'utf8');
  const startMarker = Buffer.from('<!--StartFragment-->', 'utf8');
  const endMarker = Buffer.from('<!--EndFragment-->', 'utf8');
  const offsets = {
    startHtml: headerLen,
    endHtml: headerLen + docBytes.length,
    startFragment: headerLen + docBytes.indexOf(startMarker) + startMarker.length,
    endFragment: headerLen + docBytes.indexOf(endMarker),
  };
  return Buffer.concat([Buffer.from(header(offsets), 'utf8'), docBytes]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  for (const file of process.argv.slice(2)) {
    const out = file.replace(/\.html?$/i, '') + '.cfhtml';
    await writeFile(out, toCfHtml(await readFile(file, 'utf8')));
    console.log(`wrote ${out}`);
  }
}
