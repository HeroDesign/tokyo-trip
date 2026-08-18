/**
 * Browse view: theme chips, type chips, free-text search, live count, reset.
 * Owns the filter state; the map view subscribes so both views stay in step.
 * The matching rules themselves live in filter.js.
 */
import { THEMES, TYPES } from './data.js';
import { createCard } from './card.js';
import { emptyFilters, filterPlaces, isFiltered } from './filter.js';

const state = emptyFilters();
const listeners = new Set();

export const subscribeToFilters = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function buildChips(container, options, kind) {
  container.replaceChildren(
    ...options.map(({ id, label }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = label;
      chip.dataset.value = id;
      chip.setAttribute('aria-pressed', 'false');
      if (kind === 'theme') chip.style.setProperty('--chip', `var(--theme-${id})`);
      return chip;
    }),
  );
}

export function initBrowse(places) {
  const root = document.querySelector('section[data-view="browse"]');
  const grid = root.querySelector('[data-grid]');
  const empty = root.querySelector('[data-empty]');
  const count = root.querySelector('[data-count]');
  const search = root.querySelector('#search');
  const themeChips = root.querySelector('[data-filter="theme"]');
  const typeChips = root.querySelector('[data-filter="type"]');
  const resetButtons = document.querySelectorAll('[data-reset]');

  buildChips(themeChips, THEMES, 'theme');
  buildChips(typeChips, TYPES, 'type');

  // Cards are built once and shown or hidden, which keeps filtering instant and
  // avoids re-downloading images or losing star state on every keystroke.
  const cards = new Map(places.map((place) => [place.id, createCard(place)]));
  grid.replaceChildren(...cards.values());

  function render() {
    const visible = filterPlaces(places, state);
    const shown = new Set(visible.map((p) => p.id));

    for (const [id, card] of cards) card.hidden = !shown.has(id);

    count.innerHTML = `<strong>${visible.length}</strong> of ${places.length} places`;
    empty.hidden = visible.length > 0;
    resetButtons.forEach((button) => {
      button.hidden = !isFiltered(state);
    });

    listeners.forEach((fn) => fn(visible));
  }

  function toggleChip(container, chip) {
    const set = container === themeChips ? state.themes : state.types;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!pressed));
    if (pressed) set.delete(chip.dataset.value);
    else set.add(chip.dataset.value);
    render();
  }

  for (const container of [themeChips, typeChips]) {
    container.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (chip) toggleChip(container, chip);
    });
  }

  search.addEventListener('input', () => {
    state.search = search.value.trim();
    render();
  });

  root.querySelector('.filters').addEventListener('submit', (event) => event.preventDefault());

  resetButtons.forEach((button) =>
    button.addEventListener('click', () => {
      state.search = '';
      state.themes.clear();
      state.types.clear();
      search.value = '';
      root.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );

  render();
  return { visible: () => filterPlaces(places, state) };
}
