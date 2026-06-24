/**
 * scripts/serve.mjs — a tiny zero-dependency static server for local dev.
 *
 * The app is vanilla ES modules (`<script type="module">`), which browsers REFUSE
 * to load over `file://` (CORS: opening index.html by double-click gives a black
 * screen because main.js never loads). Serve over HTTP instead:
 *
 *   node scripts/serve.mjs          # http://localhost:8000
 *   node scripts/serve.mjs 5500     # custom port
 *
 * Serves the project root with correct JS/CSS MIME types (a module script needs a
 * JavaScript MIME or the browser rejects it). No dependencies — just node:http/fs.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.argv[2]) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    // Block path traversal outside the project root.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403); res.end('403 forbidden'); return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 not found: ' + urlPath);
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 ' + (err && err.message ? err.message : 'error'));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  VCT 2026 simulator → http://localhost:${PORT}\n  Open that URL in your browser.  (Ctrl+C to stop)\n`);
});
