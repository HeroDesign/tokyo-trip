/**
 * Entry point: load the data once, wire the three views, route on the hash so
 * a view survives a refresh or a shared link.
 */
import { loadPlaces } from './data.js';
import { initBrowse, subscribeToFilters } from './browse.js';
import { initMap } from './mapview.js';
import { initPlan } from './plan.js';

const VIEWS = ['browse', 'map', 'plan'];

const places = await loadPlaces();

initBrowse(places);
const showMap = initMap(places, subscribeToFilters);
initPlan(places);

const sections = new Map(
  VIEWS.map((view) => [view, document.querySelector(`section[data-view="${view}"]`)]),
);
const tabs = [...document.querySelectorAll('.tab')];

function activate(view) {
  const target = VIEWS.includes(view) ? view : 'browse';

  for (const [name, section] of sections) section.hidden = name !== target;
  tabs.forEach((tab) => {
    if (tab.dataset.view === target) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  if (target === 'map') showMap();
}

tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    window.location.hash = tab.dataset.view;
  }),
);

window.addEventListener('hashchange', () => activate(window.location.hash.slice(1)));
activate(window.location.hash.slice(1));
