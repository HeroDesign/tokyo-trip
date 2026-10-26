/**
 * The photo map's data and helpers. Runs on the real data/trip.json and
 * data/photos.json so a broken reference fails before it deploys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

import { TRIP_DAYS } from '../assets/js/data.js';
import {
  dayLabel,
  dayChipLabel,
  localTime,
  localDate,
  indexTrip,
  groupPhotos,
  parseHash,
  toHash,
  clusterPoints,
  haversine,
  matchPhotoToStop,
  countLine,
} from '../photos/lib.js';
import { readExif, stripMetadata, hasExif, isJpeg } from '../scripts/exif.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const exists = (p) => access(path.join(ROOT, p)).then(() => true, () => false);

const trip = await read('data/trip.json');
const { photos } = await read('data/photos.json');
const places = await read('data/places.json');
const tripDays = new Set(TRIP_DAYS.map((d) => d.id));
const placeIds = new Set(places.map((p) => p.id));

test('trip: days are trip days in order, stops are complete and in Kanto', () => {
  assert.ok(trip.days.length > 0);
  const ids = trip.days.map((d) => d.id);
  assert.deepEqual(ids, [...ids].sort(), 'days out of order');
  const stopIds = new Set();
  for (const day of trip.days) {
    assert.ok(tripDays.has(day.id), `${day.id} is not a trip day`);
    assert.ok(day.title?.trim(), `${day.id}: no title`);
    for (const stop of day.stops) {
      assert.ok(stop.id && stop.name, `incomplete stop in ${day.id}: ${JSON.stringify(stop)}`);
      assert.ok(!stopIds.has(stop.id), `duplicate stop id ${stop.id}`);
      stopIds.add(stop.id);
      const [lat, lng] = stop.coords;
      assert.ok(lat > 34 && lat < 37.5 && lng > 138 && lng < 140.5, `${stop.id}: outside Kanto`);
      if (stop.placeId) assert.ok(placeIds.has(stop.placeId), `${stop.id}: unknown place ${stop.placeId}`);
      if (stop.time) assert.match(stop.time, /^\d{2}:\d{2}$/, `${stop.id}: time is not HH:MM`);
    }
  }
});

test('photos: every photo points at a real stop, on the right day, with files on disk', async () => {
  const { stops } = indexTrip(trip);
  assert.equal(new Set(photos.map((p) => p.id)).size, photos.length, 'duplicate photo ids');
  for (const photo of photos) {
    const stop = stops.get(photo.stop);
    assert.ok(stop, `${photo.id}: unknown stop ${photo.stop}`);
    assert.ok(Number.isFinite(Date.parse(photo.taken)), `${photo.id}: bad timestamp`);
    assert.equal(localDate(photo.taken), stop.day, `${photo.id}: taken on a different day than its stop`);
    assert.ok(photo.w > 0 && photo.h > 0, `${photo.id}: missing dimensions`);
    assert.match(photo.src, /^(images|photos)\//, `${photo.id}: src must be site-root relative`);
    assert.ok(await exists(photo.src), `${photo.id}: missing ${photo.src}`);
    assert.ok(await exists(photo.thumb), `${photo.id}: missing ${photo.thumb}`);
  }
});

test('photos: grouped by stop in the order they were taken', () => {
  const byStop = groupPhotos(photos);
  for (const [stopId, group] of byStop) {
    for (let i = 1; i < group.length; i++) {
      assert.ok(Date.parse(group[i - 1].taken) <= Date.parse(group[i].taken), `${stopId}: out of order`);
    }
  }
  assert.ok(byStop.size > 10);
});

test('labels: day labels, chip labels, local times', () => {
  assert.equal(dayLabel('2026-10-18'), 'Sun 18 Oct');
  assert.equal(dayChipLabel('2026-10-17'), 'Sat 17');
  assert.equal(localTime('2026-10-18T09:41:07+09:00'), '09:41');
  assert.equal(localDate('2026-10-18T23:59:00+09:00'), '2026-10-18');
  assert.equal(countLine(1, 2), '1 photo · 2 stops');
  assert.equal(countLine(12, 1), '12 photos · 1 stop');
});

test('routes: the hash carries the deepest part and round-trips', () => {
  assert.deepEqual(parseHash('#day/2026-10-18'), { kind: 'day', id: '2026-10-18' });
  assert.deepEqual(parseHash('#stop/2026-10-18-senso-ji'), { kind: 'stop', id: '2026-10-18-senso-ji' });
  assert.deepEqual(parseHash('#photo/1018-senso-ji-1'), { kind: 'photo', id: '1018-senso-ji-1' });
  assert.deepEqual(parseHash('#nonsense/x'), { kind: '', id: '' });
  assert.deepEqual(parseHash(''), { kind: '', id: '' });
  assert.equal(toHash({ day: 'd', stop: 's', photo: 'p' }), '#photo/p');
  assert.equal(toHash({ day: 'd', stop: 's' }), '#stop/s');
  assert.equal(toHash({ day: 'd' }), '#day/d');
  assert.equal(toHash({}), '#');
});

test('clusters: nearby points stack, far ones stay apart', () => {
  const clusters = clusterPoints(
    [
      { x: 0, y: 0, id: 'a' },
      { x: 20, y: 10, id: 'b' },
      { x: 200, y: 200, id: 'c' },
      { x: 210, y: 190, id: 'd' },
      { x: 500, y: 0, id: 'e' },
    ],
    46,
  );
  assert.deepEqual(
    clusters.map((c) => c.items.map((i) => i.id)),
    [['a', 'b'], ['c', 'd'], ['e']],
  );
});

test('matching: photos land on the nearest stop of their day, or nowhere', () => {
  const { stops } = indexTrip(trip);
  const list = [...stops.values()];
  const senso = stops.get('2026-10-18-senso-ji');
  assert.ok(senso);

  assert.ok(haversine(senso.coords, [35.7148, 139.7967]) < 1);
  const near = matchPhotoToStop({ coords: [35.7150, 139.7970], taken: '2026-10-18T09:00:00+09:00' }, list);
  assert.equal(near.stop, senso.id);
  assert.equal(near.confidence, 'near');

  // Same spot, another day: that day's own stops win (Nakamise-dori, ~270 m off).
  const otherDay = matchPhotoToStop({ coords: [35.7150, 139.7970], taken: '2026-10-17T18:00:00+09:00' }, list);
  assert.equal(otherDay.stop, '2026-10-17-nakamise-dori');
  assert.equal(otherDay.confidence, 'loose');

  // Tokyo Bay, nowhere near anything that day.
  assert.equal(matchPhotoToStop({ coords: [35.55, 139.95], taken: '2026-10-18T12:00:00+09:00' }, list), null);
  assert.equal(matchPhotoToStop({ coords: null, taken: '2026-10-18T12:00:00+09:00' }, list), null);
});

test('exif: reads when, where and which way up from a phone-style JPEG', async () => {
  const buf = await readFile(path.join(ROOT, 'test/fixtures/exif-sample.jpg'));
  assert.ok(isJpeg(buf));
  const info = readExif(buf);
  assert.equal(info.taken, '2026-10-18T09:41:07+09:00');
  assert.deepEqual(info.coords, [35.7148, 139.7967]);
  assert.equal(info.orientation, 6);
  // Stored 64x48, but orientation 6 means it displays rotated.
  assert.equal(info.width, 48);
  assert.equal(info.height, 64);

  const plain = readExif(await readFile(path.join(ROOT, 'test/fixtures/no-exif.jpg')));
  assert.equal(plain.taken, null);
  assert.equal(plain.coords, null);
  assert.equal(plain.width, 40);
});

test('exif: stripping removes the metadata and keeps a valid JPEG', async () => {
  const buf = await readFile(path.join(ROOT, 'test/fixtures/exif-sample.jpg'));
  assert.ok(hasExif(buf));
  const stripped = stripMetadata(buf);
  assert.ok(isJpeg(stripped));
  assert.ok(!hasExif(stripped));
  assert.ok(stripped.length < buf.length);
  assert.equal(readExif(stripped).coords, null);
  assert.equal(readExif(stripped).width, 64, 'pixel header survives');
  assert.equal(stripped.readUInt16BE(stripped.length - 2), 0xffd9, 'ends with EOI');
});
