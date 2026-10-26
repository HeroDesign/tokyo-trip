/**
 * Pure helpers for the photo map. No DOM, no Leaflet, so `npm test` can run
 * them under node:test; photos.js wires them to the page.
 */

/** "2026-10-18" -> "Sun 18 Oct" (UTC so the label never slips a day). */
export const dayLabel = (id) =>
  new Date(`${id}T00:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');

/** "Sun 18 Oct" -> "Sun 18", for a chip row that has to fit a phone. */
export const dayChipLabel = (id) => dayLabel(id).split(' ').slice(0, 2).join(' ');

/**
 * The ISO strings in photos.json carry the local offset (+09:00), so the local
 * clock time and date are right there in the text. Reading them as text keeps
 * the show in Tokyo time no matter where it is viewed.
 */
export const localTime = (iso) => iso.slice(11, 16);
export const localDate = (iso) => iso.slice(0, 10);

/** Index the itinerary: every stop knows its day and position within it. */
export function indexTrip(trip) {
  const stops = new Map();
  for (const day of trip.days) {
    day.stops.forEach((stop, order) => stops.set(stop.id, { ...stop, day: day.id, order }));
  }
  return { days: trip.days, stops };
}

/** Photos grouped by stop id, each group in the order they were taken. */
export function groupPhotos(photos) {
  const byStop = new Map();
  const sorted = [...photos].sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));
  for (const photo of sorted) {
    if (!byStop.has(photo.stop)) byStop.set(photo.stop, []);
    byStop.get(photo.stop).push(photo);
  }
  return byStop;
}

/**
 * Routes: #day/<dayId>, #stop/<stopId>, #photo/<photoId>. A photo implies its
 * stop, which implies its day, so the hash only ever carries the deepest part.
 */
export function parseHash(hash) {
  const [kind, ...rest] = (hash || '').replace(/^#/, '').split('/');
  const id = rest.join('/');
  if (!id || !['day', 'stop', 'photo'].includes(kind)) return { kind: '', id: '' };
  return { kind, id };
}

export function toHash({ day = '', stop = '', photo = '' }) {
  if (photo) return `#photo/${photo}`;
  if (stop) return `#stop/${stop}`;
  if (day) return `#day/${day}`;
  return '#';
}

/**
 * Greedy pixel-space clustering: a point joins the first cluster whose anchor
 * is within `radius` px, otherwise it starts one. Deterministic, no plugin,
 * fine for a hundred stops.
 */
export function clusterPoints(points, radius) {
  const clusters = [];
  for (const point of points) {
    const hit = clusters.find((c) => Math.hypot(c.x - point.x, c.y - point.y) < radius);
    if (hit) hit.items.push(point);
    else clusters.push({ x: point.x, y: point.y, items: [point] });
  }
  return clusters;
}

/** Great-circle distance in metres between two [lat, lng] pairs. */
export function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Attach a photo to an itinerary stop by where and when it was taken.
 *
 * Candidates are the stops on the photo's local date; if that day has none
 * (a photo from the flight, say) every stop is a candidate. Within `near`
 * metres of a stop is a confident match; within `loose` metres is kept but
 * flagged so it can be eyeballed; further than that is unmatched and the
 * ingest step will make a stop for it.
 */
export function matchPhotoToStop(photo, stops, { near = 250, loose = 1500 } = {}) {
  if (!photo.coords) return null;
  const date = localDate(photo.taken ?? '');
  const sameDay = stops.filter((stop) => stop.day === date);
  const candidates = sameDay.length ? sameDay : stops;
  let best = null;
  for (const stop of candidates) {
    const distance = haversine(photo.coords, stop.coords);
    if (!best || distance < best.distance) best = { stop, distance };
  }
  if (!best || best.distance > loose) return null;
  return { stop: best.stop.id, distance: Math.round(best.distance), confidence: best.distance <= near ? 'near' : 'loose' };
}

/** Bounds-free summary line: "12 photos · 5 stops". */
export function countLine(photoCount, stopCount) {
  const p = `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`;
  const s = `${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`;
  return `${p} · ${s}`;
}
