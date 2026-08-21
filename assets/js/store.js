/**
 * Favorites, day assignments, and hidden places — persisted to localStorage.
 *
 * On first load, seeds from data/my-settings.json (committed to the repo) so
 * you can sync between devices by updating that file. After that, localStorage
 * takes over. Use "Export settings" to get the current state to paste back.
 */

const KEY = 'tokyo-field-guide/v1';
const SETTINGS_URL = 'data/my-settings.json';

const listeners = new Set();

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return null;
  }
}

async function loadRepoSettings() {
  try {
    const res = await fetch(SETTINGS_URL);
    if (!res.ok) return null;
    const parsed = await res.json();
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return null;
  }
}

let state = readLocal() || { favorites: [], days: {}, hidden: [] };

export async function initStore() {
  const local = readLocal();
  if (!local) {
    const repo = await loadRepoSettings();
    if (repo) {
      state = repo;
      commit();
    }
  }
}

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

export const isHidden = (id) => state.hidden.includes(id);

export const hiddenPlaces = () => [...state.hidden];

export function toggleHidden(id) {
  state = state.hidden.includes(id)
    ? { ...state, hidden: state.hidden.filter((h) => h !== id) }
    : { ...state, hidden: [...state.hidden, id] };
  commit();
  return isHidden(id);
}

export function exportSettings() {
  return JSON.stringify(state, null, 2);
}

function omit(obj, key) {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
}
