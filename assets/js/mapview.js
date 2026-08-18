/**
 * Map view: every place as a pin on one Leaflet/OpenStreetMap map, tapping a
 * pin opens the same card information. Pins follow the Browse filters.
 *
 * Filled pin = exact position. Hollow pin = area-level, because plenty of the
 * small shops have no address I could verify; the Map button in the popup goes
 * to a Google Maps name search, which is what you actually navigate with.
 */
import { THEME_COLORS } from './data.js';
import { popupHtml } from './card.js';

const TOKYO = [35.6812, 139.7671];

export function initMap(places, subscribeToFilters) {
  const container = document.getElementById('map');
  let map = null;
  let layer = null;

  const pinFor = (place) =>
    L.divIcon({
      className: '',
      html: `<div class="pin ${place.coordPrecision === 'area' ? 'pin--area' : ''}" style="background:${
        THEME_COLORS[place.theme]
      };color:${THEME_COLORS[place.theme]}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8],
    });

  function draw(visible) {
    if (!map) return;
    layer?.remove();
    layer = L.layerGroup(
      visible.map((place) =>
        L.marker(place.coords, { icon: pinFor(place), title: place.name }).bindPopup(popupHtml(place)),
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
      map = L.map(container, { scrollWheelZoom: false }).setView(TOKYO, 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      draw(latest);
    }
    map.invalidateSize();
  };
}
