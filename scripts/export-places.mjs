/**
 * Writes the whole dataset out as KML and CSV for Google My Maps, using the
 * same generators the in-app download buttons use.
 *
 * Usage: npm run export
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { toKml, toCsv } from '../assets/js/export.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'export');

const places = JSON.parse(await readFile(path.join(ROOT, 'data', 'places.json'), 'utf8'));
await mkdir(OUT, { recursive: true });

await writeFile(path.join(OUT, 'tokyo-field-guide.kml'), toKml(places));
await writeFile(path.join(OUT, 'tokyo-field-guide.csv'), toCsv(places));

console.log(`wrote ${places.length} places -> data/export/tokyo-field-guide.{kml,csv}`);
