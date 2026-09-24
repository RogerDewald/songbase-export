// Dev server for the side-panel harness: serves the project root on localhost and, for
// /extension/sidepanel/sidepanel.html?harness=1, injects dev/mock-chrome.js so the REAL
// panel runs outside Chrome's extension runtime. Nothing dev-only lives in extension/.
// Run: npm run harness   ->  http://localhost:5173/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/dev/harness.html';
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      let body = await readFile(file);
      if (rel === '/extension/sidepanel/sidepanel.html' && url.searchParams.has('harness')) {
        body = Buffer.from(body.toString('utf8').replace('<head>', '<head>\n  <script src="/dev/mock-chrome.js"></script>'));
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`harness: http://localhost:${PORT}/`));
