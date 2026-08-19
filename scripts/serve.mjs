/**
 * Minimal static file server for local development. No dependencies, no build:
 * open the printed URL and edit files directly.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';

const ROOT_SEGMENTS = ['/assets/', '/data/', '/images/', '/vendor/', '/index.html'];

/** Cloud port previews may prefix paths; find the real file path inside the URL. */
function pathnameForRequest(pathname) {
  if (pathname === '/tokyo-trip') return '/';
  if (pathname.startsWith('/tokyo-trip/')) return pathname.slice('/tokyo-trip'.length) || '/';

  for (const segment of ROOT_SEGMENTS) {
    const idx = pathname.indexOf(segment);
    if (idx >= 0) return pathname.slice(idx);
  }

  return pathname;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.csv': 'text/csv; charset=utf-8',
};

async function resolveFile(filePath) {
  if (!filePath.startsWith(root)) return null;

  let info = await stat(filePath).catch(() => null);
  if (!info) return null;

  if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  info = await stat(filePath).catch(() => null);
  if (!info || info.isDirectory()) return null;

  return filePath;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const normalized = pathnameForRequest(decodeURIComponent(url.pathname));
  let filePath = await resolveFile(path.join(root, normalized));

  // Hash-routed app: unknown document paths still get index.html.
  if (!filePath && req.method === 'GET' && !path.extname(normalized)) {
    filePath = await resolveFile(path.join(root, 'index.html'));
  }

  if (!filePath) {
    console.error(`404 ${req.method} ${url.pathname}`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}).listen(port, host, () => {
  console.log(`Tokyo Field Guide -> http://localhost:${port} (bound to ${host})`);
});
