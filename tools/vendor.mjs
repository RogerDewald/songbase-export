// Copies the pinned browser builds of JSZip and PptxGenJS from node_modules into
// extension/vendor, so the extension runs exactly the versions the Node tests use.
// Run: npm run vendor
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'extension', 'vendor');

const libs = [
  { pkg: 'jszip', file: 'dist/jszip.min.js', out: 'jszip.min.js', license: 'LICENSE.markdown' },
  { pkg: 'pptxgenjs', file: 'dist/pptxgen.min.js', out: 'pptxgen.min.js', license: 'LICENSE' },
];

await mkdir(outDir, { recursive: true });
const licenseParts = [];
for (const lib of libs) {
  // pptxgenjs's "exports" map hides package.json from require.resolve, so go by path.
  const pkgDir = path.join(root, 'node_modules', lib.pkg);
  const { version } = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  let src = await readFile(path.join(pkgDir, lib.file), 'utf8');
  // Source maps are not shipped; drop the pointer so DevTools doesn't 404 on it.
  src = src.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  await writeFile(path.join(outDir, lib.out), src);
  const license = await readFile(path.join(pkgDir, lib.license), 'utf8');
  licenseParts.push(`===== ${lib.pkg}@${version} (${lib.out}) =====\n\n${license.trim()}\n`);
  console.log(`vendored ${lib.pkg}@${version} -> extension/vendor/${lib.out} (${src.length} bytes)`);
}
await writeFile(path.join(outDir, 'LICENSES.txt'), licenseParts.join('\n'));
