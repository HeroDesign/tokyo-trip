/**
 * Browse view: theme chips, type chips, free-text search, live count, reset.
 * Owns the filter state; the map view subscribes so both views stay in step.
 * The matching rules themselves live in filter.js.
 */
import { THEMES, TYPES, HOME_PLACE_ID } from './data.js';
import { createCard } from './card.js';
import { emptyFilters, filterPlaces, isFiltered } from './filter.js';
import { isFavorite, isHidden, hiddenPlaces, subscribe as subscribeStore } from './store.js';

const state = emptyFilters();
let showHidden = false;
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
  const showHiddenToggle = root.querySelector('#show-hidden');
  const hiddenCount = root.querySelector('[data-hidden-count]');

  buildChips(themeChips, THEMES, 'theme');
  buildChips(typeChips, TYPES, 'type');

  function render() {
    const hidden = new Set(hiddenPlaces());
    const filtered = filterPlaces(places, state);
    const visible = showHidden ? filtered : filtered.filter((p) => !hidden.has(p.id));
    const shown = new Set(visible.map((p) => p.id));

    for (const [id, card] of cards) {
      card.hidden = !shown.has(id);
      card.classList.toggle('card--hidden-place', hidden.has(id));
    }

    const hiddenInView = filtered.filter((p) => hidden.has(p.id)).length;
    if (hiddenCount) {
      hiddenCount.textContent = hidden.size > 0 ? `(${hidden.size} hidden)` : '';
    }

    count.innerHTML = `<strong>${visible.length}</strong> of ${places.length} places`;
    empty.hidden = visible.length > 0;
    resetButtons.forEach((button) => {
      button.hidden = !isFiltered(state);
    });

    listeners.forEach((fn) => fn(visible));
  }

  // Cards are built once and shown or hidden, which keeps filtering instant and
  // avoids re-downloading images or losing star state on every keystroke.
  // The booked hotel stays at the top of the grid so it is easy to find.
  const ordered = [...places].sort((a, b) => {
    if (a.id === HOME_PLACE_ID) return -1;
    if (b.id === HOME_PLACE_ID) return 1;
    return 0;
  });
  const byId = new Map(places.map((place) => [place.id, place]));
  const cards = new Map(
    ordered.map((place) => [place.id, createCard(place, { onHide: () => render(), byId })]),
  );
  grid.replaceChildren(...cards.values());

  if (showHiddenToggle) {
    showHiddenToggle.addEventListener('change', () => {
      showHidden = showHiddenToggle.checked;
      render();
    });
  }

  // Re-render when store changes (hide/star/import) so cards stay in sync.
  subscribeStore(() => {
    for (const [id, card] of cards) {
      card.querySelector('.card__star')?.setAttribute('aria-pressed', String(isFavorite(id)));
    }
    render();
  });

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

  function applySearch() {
    state.search = search.value.trim();
    render();
  }

  // `search` covers Safari's native clear (×) which does not always fire `input`.
  search.addEventListener('input', applySearch);
  search.addEventListener('search', applySearch);
  search.addEventListener('change', applySearch);

  root.querySelector('.filters').addEventListener('submit', (event) => event.preventDefault());

  function resetFilters() {
    state.search = '';
    state.themes.clear();
    state.types.clear();
    search.value = '';
    root.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
    render();
  }

  resetButtons.forEach((button) =>
    button.addEventListener('click', (event) => {
      event.preventDefault();
      resetFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );

  function focusPlace(id) {
    const card = cards.get(id);
    if (!card) return;
    if (isFiltered(state) || card.hidden) resetFilters();
    requestAnimationFrame(() => {
      card.classList.add('card--focus');
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => card.classList.remove('card--focus'), 2500);
    });
  }

  render();
  return { visible: () => filterPlaces(places, state), focusPlace };
}
