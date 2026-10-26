/**
 * Tokyo Photo Map: the trip's stops on one Leaflet map, every photo pinned to
 * the stop it was taken at. Pick a day for its route and timeline, tap a stop
 * for its photos, tap a photo for the lightbox. The view lives in the hash
 * (#day/…, #stop/…, #photo/…) so any of them can be shared or reloaded.
 *
 * Data: data/trip.json (days → stops) and data/photos.json (photos → stop).
 * data/places.json is only borrowed for theme colours and Google Maps links.
 */
import { THEME_COLORS, themeLabel } from '../assets/js/data.js';
import {
  dayLabel,
  dayChipLabel,
  localTime,
  indexTrip,
  groupPhotos,
  parseHash,
  toHash,
  clusterPoints,
  countLine,
} from './lib.js';

const SITE = '../';
const CLUSTER_RADIUS = 46; // px between pin centres before they stack
const SLIDE_MS = 3400;
const STRIP_MAX = 5;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const json = (file, fallback) =>
  fetch(`${SITE}data/${file}`)
    .then((r) => (r.ok ? r.json() : fallback))
    .catch(() => fallback);

const [trip, photoData, places] = await Promise.all([
  json('trip.json', { days: [] }),
  json('photos.json', { photos: [] }),
  json('places.json', []),
]);

const { days, stops } = indexTrip(trip);
const byStop = groupPhotos(photoData.photos);
const placeById = new Map(places.map((p) => [p.id, p]));
const photoById = new Map(photoData.photos.map((p) => [p.id, p]));
const dayById = new Map(days.map((d) => [d.id, d]));

const url = (p) => SITE + p;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stopPhotos = (id) => byStop.get(id) ?? [];
const dayStops = (dayId) => (dayById.get(dayId)?.stops ?? []).map((s) => stops.get(s.id));
const dayPhotos = (dayId) => dayStops(dayId).flatMap((s) => stopPhotos(s.id));
const allStops = () => [...stops.values()];
const allPhotos = () => days.flatMap((d) => dayPhotos(d.id));
const placeOf = (stop) => placeById.get(stop.placeId);
const accent = (stop) => THEME_COLORS[placeOf(stop)?.theme] ?? THEME_COLORS.core;
const dayNumber = (dayId) => days.findIndex((d) => d.id === dayId) + 1;

const mapsUrl = (stop) => {
  const place = placeOf(stop);
  const query = place?.mapQuery ?? `${stop.coords[0]},${stop.coords[1]}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&hl=en`;
};

/* ------------------------------------------------------------------ state */

let state = { day: '', stop: '', photo: '' };
let pushedPhoto = false;

/** A hash names one thing; the rest of the view follows from it. */
function resolve({ kind, id }) {
  if (kind === 'photo' && photoById.has(id)) {
    const stop = stops.get(photoById.get(id).stop);
    return { day: stop?.day ?? '', stop: stop?.id ?? '', photo: id };
  }
  if (kind === 'stop' && stops.has(id)) return { day: stops.get(id).day, stop: id, photo: '' };
  if (kind === 'day' && dayById.has(id)) return { day: id, stop: '', photo: '' };
  return { day: '', stop: '', photo: '' };
}

function navigate(next, { replace = false } = {}) {
  const prev = state;
  state = { day: next.day ?? '', stop: next.stop ?? '', photo: next.photo ?? '' };
  const hash = toHash(state);
  if (hash !== location.hash && !(hash === '#' && !location.hash)) {
    const target = hash === '#' ? `${location.pathname}${location.search}` : hash;
    history[replace ? 'replaceState' : 'pushState'](null, '', target);
    if (state.photo && !prev.photo) pushedPhoto = !replace;
  }
  render(prev);
}

window.addEventListener('popstate', () => {
  const prev = state;
  state = resolve(parseHash(location.hash));
  render(prev);
});

/* -------------------------------------------------------------------- map */

const mapEl = document.getElementById('map');
const map = L.map(mapEl, { scrollWheelZoom: false, zoomControl: true });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

const visibleStops = () => (state.day ? dayStops(state.day) : allStops());

function photoIcon({ thumb, count, ring, active, cluster }) {
  const size = active ? 56 : 44;
  const classes = ['photopin', cluster && 'photopin--cluster', active && 'photopin--active'].filter(Boolean).join(' ');
  const badge = count > 1 ? `<span class="photopin__count">${count}</span>` : '';
  return L.divIcon({
    className: active ? 'pin--active' : '',
    html: `<div class="${classes}"${active ? '' : ` style="--ring:${ring}"`}><img src="${esc(url(thumb))}" alt="" loading="lazy" decoding="async">${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function dotIcon({ count = 0, active }) {
  const size = active ? 18 : 14;
  const badge = count > 1 ? `<span class="photopin__count">${count}</span>` : '';
  return L.divIcon({
    className: active ? 'pin--active' : '',
    html: `<div class="dotpin ${active ? 'dotpin--active' : ''}">${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function addStopMarker(stop, photos, active) {
  const icon = photos.length
    ? photoIcon({ thumb: photos[0].thumb, count: photos.length, ring: accent(stop), active })
    : dotIcon({ active });
  L.marker(stop.coords, { icon, title: stop.name, zIndexOffset: active ? 1000 : 0 })
    .on('click', () => navigate({ ...state, stop: stop.id, photo: '' }))
    .addTo(markerLayer);
}

function addClusterMarker(members, photos) {
  const anchor = members[0];
  const icon = photos.length
    ? photoIcon({ thumb: photos[0].thumb, count: photos.length, ring: accent(anchor), cluster: true })
    : dotIcon({ count: members.length });
  const bounds = L.latLngBounds(members.map((s) => s.coords));
  const tiny = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 25;
  L.marker(anchor.coords, { icon, title: `${members.length} stops` })
    .on('click', () => {
      // Several stops at one address (the Nakano Broadway shops) can never be
      // split by zooming, so list them instead.
      if (tiny || map.getZoom() >= 17) return listCluster(members, anchor.coords);
      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17, animate: !reduceMotion });
    })
    .addTo(markerLayer);
}

function listCluster(members, at) {
  const rows = members
    .map(
      (stop) =>
        `<button type="button" class="cluster-list__row" data-stop="${esc(stop.id)}">
          <i style="background:${accent(stop)}"></i>
          <span>${esc(stop.name)}</span>
          <small>${stopPhotos(stop.id).length || 'no'} photos</small>
        </button>`,
    )
    .join('');
  L.popup({ className: 'cluster-popup', maxWidth: 260 })
    .setLatLng(at)
    .setContent(`<p class="cluster-list__head">${members.length} stops here</p><div class="cluster-list">${rows}</div>`)
    .openOn(map);
}

mapEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-stop]');
  if (!row) return;
  map.closePopup();
  navigate({ ...state, stop: row.dataset.stop, photo: '' });
});

function drawMarkers() {
  markerLayer.clearLayers();
  const selected = state.stop ? stops.get(state.stop) : null;
  const points = visibleStops()
    .filter((stop) => stop !== selected)
    .map((stop) => {
      const { x, y } = map.latLngToContainerPoint(stop.coords);
      return { x, y, stop };
    });
  for (const cluster of clusterPoints(points, CLUSTER_RADIUS)) {
    const members = cluster.items.map((item) => item.stop);
    const photos = members.flatMap((stop) => stopPhotos(stop.id));
    if (members.length === 1) addStopMarker(members[0], photos, false);
    else addClusterMarker(members, photos);
  }
  if (selected && visibleStops().includes(selected)) addStopMarker(selected, stopPhotos(selected.id), true);
}

function drawRoute() {
  routeLayer.clearLayers();
  if (!state.day) return;
  const path = dayStops(state.day).map((stop) => stop.coords);
  if (path.length < 2) return;
  L.polyline(path, { color: '#1a1815', weight: 2, opacity: 0.5, dashArray: '2 7', lineCap: 'round' }).addTo(routeLayer);
}

const fitTo = (coords, maxZoom) =>
  map.fitBounds(L.latLngBounds(coords), { padding: [48, 48], maxZoom, animate: !reduceMotion });

function frame(prev, first) {
  if (state.stop && prev.stop !== state.stop) {
    const stop = stops.get(state.stop);
    const zoom = Math.max(map.getZoom(), 15);
    if (reduceMotion) map.setView(stop.coords, zoom);
    else map.flyTo(stop.coords, zoom, { duration: 0.7 });
    return;
  }
  if (first || prev.day !== state.day) {
    const coords = visibleStops().map((stop) => stop.coords);
    if (coords.length) fitTo(coords, state.day ? 15 : 13);
  }
}

map.on('zoomend', drawMarkers);

/* ------------------------------------------------------------------- rail */

const rail = document.querySelector('[data-rail]');
const chips = document.querySelector('[data-day-chips]');
const meta = document.querySelector('[data-meta]');
const hint = document.querySelector('[data-hint]');

const stripHtml = (stop, photos) => {
  if (!photos.length) return '';
  const shown = photos.slice(0, STRIP_MAX);
  const more = photos.length - shown.length;
  return `<div class="strip">${shown
    .map(
      (photo) =>
        `<a href="#photo/${esc(photo.id)}" data-photo="${esc(photo.id)}" aria-label="Photo at ${esc(stop.name)}, ${localTime(photo.taken)}"><img src="${esc(url(photo.thumb))}" alt="" loading="lazy" decoding="async"></a>`,
    )
    .join('')}${more > 0 ? `<button type="button" class="strip__more" data-stop="${esc(stop.id)}">+${more}</button>` : ''}</div>`;
};

function renderOverview() {
  const total = allPhotos().length;
  const cards = days
    .map((day) => {
      const photos = dayPhotos(day.id);
      const cover = photos[0];
      return `<button type="button" class="daycard ${cover ? '' : 'daycard--empty'}" data-day="${esc(day.id)}">
        ${cover ? `<img src="${esc(url(cover.thumb))}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="daycard__text">
          <span class="daycard__date">Day ${dayNumber(day.id)} · ${esc(dayLabel(day.id))}</span>
          <span class="daycard__title">${esc(day.title)}</span>
          <span class="daycard__count">${countLine(photos.length, day.stops.length)}</span>
        </span>
      </button>`;
    })
    .join('');
  rail.innerHTML = `
    <div class="rail__head">
      <p class="rail__kicker">The whole trip</p>
      <h2 class="rail__title">${days.length} days, ${total} photos</h2>
    </div>
    <div class="daycards">${cards}</div>`;
}

function renderDay() {
  const day = dayById.get(state.day);
  const list = dayStops(state.day);
  const photos = dayPhotos(state.day);
  const rows = list
    .map((stop) => {
      const own = stopPhotos(stop.id);
      return `<li class="stoprow ${own.length ? '' : 'stoprow--empty'}">
        <span class="stoprow__time">${esc(stop.time ?? '')}</span>
        <span class="stoprow__dot"><i style="--accent:${accent(stop)}"></i></span>
        <div class="stoprow__body">
          <button type="button" class="stoprow__name" data-stop="${esc(stop.id)}">${esc(stop.name)}</button>
          <div class="stoprow__meta">${esc(stop.area ?? '')}${own.length ? ` · ${own.length} ${own.length === 1 ? 'photo' : 'photos'}` : ' · no photos'}</div>
          ${stripHtml(stop, own)}
        </div>
      </li>`;
    })
    .join('');
  rail.innerHTML = `
    <button type="button" class="rail__back" data-day="">&larr; All days</button>
    <div class="rail__head">
      <p class="rail__kicker">Day ${dayNumber(day.id)} · ${esc(dayLabel(day.id))}</p>
      <h2 class="rail__title">${esc(day.title)}</h2>
      <span class="rail__count">${countLine(photos.length, list.length)}</span>
    </div>
    ${list.length ? `<ol class="timeline">${rows}</ol>` : '<p class="rail__empty">Nothing planned this day.</p>'}`;
}

function renderStop() {
  const stop = stops.get(state.stop);
  const photos = stopPhotos(stop.id);
  const place = placeOf(stop);
  const gallery = photos
    .map(
      (photo) =>
        `<a href="#photo/${esc(photo.id)}" data-photo="${esc(photo.id)}" style="--w:${photo.w};--h:${photo.h}" aria-label="Photo at ${esc(stop.name)}, ${localTime(photo.taken)}"><img src="${esc(url(photo.thumb))}" alt="" loading="lazy" decoding="async"></a>`,
    )
    .join('');
  rail.innerHTML = `
    <button type="button" class="rail__back" data-day="${esc(stop.day)}">&larr; Day ${dayNumber(stop.day)} · ${esc(dayLabel(stop.day))}</button>
    <article class="stopcard" style="--accent:${accent(stop)}">
      <div class="stopcard__tags">
        ${place ? `<span class="tag" style="background:${accent(stop)}">${esc(themeLabel(place.theme))}</span>` : ''}
        <span class="card__area">${esc(stop.area ?? '')}</span>
        <span class="stopcard__time">${esc(stop.time ?? '')}</span>
      </div>
      <h2 class="stopcard__name">${esc(stop.name)}</h2>
      ${stop.note ? `<p class="stopcard__note">${esc(stop.note)}</p>` : ''}
      <div class="stopcard__actions">
        ${photos.length ? `<button type="button" class="button button--primary" data-tour-stop>Play ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}</button>` : ''}
        ${place ? `<a class="button" href="${SITE}#browse/${esc(place.id)}">In the guide</a>` : ''}
        <a class="button" href="${mapsUrl(stop)}" target="_blank" rel="noopener">Maps</a>
      </div>
    </article>
    ${photos.length ? `<div class="gallery">${gallery}</div>` : '<p class="rail__empty">No photos from this stop.</p>'}`;
}

function renderRail() {
  if (state.stop && stops.has(state.stop)) renderStop();
  else if (state.day && dayById.has(state.day)) renderDay();
  else renderOverview();
}

rail.addEventListener('click', (event) => {
  const photo = event.target.closest('[data-photo]');
  if (photo) {
    event.preventDefault();
    navigate({ ...state, photo: photo.dataset.photo });
    return;
  }
  if (event.target.closest('[data-tour-stop]')) return startTour();
  const stop = event.target.closest('[data-stop]');
  if (stop) return navigate({ ...state, stop: stop.dataset.stop, photo: '' });
  const day = event.target.closest('[data-day]');
  if (day) navigate({ day: day.dataset.day, stop: '', photo: '' });
});

function renderChips() {
  const options = [
    { value: '', label: 'All', count: 0 },
    ...days.map((day) => ({ value: day.id, label: dayChipLabel(day.id), count: dayPhotos(day.id).length })),
  ];
  chips.replaceChildren(
    ...options.map(({ value, label, count }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.value = value;
      chip.setAttribute('aria-pressed', String(value === state.day));
      chip.append(label);
      if (count) {
        const badge = document.createElement('span');
        badge.className = 'chip__count';
        badge.textContent = String(count);
        chip.append(badge);
      }
      return chip;
    }),
  );
  const active = chips.querySelector('[aria-pressed="true"]');
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

chips.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  navigate({ day: chip.dataset.value, stop: '', photo: '' });
});

/* --------------------------------------------------------------- lightbox */

const lb = {
  dialog: document.querySelector('[data-lightbox]'),
  img: document.querySelector('[data-lb-img]'),
  counter: document.querySelector('[data-lb-counter]'),
  place: document.querySelector('[data-lb-place]'),
  when: document.querySelector('[data-lb-when]'),
  text: document.querySelector('[data-lb-text]'),
  play: document.querySelector('[data-lb-play]'),
  stage: document.querySelector('[data-lb-stage]'),
};
let deck = [];
let timer = null;

/** What the lightbox flips through: the stop, else the day, else everything. */
const currentDeck = () => (state.stop ? stopPhotos(state.stop) : state.day ? dayPhotos(state.day) : allPhotos());

function setPlaying(on) {
  clearInterval(timer);
  timer = on ? setInterval(() => step(1), SLIDE_MS) : null;
  lb.play.setAttribute('aria-pressed', String(on));
  lb.play.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
  lb.play.querySelector('[data-icon-play]').hidden = on;
  lb.play.querySelector('[data-icon-pause]').hidden = !on;
}

function step(delta) {
  if (!deck.length) return;
  const i = deck.findIndex((photo) => photo.id === state.photo);
  const next = deck[(i + delta + deck.length) % deck.length];
  navigate({ ...state, photo: next.id }, { replace: true });
}

function renderLightbox(prev) {
  const photo = photoById.get(state.photo);
  if (!photo) {
    if (lb.dialog.open) lb.dialog.close();
    setPlaying(false);
    return;
  }
  if (!prev.photo || !deck.includes(photo)) deck = currentDeck();
  if (!deck.includes(photo)) deck = [photo];
  const i = deck.indexOf(photo);
  const stop = stops.get(photo.stop);

  lb.img.src = url(photo.src);
  lb.img.alt = `${stop?.name ?? 'Photo'}, ${localTime(photo.taken)}`;
  lb.counter.textContent = `${i + 1} / ${deck.length}`;
  lb.place.textContent = stop ? `${stop.name}${stop.area ? ` · ${stop.area}` : ''}` : '';
  lb.when.textContent = stop ? `Day ${dayNumber(stop.day)} · ${dayLabel(stop.day)} · ${localTime(photo.taken)}` : localTime(photo.taken);
  lb.text.hidden = !photo.caption;
  lb.text.textContent = photo.caption ?? '';

  // Warm the next frame so flipping feels instant.
  const upcoming = deck[(i + 1) % deck.length];
  if (upcoming && upcoming !== photo) new Image().src = url(upcoming.src);

  if (!lb.dialog.open) lb.dialog.showModal();
}

function startTour() {
  deck = currentDeck();
  if (!deck.length) return;
  navigate({ ...state, photo: deck[0].id });
  setPlaying(true);
}

document.querySelector('[data-tour]').addEventListener('click', startTour);
document.querySelector('[data-lb-prev]').addEventListener('click', () => step(-1));
document.querySelector('[data-lb-next]').addEventListener('click', () => step(1));
document.querySelector('[data-lb-close]').addEventListener('click', () => lb.dialog.close());
lb.play.addEventListener('click', () => setPlaying(!timer));

lb.dialog.addEventListener('close', () => {
  setPlaying(false);
  if (!state.photo) return;
  if (pushedPhoto) {
    pushedPhoto = false;
    history.back();
  } else {
    navigate({ ...state, photo: '' }, { replace: true });
  }
});

lb.dialog.addEventListener('click', (event) => {
  if (event.target === lb.dialog || event.target === lb.stage) lb.dialog.close();
});

lb.dialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key === ' ') {
    event.preventDefault();
    setPlaying(!timer);
  }
});

let swipeStart = null;
lb.stage.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
});
lb.stage.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
});

/* ----------------------------------------------------------------- render */

let first = true;
function render(prev) {
  renderChips();
  drawRoute();
  frame(prev, first);
  drawMarkers();
  renderRail();
  renderLightbox(prev);
  if (hint) hint.hidden = Boolean(state.stop);
  first = false;
}

meta.textContent = `${trip.travellers ?? ''} · 17–25 Oct 2026 · ${countLine(allPhotos().length, allStops().length)}`;
state = resolve(parseHash(location.hash));
render({ day: '', stop: '', photo: '' });
