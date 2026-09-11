/**
 * Entry point: load the data once, wire the three views, route on the hash so
 * a view survives a refresh or a shared link. Related places use
 * #browse/<place-id> to jump to that card.
 */
import { loadPlaces } from './data.js';
import { initStore } from './store.js';
import { initBrowse, subscribeToFilters } from './browse.js';
import { initMap } from './mapview.js';
import { initPlan } from './plan.js';

const VIEWS = ['browse', 'map', 'plan'];

await initStore();
const places = await loadPlaces();

const browse = initBrowse(places);
const showMap = initMap(places, subscribeToFilters);
initPlan(places);

const sections = new Map(
  VIEWS.map((view) => [view, document.querySelector(`section[data-view="${view}"]`)]),
);
const tabs = [...document.querySelectorAll('.tab')];

function parseRoute() {
  const raw = window.location.hash.slice(1);
  const [view = 'browse', placeId = ''] = raw.split('/');
  return { view: VIEWS.includes(view) ? view : 'browse', placeId };
}

function activate() {
  const { view, placeId } = parseRoute();

  for (const [name, section] of sections) section.hidden = name !== view;
  tabs.forEach((tab) => {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  if (view === 'map') showMap();
  if (view === 'browse' && placeId) browse.focusPlace(placeId);
}

tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    window.location.hash = tab.dataset.view;
  }),
);

window.addEventListener('hashchange', activate);
activate();
