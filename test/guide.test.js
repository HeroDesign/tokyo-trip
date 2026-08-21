/**
 * Runs on the real dataset with `npm test` - no dependencies, node:test only.
 * Covers the dataset's integrity, the filter rules and the My Maps exports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { THEMES, TYPES, TRIP_DAYS, mapUrl } from '../assets/js/data.js';
import { emptyFilters, filterPlaces, isFiltered } from '../assets/js/filter.js';
import { toKml, toCsv } from '../assets/js/export.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));

const places = await read('data/places.json');
const credits = await read('data/image-credits.json');

const withFilters = (patch) => ({ ...emptyFilters(), ...patch });

test('dataset: every place is complete and well-formed', () => {
  const themeIds = new Set(THEMES.map((t) => t.id));
  const typeIds = new Set(TYPES.map((t) => t.id));

  for (const place of places) {
    assert.ok(place.id && place.name, `missing id/name: ${JSON.stringify(place)}`);
    assert.ok(themeIds.has(place.theme), `${place.id}: unknown theme ${place.theme}`);
    assert.ok(typeIds.has(place.type), `${place.id}: unknown type ${place.type}`);
    for (const field of ['area', 'what', 'why', 'mapQuery']) {
      assert.ok(place[field]?.trim(), `${place.id}: empty ${field}`);
    }
    assert.ok(['exact', 'area'].includes(place.coordPrecision), `${place.id}: bad precision`);

    const [lat, lng] = place.coords;
    assert.ok(lat > 34 && lat < 37.5, `${place.id}: latitude ${lat} outside the Kanto region`);
    assert.ok(lng > 138 && lng < 140.5, `${place.id}: longitude ${lng} outside the Kanto region`);

    if (place.link) assert.match(place.link, /^https:\/\//, `${place.id}: link is not https`);
  }
});

test('dataset: ids are unique and every theme and type is represented', () => {
  assert.equal(new Set(places.map((p) => p.id)).size, places.length, 'duplicate ids');

  for (const { id } of THEMES) {
    assert.ok(places.some((p) => p.theme === id), `no places use theme ${id}`);
  }
  for (const { id } of TYPES) {
    assert.ok(places.some((p) => p.type === id), `no places use type ${id}`);
  }
});

test('images: places with cached files have valid attribution', () => {
  const missing = [];
  for (const place of places) {
    const credit = credits[place.id];
    if (!credit) {
      missing.push(place.id);
      continue;
    }
    assert.match(credit.file, /^[a-z0-9-]+\.(jpg|png|webp|gif)$/, `${place.id}: odd filename`);
    assert.ok(credit.license, `${place.id}: no license recorded`);
    assert.ok(credit.bytes > 10000, `${place.id}: suspiciously small image`);
  }
  if (missing.length > 0) {
    console.log(`  note: ${missing.length} place(s) use fallback tiles: ${missing.join(', ')}`);
  }
});

test('images: no two places share the same photo', () => {
  const seen = new Map();
  for (const [id, credit] of Object.entries(credits)) {
    const clash = seen.get(credit.sourceUrl);
    assert.equal(clash, undefined, `${id} reuses the photo already used by ${clash}`);
    seen.set(credit.sourceUrl, id);
  }
});

test('filter: no filters returns everything', () => {
  assert.equal(filterPlaces(places, emptyFilters()).length, places.length);
  assert.equal(isFiltered(emptyFilters()), false);
});

test('filter: themes OR within the group, AND across groups', () => {
  const drums = filterPlaces(places, withFilters({ themes: new Set(['drums']) }));
  assert.ok(drums.length > 0);
  assert.ok(drums.every((p) => p.theme === 'drums'));

  const twoThemes = filterPlaces(places, withFilters({ themes: new Set(['drums', 'menswear']) }));
  assert.equal(twoThemes.length, places.filter((p) => ['drums', 'menswear'].includes(p.theme)).length);

  const crossed = filterPlaces(
    places,
    withFilters({ themes: new Set(['menswear']), types: new Set(['shop']) }),
  );
  assert.ok(crossed.every((p) => p.theme === 'menswear' && p.type === 'shop'));
});

test('filter: search covers name, area, description and labels', () => {
  const byName = filterPlaces(places, withFilters({ search: 'capybara cafe' }));
  assert.ok(byName.some((p) => p.id === 'capybara-cafe-moffu'));

  const byArea = filterPlaces(places, withFilters({ search: 'asakusa' }));
  assert.ok(byArea.length >= 5, 'expected several Asakusa places');

  const byLabel = filterPlaces(places, withFilters({ search: 'day trip' }));
  assert.ok(byLabel.every((p) => p.type === 'trip'));

  assert.equal(filterPlaces(places, withFilters({ search: 'zzzz' })).length, 0);
});

test('filter: search is case-insensitive and terms are ANDed', () => {
  const a = filterPlaces(places, withFilters({ search: 'RAMEN museum' }));
  const b = filterPlaces(places, withFilters({ search: 'ramen MUSEUM' }));
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  assert.ok(a.every((p) => /ramen/i.test(JSON.stringify(p)) && /museum/i.test(JSON.stringify(p))));
});

test('map links point at Google Maps with the place query', () => {
  const senso = places.find((p) => p.id === 'senso-ji');
  assert.equal(
    mapUrl(senso),
    'https://www.google.com/maps/search/?api=1&query=Senso-ji%20Asakusa%20Tokyo%20Japan',
  );
  for (const place of places) {
    assert.match(mapUrl(place), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  }
});

test('export: KML has one placemark per place, lng,lat ordered', () => {
  const kml = toKml(places);
  assert.equal((kml.match(/<Placemark>/g) ?? []).length, places.length);
  assert.match(kml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);

  const senso = places.find((p) => p.id === 'senso-ji');
  assert.ok(kml.includes(`<coordinates>${senso.coords[1]},${senso.coords[0]},0</coordinates>`));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(kml), 'unescaped ampersand in KML');
});

test('export: CSV has a header plus one row per place, quoting commas', () => {
  const rows = toCsv(places).trim().split('\r\n');
  assert.equal(rows.length, places.length + 1);
  assert.ok(rows[0].startsWith('Name,Theme,Type,Neighborhood'));
  assert.ok(rows.some((r) => r.includes('""downbeat""')), 'expected doubled quotes for escaping');
});

test('export: day assignments reach both formats', () => {
  const one = places.slice(0, 1);
  const days = { [one[0].id]: '2026-10-18' };
  assert.ok(toKml(one, { days }).includes('Day: Sun 18 Oct'));
  assert.ok(toCsv(one, { days }).includes('Sun 18 Oct'));
});

test('trip days: ten dates from Fri 16 to Sun 25 October 2026', () => {
  assert.equal(TRIP_DAYS.length, 10);
  assert.equal(TRIP_DAYS[0].label, 'Fri 16 Oct');
  assert.equal(TRIP_DAYS.at(-1).label, 'Sun 25 Oct');
  assert.match(TRIP_DAYS[0].note, /JL001/);
  assert.match(TRIP_DAYS.at(-1).note, /JL002/);
});
