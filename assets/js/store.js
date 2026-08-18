/**
 * Favorites and day assignments, persisted to localStorage.
 *
 * Deliberately device-local: no accounts, no sync, nothing to fail on hotel
 * wifi. Subscribers re-render when anything changes.
 */

const KEY = 'tokyo-field-guide/v1';

const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { favorites: [], days: {} };
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    };
  } catch {
    return { favorites: [], days: {} };
  }
}

let state = read();

function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode or full quota - the session still works, it just won't persist */
  }
  listeners.forEach((fn) => fn(state));
}

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const isFavorite = (id) => state.favorites.includes(id);

export const favorites = () => [...state.favorites];

export function toggleFavorite(id) {
  state = state.favorites.includes(id)
    ? { favorites: state.favorites.filter((f) => f !== id), days: omit(state.days, id) }
    : { ...state, favorites: [...state.favorites, id] };
  commit();
  return isFavorite(id);
}

export const dayFor = (id) => state.days[id] ?? '';

export function assignDay(id, dayId) {
  state = { ...state, days: dayId ? { ...state.days, [id]: dayId } : omit(state.days, id) };
  commit();
}

function omit(obj, key) {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
}
