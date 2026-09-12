/**
 * Runs on the real dataset with `npm test` - no dependencies, node:test only.
 * Covers the dataset's integrity, the filter rules and the My Maps exports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { THEMES, TYPES, TRIP_DAYS, mapUrl, englishAreaMapUrl, HOME_PLACE_ID, placeHash, relatedLabel } from '../assets/js/data.js';
import { emptyFilters, filterPlaces, isFiltered } from '../assets/js/filter.js';
import { toKml, toCsv } from '../assets/js/export.js';
import { mergeSeed, importSettings, currentSettings } from '../assets/js/store.js';
import { toBriefing, parseTransfer, toTransfer, TRANSFER_KIND } from '../assets/js/transfer.js';

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

  // "Day trip" is the label for the trip type, so searching it must return every
  // trip. Other places may also match when their own text happens to contain both
  // words - that is the filter working, not a rule the dataset has to obey.
  const byLabel = filterPlaces(places, withFilters({ search: 'day trip' }));
  const trips = places.filter((p) => p.type === 'trip');
  assert.ok(trips.length > 0);
  assert.ok(trips.every((p) => byLabel.includes(p)), 'the type label is not searchable');

  assert.equal(filterPlaces(places, withFilters({ search: 'zzzz' })).length, 0);
});

test('filter: search is case-insensitive and terms are ANDed', () => {
  const a = filterPlaces(places, withFilters({ search: 'RAMEN museum' }));
  const b = filterPlaces(places, withFilters({ search: 'ramen MUSEUM' }));
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  assert.ok(a.every((p) => /ramen/i.test(JSON.stringify(p)) && /museum/i.test(JSON.stringify(p))));
});

test('map links point at English Google Maps with the place query', () => {
  const senso = places.find((p) => p.id === 'senso-ji');
  assert.equal(
    mapUrl(senso),
    'https://www.google.com/maps/search/?api=1&query=Senso-ji%20Asakusa%20Tokyo%20Japan&hl=en',
  );
  for (const place of places) {
    assert.match(mapUrl(place), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    assert.match(mapUrl(place), /[?&]hl=en/);
  }
  const home = places.find((p) => p.id === HOME_PLACE_ID);
  assert.equal(
    englishAreaMapUrl(home.coords, 14),
    'https://www.google.com/maps/@35.7138264,139.7983176,14z?hl=en',
  );
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

test('hotel: OMO3 Asakusa is the only lodging entry and the booked home base', async () => {
  const lodging = places.filter((p) => p.theme === 'lodging');
  assert.equal(lodging.length, 1);
  assert.equal(lodging[0].id, 'omo3-asakusa');
  assert.equal(HOME_PLACE_ID, 'omo3-asakusa');
  assert.match(lodging[0].why, /Booked for 16–25 Oct/);

  const settings = await read('data/my-settings.json');
  assert.ok(settings.favorites.includes('omo3-asakusa'));
  assert.equal(settings.seedVersion, 7);
});

test('plan seed: every starred place is real and every day assignment is a trip day', async () => {
  const settings = await read('data/my-settings.json');
  const known = new Set(places.map((p) => p.id));
  const tripDays = new Set(TRIP_DAYS.map((d) => d.id));

  assert.equal(new Set(settings.favorites).size, settings.favorites.length, 'duplicate favorites');
  for (const id of settings.favorites) assert.ok(known.has(id), `starred unknown place ${id}`);

  for (const [id, day] of Object.entries(settings.days)) {
    assert.ok(known.has(id), `day assigned to unknown place ${id}`);
    assert.ok(tripDays.has(day), `${id}: ${day} is not a trip day`);
    assert.ok(settings.favorites.includes(id), `${id} has a day but is not starred`);
  }

  // The decided anchors of the plan, each on its day.
  assert.equal(settings.days['hibikus-asakusa-basement'], '2026-10-19');
  assert.equal(settings.days['kamakura-day-trip'], '2026-10-21');
  assert.equal(settings.days['pigment-tokyo'], '2026-10-22');
  assert.equal(settings.days['teamlab-planets'], '2026-10-22');
  assert.equal(settings.days['alvark-vs-ibaraki-2026-10-22'], '2026-10-22');
  assert.equal(settings.days['shibuya-sky'], '2026-10-23');
  assert.equal(settings.days['zakuro-show-2026-10-23'], '2026-10-23');
  assert.equal(settings.days['kumihimo-experience-by-domyo'], '2026-10-20');
  assert.equal(settings.days['the-real-mccoys-tokyo'], '2026-10-23');

  // All six Tokyo Kapital doors are starred, and the Kapital day holds them.
  const kapital = places.filter((p) => p.id.startsWith('kapital-'));
  assert.equal(kapital.length, 6);
  for (const shop of kapital) {
    assert.ok(settings.favorites.includes(shop.id), `${shop.id} not starred`);
    assert.equal(settings.days[shop.id], '2026-10-24', `${shop.id} not on the Kapital day`);
  }

  // Travel days carry nothing: arrival evening is Asakusa only, departure is a half morning.
  assert.equal(Object.values(settings.days).filter((d) => d === '2026-10-16').length, 0);
});

test('basketball: B.League games during the trip are in the dataset', () => {
  const sports = places.filter((p) => p.theme === 'sports');
  assert.ok(sports.some((p) => p.id === 'sunrockers-vs-nagasaki-2026-10-17'));
  assert.ok(sports.some((p) => p.id === 'alvark-vs-akita-2026-10-19'));
  assert.ok(sports.some((p) => p.id === 'alvark-vs-ibaraki-2026-10-22'));
  assert.ok(sports.some((p) => p.id === 'alvark-vs-mikawa-2026-10-24'));
  assert.ok(sports.some((p) => p.id === 'kawasaki-brave-thunders-todoroki'));
  const robots = places.find((p) => p.id === 'alvark-vs-ibaraki-2026-10-22');
  assert.match(robots.why, /teamLab Planets/);
  const planets = places.find((p) => p.id === 'teamlab-planets');
  assert.match(planets.why, /Ibaraki/);
  const arena = places.find((p) => p.id === 'alvark-vs-akita-2026-10-19');
  assert.match(arena.what, /19:05/);
});

test('settings: a newer repo seed merges into existing local favorites', () => {
  const local = { favorites: ['senso-ji'], days: { 'senso-ji': '2026-10-18' }, hidden: [], seedVersion: 0 };
  const repo = { favorites: ['omo3-asakusa'], days: {}, hidden: [], seedVersion: 2 };
  const merged = mergeSeed(repo, local);
  assert.deepEqual(merged.favorites.sort(), ['omo3-asakusa', 'senso-ji']);
  assert.equal(merged.days['senso-ji'], '2026-10-18');
  assert.equal(merged.seedVersion, 2);

  const unchanged = mergeSeed(repo, { ...local, seedVersion: 2, favorites: ['senso-ji'] });
  assert.deepEqual(unchanged.favorites, ['senso-ji']);
});

test('related: ids exist in the dataset and Planets pairs with Ibaraki', () => {
  const byId = new Map(places.map((place) => [place.id, place]));
  for (const place of places) {
    if (!place.related) continue;
    assert.ok(Array.isArray(place.related), `${place.id}: related must be an array`);
    for (const id of place.related) {
      assert.ok(byId.has(id), `${place.id} related to missing ${id}`);
      assert.notEqual(id, place.id, `${place.id} related to itself`);
    }
  }

  const planets = byId.get('teamlab-planets');
  const robots = byId.get('alvark-vs-ibaraki-2026-10-22');
  assert.ok(planets.related.includes('alvark-vs-ibaraki-2026-10-22'));
  assert.ok(robots.related.includes('teamlab-planets'));
  assert.equal(placeHash(planets.id), '#browse/teamlab-planets');
  assert.equal(relatedLabel(robots), 'Ibaraki Robots · Thu 22 Oct');
  assert.equal(relatedLabel(planets), 'teamLab Planets');
});

test('instagram places from PR 16 are in the dataset', () => {
  for (const id of [
    'shibuya-hikarie-sky-lobby',
    'shibuya-hachiko-stamp',
    'kitamura-camera-shinjuku',
    'lemonsha-ginza',
    'ginza-tsuboyaki-imo',
    'onigiri-asakusa-yadoroku',
    'yayoi-kusama-museum',
    'kamakura-day-trip',
  ]) {
    assert.ok(places.some((p) => p.id === id), `missing ${id}`);
  }
});

test('transfer: briefing and JSON round-trip stars and days', () => {
  const known = new Set(places.map((p) => p.id));
  const snapshot = {
    favorites: ['omo3-asakusa', 'teamlab-planets', 'alvark-vs-ibaraki-2026-10-22'],
    days: { 'teamlab-planets': '2026-10-22', 'alvark-vs-ibaraki-2026-10-22': '2026-10-22' },
    hidden: [],
    seedVersion: 2,
  };

  const json = toTransfer(places, snapshot);
  assert.equal(json.kind, TRANSFER_KIND);
  assert.equal(json.hotel.id, 'omo3-asakusa');
  assert.equal(json.favorites.length, 3);
  assert.equal(json.favorites.find((p) => p.id === 'teamlab-planets').day, '2026-10-22');

  const md = toBriefing(places, snapshot);
  assert.match(md, /teamLab Planets/);
  assert.match(md, /OMO3 Asakusa/);
  assert.match(md, /```json/);

  const fromBriefing = parseTransfer(md, known);
  assert.deepEqual(fromBriefing.settings.favorites, snapshot.favorites);
  assert.equal(fromBriefing.settings.days['teamlab-planets'], '2026-10-22');
  assert.equal(fromBriefing.skipped.length, 0);

  const fromLegacy = parseTransfer(
    JSON.stringify({ favorites: ['senso-ji', 'not-a-place'], days: { 'senso-ji': '2026-10-18' }, hidden: [] }),
    known,
  );
  assert.deepEqual(fromLegacy.settings.favorites, ['senso-ji']);
  assert.deepEqual(fromLegacy.skipped, ['not-a-place']);

  importSettings(fromBriefing.settings);
  const applied = currentSettings();
  assert.ok(applied.favorites.includes('teamlab-planets'));
  assert.equal(applied.days['alvark-vs-ibaraki-2026-10-22'], '2026-10-22');
});
