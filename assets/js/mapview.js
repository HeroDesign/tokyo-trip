/**
 * Map view: every place as a pin on one Leaflet/OpenStreetMap map, tapping a
 * pin opens the same card information. Pins follow the Browse filters.
 *
 * Filled pin = exact position. Hollow pin = area-level, because plenty of the
 * small shops have no address I could verify; the Map button in the popup goes
 * to a Google Maps name search, which is what you actually navigate with.
 *
 * The booked hotel is always on the map as a larger home pin, even when the
 * current filters would otherwise hide lodging.
 *
 * A day filter sits above the map: picking a day shows only the places slotted
 * into it in Plan and zooms to them, which is how you check whether a day's
 * stops actually sit near each other. It intersects with the Browse filters.
 *
 * Basemap is Esri World Street Map so labels include English (Asakusa, Senso-ji)
 * instead of OSM's Japanese-only names. CARTO Voyager watermarks without an API key.
 */
import { THEME_COLORS, HOME_PLACE_ID, englishAreaMapUrl, TRIP_DAYS } from './data.js';
import { popupHtml } from './card.js';
import { dayFor, subscribe as subscribeStore } from './store.js';

const TOKYO = [35.6812, 139.7671];

export function initMap(places, subscribeToFilters) {
  const container = document.getElementById('map');
  const dayChips = document.querySelector('[data-day-chips]');
  const dayStatus = document.querySelector('[data-day-status]');
  const home = places.find((place) => place.id === HOME_PLACE_ID);
  const byId = new Map(places.map((place) => [place.id, place]));
  let map = null;
  let layer = null;
  let dayFilter = '';

  const pinFor = (place) => {
    const isHome = place.id === HOME_PLACE_ID;
    const size = isHome ? 26 : 20;
    return L.divIcon({
      className: '',
      html: `<div class="pin ${place.coordPrecision === 'area' ? 'pin--area' : ''} ${
        isHome ? 'pin--home' : ''
      }" style="background:${THEME_COLORS[place.theme]};color:${THEME_COLORS[place.theme]}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, isHome ? -14 : -11],
    });
  };

  function withHome(visible) {
    if (!home) return visible;
    if (visible.some((place) => place.id === home.id)) return visible;
    return [...visible, home];
  }

  /** Places left after the Browse filters and the day filter are both applied. */
  const forDay = (visible) =>
    dayFilter ? visible.filter((place) => dayFor(place.id) === dayFilter) : visible;

  function draw(visible) {
    const onDay = forDay(visible);
    renderStatus(onDay.length);
    if (!map) return;
    layer?.remove();
    layer = L.layerGroup(
      withHome(onDay).map((place) =>
        L.marker(place.coords, { icon: pinFor(place), title: place.name, zIndexOffset: place.id === HOME_PLACE_ID ? 1000 : 0 }).bindPopup(
          popupHtml(place, { byId }),
        ),
      ),
    ).addTo(map);
  }

  function renderStatus(count) {
    if (!dayStatus) return;
    if (!dayFilter) {
      dayStatus.textContent = '';
      return;
    }
    const day = TRIP_DAYS.find((entry) => entry.id === dayFilter);
    dayStatus.textContent = `${count} ${count === 1 ? 'stop' : 'stops'} on ${day?.label ?? dayFilter}, plus your hotel. `;
  }

  /**
   * Frame the chosen day. Fitting to the day's own stops rather than including
   * the hotel keeps a tight cluster like Harajuku readable; a day trip simply
   * zooms out far enough to show it.
   */
  function frame(visible) {
    if (!map) return;
    const onDay = forDay(visible).filter((place) => place.id !== HOME_PLACE_ID);
    if (!dayFilter || !onDay.length) {
      map.setView(home?.coords ?? TOKYO, home ? 13 : 11);
      return;
    }
    map.fitBounds(L.latLngBounds(onDay.map((place) => place.coords)), {
      padding: [40, 40],
      maxZoom: 15,
    });
  }

  let latest = places;
  subscribeToFilters((visible) => {
    latest = visible;
    draw(visible);
  });

  /**
   * Only offer days that actually hold something. Assignments change in Plan,
   * so the row is rebuilt whenever the store does.
   */
  function buildDayChips() {
    if (!dayChips) return;
    const counts = new Map();
    for (const place of places) {
      const day = dayFor(place.id);
      if (day && place.id !== HOME_PLACE_ID) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    if (dayFilter && !counts.has(dayFilter)) dayFilter = '';

    const options = [
      { value: '', label: 'All days' },
      ...TRIP_DAYS.filter((day) => counts.has(day.id)).map((day) => ({
        value: day.id,
        // "Sat 17 Oct" is too wide for a chip row on a phone and the month repeats.
        // Some engines format the label as "Sat, 17 Oct", so drop the comma too.
        label: day.label.split(' ').slice(0, 2).join(' ').replace(',', ''),
        count: counts.get(day.id),
      })),
    ];

    dayChips.replaceChildren(
      ...options.map(({ value, label, count }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.value = value;
        chip.setAttribute('aria-pressed', String(value === dayFilter));
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
  }

  dayChips?.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    dayFilter = chip.dataset.value;
    for (const other of dayChips.querySelectorAll('.chip')) {
      other.setAttribute('aria-pressed', String(other.dataset.value === dayFilter));
    }
    draw(latest);
    frame(latest);
  });

  buildDayChips();
  subscribeStore(() => {
    const before = dayFilter;
    buildDayChips();
    if (before !== dayFilter) draw(latest);
  });

  /**
   * Leaflet needs a laid-out container, and this one starts hidden, so the map
   * is created the first time the tab is opened rather than at start-up.
   */
  return function show() {
    if (!map) {
      const origin = home?.coords ?? TOKYO;
      map = L.map(container, { scrollWheelZoom: false }).setView(origin, home ? 13 : 11);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
      }).addTo(map);
      const englishMap = document.querySelector('[data-english-map]');
      if (englishMap) englishMap.href = englishAreaMapUrl(origin, 14);
      draw(latest);
    }
    map.invalidateSize();
  };
}
