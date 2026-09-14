/**
 * Minimal static file server for local development. No dependencies, no build:
 * open the printed URL and edit files directly.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';

/** GitHub Pages serves at /tokyo-trip/ — strip that prefix when testing locally. */
function pathnameForRequest(pathname) {
  if (pathname === '/tokyo-trip') return '/';
  if (pathname.startsWith('/tokyo-trip/')) return pathname.slice('/tokyo-trip'.length) || '/';
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

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let filePath = path.join(root, decodeURIComponent(pathnameForRequest(url.pathname)));
    if (!filePath.startsWith(root)) throw Object.assign(new Error('bad path'), { code: 'ENOENT' });

    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = path.join(filePath, 'index.html');

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(port, host, () => {
  console.log(`Tokyo Field Guide -> http://localhost:${port}`);
  if (host === '0.0.0.0') {
    for (const address of lanAddresses()) {
      console.log(`  on your phone (same Wi‑Fi) -> http://${address}:${port}`);
    }
  }
});
