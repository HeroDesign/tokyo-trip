/**
 * Favorites, day assignments, and hidden places — persisted to localStorage.
 *
 * On first load, seeds from data/my-settings.json (committed to the repo) so
 * you can sync between devices by updating that file. After that, localStorage
 * takes over. Bumping seedVersion in that file merges new repo favorites/hides
 * into existing local state without wiping stars. Use "Export settings" to get
 * the current state to paste back.
 */

const KEY = 'tokyo-field-guide/v1';
const SETTINGS_URL = 'data/my-settings.json';

const listeners = new Set();

function emptyState() {
  return { favorites: [], days: {}, hidden: [], seedVersion: 0 };
}

export function normalizeSettings(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyState();
  return {
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    seedVersion: Number.isInteger(parsed.seedVersion) ? parsed.seedVersion : 0,
  };
}

/** Apply a newer repo seed on top of existing local settings. */
export function mergeSeed(repo, local) {
  if (!repo) return local ?? emptyState();
  if (!local) return repo;
  if ((local.seedVersion ?? 0) >= (repo.seedVersion ?? 0)) return local;
  return {
    favorites: [...new Set([...local.favorites, ...repo.favorites])],
    days: { ...repo.days, ...local.days },
    hidden: [...new Set([...local.hidden, ...repo.hidden])],
    seedVersion: repo.seedVersion ?? 0,
  };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadRepoSettings() {
  try {
    const res = await fetch(SETTINGS_URL);
    if (!res.ok) return null;
    return normalizeSettings(await res.json());
  } catch {
    return null;
  }
}

let state = readLocal() || emptyState();

export async function initStore() {
  const local = readLocal();
  const repo = await loadRepoSettings();
  state = mergeSeed(repo, local);
  commit();
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
  if (state.favorites.includes(id)) {
    state = {
      ...state,
      favorites: state.favorites.filter((f) => f !== id),
      days: omit(state.days, id),
    };
  } else {
    state = { ...state, favorites: [...state.favorites, id] };
  }
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

export const currentSettings = () => ({
  favorites: [...state.favorites],
  days: { ...state.days },
  hidden: [...state.hidden],
  seedVersion: state.seedVersion ?? 0,
});

/** Replace stars, days and hides. Used by Plan → Import. */
export function importSettings(incoming) {
  const next = normalizeSettings(incoming);
  state = {
    favorites: next.favorites,
    days: next.days,
    hidden: next.hidden,
    seedVersion: Math.max(state.seedVersion ?? 0, next.seedVersion ?? 0),
  };
  commit();
  return currentSettings();
}

function omit(obj, key) {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
}
