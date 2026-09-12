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
 * Basemap is Esri World Street Map so labels include English (Asakusa, Senso-ji)
 * instead of OSM's Japanese-only names. CARTO Voyager watermarks without an API key.
 */
import { THEME_COLORS, HOME_PLACE_ID, englishAreaMapUrl } from './data.js';
import { popupHtml } from './card.js';

const TOKYO = [35.6812, 139.7671];

export function initMap(places, subscribeToFilters) {
  const container = document.getElementById('map');
  const home = places.find((place) => place.id === HOME_PLACE_ID);
  const byId = new Map(places.map((place) => [place.id, place]));
  let map = null;
  let layer = null;

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

  function draw(visible) {
    if (!map) return;
    layer?.remove();
    layer = L.layerGroup(
      withHome(visible).map((place) =>
        L.marker(place.coords, { icon: pinFor(place), title: place.name, zIndexOffset: place.id === HOME_PLACE_ID ? 1000 : 0 }).bindPopup(
          popupHtml(place, { byId }),
        ),
      ),
    ).addTo(map);
  }

  let latest = places;
  subscribeToFilters((visible) => {
    latest = visible;
    draw(visible);
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
