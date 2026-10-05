/**
 * Filter logic, kept free of the DOM so it can be tested directly.
 *
 * Rules: themes and types are OR within a group and AND across groups, so
 * "Photography + Drawing" plus "Shop" means any photo-or-drawing shop. Search
 * terms are AND, matched against name, area, description, the why note and the
 * human-readable theme and type labels.
 */
import { themeLabel, typeLabel } from './data.js';

export const emptyFilters = () => ({ search: '', themes: new Set(), types: new Set() });

export const isFiltered = (state) =>
  state.search.trim() !== '' || state.themes.size > 0 || state.types.size > 0;

const haystack = (place) =>
  [place.name, place.area, place.what, place.why, themeLabel(place.theme), typeLabel(place.type)]
    .join(' ')
    .toLowerCase();

export function matches(place, state) {
  if (state.themes.size && !state.themes.has(place.theme)) return false;
  if (state.types.size && !state.types.has(place.type)) return false;

  const terms = state.search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const text = haystack(place);
  return terms.every((term) => text.includes(term));
}

export const filterPlaces = (places, state) => places.filter((place) => matches(place, state));
