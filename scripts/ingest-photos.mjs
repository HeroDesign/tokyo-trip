/**
 * Turn a folder of exported iPhone photos into the photo map's data.
 *
 *   node scripts/ingest-photos.mjs --from photos/import [--dry-run] [--max 1600] [--thumb 400]
 *
 * For every JPEG (and, on a Mac, every HEIC) in --from:
 *   1. read when it was taken and where (EXIF; scripts/exif.mjs)
 *   2. attach it to a stop in data/trip.json on that day (photos/lib.js); photos
 *      that land near nothing planned get a new stop made for them, named
 *      after the nearest place in the guide
 *   3. write a web copy (longest side --max px) to photos/img/ and a thumbnail
 *      (--thumb px) to photos/thumb/, both with EXIF stripped so no GPS trail
 *      is published
 *   4. write data/photos.json and add any generated stops to data/trip.json
 *
 * Resizing uses whatever is available, in order: the `sharp` package if it is
 * installed (npm i -D sharp), else macOS `sips`, else the original is copied
 * unresized with metadata stripped (fine for a test run, too heavy to publish).
 *
 * Videos and Live Photo .mov files are listed and skipped. Nothing in --from is
 * modified. --dry-run prints the matching report and writes nothing.
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readExif, stripMetadata } from './exif.mjs';
import { indexTrip, matchPhotoToStop, haversine, localDate, localTime } from '../photos/lib.js';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length),
);

const FROM = path.resolve(ROOT, typeof args.from === 'string' ? args.from : 'photos/import');
const DRY = Boolean(args['dry-run']);
const MAX = Number(args.max) || 1600;
const THUMB = Number(args.thumb) || 400;
const IMG_DIR = path.join(ROOT, 'photos', 'img');
const THUMB_DIR = path.join(ROOT, 'photos', 'thumb');
const TRIP_PATH = path.join(ROOT, 'data', 'trip.json');
const PHOTOS_PATH = path.join(ROOT, 'data', 'photos.json');
const NEW_STOP_RADIUS = 300; // metres: unmatched photos this close together share a generated stop

const trip = JSON.parse(await readFile(TRIP_PATH, 'utf8'));
const places = JSON.parse(await readFile(path.join(ROOT, 'data', 'places.json'), 'utf8'));
const { stops } = indexTrip(trip);
const stopList = [...stops.values()];
const dayIds = new Set(trip.days.map((d) => d.id));
const home = places.find((p) => p.theme === 'lodging') ?? places[0];

/* ----------------------------------------------------------- resizers */

async function pickResizer() {
  try {
    const { default: sharp } = await import('sharp');
    return {
      name: 'sharp',
      async resize(input, output, size) {
        await sharp(input).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(output);
      },
      async toJpeg(input, output) {
        await sharp(input).rotate().jpeg({ quality: 92 }).toFile(output);
      },
    };
  } catch {
    /* not installed */
  }
  try {
    await run('sips', ['--help']);
    return {
      name: 'sips',
      async resize(input, output, size) {
        await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(size), input, '--out', output]);
        await bakeOrientation(output);
      },
      async toJpeg(input, output) {
        await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', input, '--out', output]);
      },
    };
  } catch {
    /* not a Mac */
  }
  return {
    name: 'copy (no resize!)',
    async resize(input, output) {
      await writeFile(output, await readFile(input));
    },
    toJpeg: null,
  };
}

/** sips keeps the orientation tag rather than rotating pixels; rotate for real so the tag can go. */
async function bakeOrientation(file) {
  const { orientation } = readExif(await readFile(file));
  const degrees = { 3: 180, 6: 90, 8: 270 }[orientation];
  if (degrees) await run('sips', ['-r', String(degrees), file]);
}

/* ------------------------------------------------------------- scan */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png']);
const SKIP_EXT = new Set(['.mov', '.mp4', '.aae', '.m4v']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out.sort();
}

if (!existsSync(FROM)) {
  console.error(`No such folder: ${FROM}\nExport your photos there first (see docs/photo-map-plan.md).`);
  process.exit(1);
}

const resizer = await pickResizer();
const files = await walk(FROM);
const skipped = files.filter((f) => SKIP_EXT.has(path.extname(f).toLowerCase()));
const candidates = files.filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
console.log(`${candidates.length} images in ${path.relative(ROOT, FROM)} (${skipped.length} videos/sidecars skipped) · resizer: ${resizer.name}`);

/* ------------------------------------------------------------ read */

const scratch = path.join(tmpdir(), 'tokyo-ingest');
await mkdir(scratch, { recursive: true });

const records = [];
const problems = [];
for (const file of candidates) {
  const ext = path.extname(file).toLowerCase();
  let source = file;
  if (ext === '.heic' || ext === '.heif') {
    if (!resizer.toJpeg) {
      problems.push(`${path.basename(file)}: HEIC needs sharp or macOS sips to convert`);
      continue;
    }
    source = path.join(scratch, `${path.basename(file, ext)}.jpg`);
    await resizer.toJpeg(file, source);
  }
  const buf = await readFile(source);
  const exif = readExif(buf);
  if (!exif.taken) {
    problems.push(`${path.basename(file)}: no capture time in EXIF, skipped`);
    continue;
  }
  const day = localDate(exif.taken);
  if (!dayIds.has(day)) {
    problems.push(`${path.basename(file)}: taken ${day}, not a trip day, skipped`);
    continue;
  }
  records.push({ file, source, original: path.basename(file), exif, day });
}
records.sort((a, b) => Date.parse(a.exif.taken) - Date.parse(b.exif.taken));

/* ----------------------------------------------------------- match */

const slug = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'spot';

const generated = new Map(); // day -> [{ id, coords, photos: [] }]
const tally = { near: 0, loose: 0, generated: 0, byTime: 0, unplaced: 0 };

function generatedStopFor(record) {
  const list = generated.get(record.day) ?? [];
  generated.set(record.day, list);
  let hit = list.find((g) => haversine(g.coords, record.exif.coords) < NEW_STOP_RADIUS);
  if (!hit) {
    const nearest = places
      .map((p) => ({ p, d: haversine(p.coords, record.exif.coords) }))
      .sort((a, b) => a.d - b.d)[0];
    const name = nearest && nearest.d < 800 ? `Near ${nearest.p.name}` : 'Unplanned stop';
    hit = {
      id: `${record.day}-near-${slug(nearest?.p.id ?? 'spot')}-${list.length + 1}`,
      name,
      area: nearest?.p.area ?? '',
      coords: record.exif.coords,
      time: localTime(record.exif.taken),
      note: '',
      generated: true,
    };
    list.push(hit);
  }
  return hit.id;
}

/** No GPS: slot the photo between the day's planned stops by clock time. */
function stopByTime(record) {
  const planned = stopList.filter((s) => s.day === record.day && s.time).sort((a, b) => a.time.localeCompare(b.time));
  const t = localTime(record.exif.taken);
  let pick = null;
  for (const stop of planned) if (stop.time <= t) pick = stop;
  return pick?.id ?? null;
}

const seq = {};
for (const record of records) {
  let stopId = null;
  let how = 'unplaced';
  if (record.exif.coords) {
    const match = matchPhotoToStop({ coords: record.exif.coords, taken: record.exif.taken }, stopList);
    if (match) {
      stopId = match.stop;
      how = match.confidence;
    } else {
      stopId = generatedStopFor(record);
      how = 'generated';
    }
  } else {
    stopId = stopByTime(record);
    how = stopId ? 'byTime' : 'unplaced';
  }
  if (!stopId) {
    const list = generated.get(record.day) ?? [];
    generated.set(record.day, list);
    let bucket = list.find((g) => g.id === `${record.day}-unplaced`);
    if (!bucket) {
      bucket = { id: `${record.day}-unplaced`, name: 'Somewhere that day', area: '', coords: home.coords, time: '', note: 'Photos without a location.', generated: true };
      list.push(bucket);
    }
    stopId = bucket.id;
  }
  tally[how]++;
  const key = record.day.slice(5).replace('-', '');
  seq[key] = (seq[key] ?? 0) + 1;
  record.id = `${key}-${String(seq[key]).padStart(4, '0')}`;
  record.stop = stopId;
  record.how = how;
}

/* ---------------------------------------------------------- report */

console.log(`\nmatched: ${tally.near} near a planned stop · ${tally.loose} loosely (within 1.5 km) · ${tally.generated} at new stops · ${tally.byTime} by time only (no GPS) · ${tally.unplaced} unplaced`);
for (const [day, list] of generated) {
  console.log(`  ${day}: ${list.length} new stop(s): ${list.map((g) => g.name).join(', ')}`);
}
if (problems.length) console.log(`\n${problems.length} skipped:\n  ${problems.join('\n  ')}`);
if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

/* ----------------------------------------------------------- write */

await mkdir(IMG_DIR, { recursive: true });
await mkdir(THUMB_DIR, { recursive: true });
const photos = [];
for (const record of records) {
  const img = path.join(IMG_DIR, `${record.id}.jpg`);
  const thumb = path.join(THUMB_DIR, `${record.id}.jpg`);
  await resizer.resize(record.source, img, MAX);
  await resizer.resize(record.source, thumb, THUMB);
  for (const out of [img, thumb]) await writeFile(out, stripMetadata(await readFile(out)));
  const dims = readExif(await readFile(img));
  photos.push({
    id: record.id,
    src: `photos/img/${record.id}.jpg`,
    thumb: `photos/thumb/${record.id}.jpg`,
    w: dims.width,
    h: dims.height,
    taken: record.exif.taken,
    coords: record.exif.coords,
    stop: record.stop,
    caption: '',
    original: record.original,
    match: record.how,
  });
  process.stdout.write('.');
}
console.log('');

for (const day of trip.days) {
  const extra = generated.get(day.id) ?? [];
  day.stops = [...day.stops.filter((s) => !s.generated), ...extra].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}
trip.source = `Stops from the itinerary plus ${[...generated.values()].flat().length} generated from photo locations by scripts/ingest-photos.mjs.`;
await writeFile(TRIP_PATH, JSON.stringify(trip, null, 2) + '\n');
await writeFile(
  PHOTOS_PATH,
  JSON.stringify({ source: `${photos.length} photos ingested by scripts/ingest-photos.mjs on ${new Date().toISOString().slice(0, 10)}. EXIF stripped from published copies.`, photos }, null, 2) + '\n',
);
const bytes = (await Promise.all(photos.map((p) => stat(path.join(ROOT, p.src))))).reduce((n, s) => n + s.size, 0);
console.log(`wrote ${photos.length} photos (${(bytes / 1e6).toFixed(1)} MB of web copies) -> data/photos.json, data/trip.json`);
