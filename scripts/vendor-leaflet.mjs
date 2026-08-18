/**
 * Vendors Leaflet into vendor/leaflet/ so the map view has no CDN dependency.
 * Map tiles still come from OpenStreetMap at runtime - that part is inherent to
 * a slippy map - but the library itself ships with the site.
 *
 * Usage: node scripts/vendor-leaflet.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const VERSION = '1.9.4';
const BASE = `https://unpkg.com/leaflet@${VERSION}/dist`;
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'leaflet');

const FILES = [
  'leaflet.js',
  'leaflet.css',
  'images/marker-icon.png',
  'images/marker-icon-2x.png',
  'images/marker-shadow.png',
  'images/layers.png',
  'images/layers-2x.png',
];

await mkdir(path.join(OUT, 'images'), { recursive: true });

for (const file of FILES) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${res.status} ${file}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(OUT, file), bytes);
  console.log(`${file} (${Math.round(bytes.length / 1024)}KB)`);
}

console.log(`\nLeaflet ${VERSION} vendored -> vendor/leaflet/ (BSD-2-Clause)`);
