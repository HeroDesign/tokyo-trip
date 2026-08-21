/**
 * Dataset loading plus the fixed vocabularies the UI is built from.
 * Both JSON files are static, so one fetch at start-up covers the whole app.
 */

export const THEMES = [
  { id: 'capybara', label: 'Capybara' },
  { id: 'drums', label: 'Drums' },
  { id: 'photography', label: 'Photography' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'vr', label: 'VR/tech' },
  { id: 'ramen', label: 'Ramen/food' },
  { id: 'sampling', label: 'Sampling' },
  { id: 'soundgear', label: 'Sound/gear' },
  { id: 'menswear', label: 'Menswear' },
  { id: 'rock', label: 'Rock/live' },
  { id: 'core', label: 'Core/other' },
];

export const TYPES = [
  { id: 'see', label: 'See' },
  { id: 'do', label: 'Do' },
  { id: 'eat', label: 'Eat' },
  { id: 'shop', label: 'Shop' },
  { id: 'animals', label: 'Animals' },
  { id: 'sample', label: 'Sample' },
  { id: 'stay', label: 'Stay' },
  { id: 'trip', label: 'Day trip' },
];

/** Hex per theme, mirroring the custom properties in styles.css. */
export const THEME_COLORS = {
  capybara: '#a9701f',
  drums: '#c23b28',
  photography: '#1f7c90',
  drawing: '#6a49b0',
  vr: '#b23286',
  ramen: '#bf8a12',
  sampling: '#2f8f4d',
  soundgear: '#3b6ea5',
  menswear: '#8a5a3c',
  rock: '#e91e63',
  core: '#726b60',
};

/**
 * The trip itself: out on JL001 Fri 16 Oct, landing Sat 17 Oct 15:05, home on
 * JL002 Sun 25 Oct 17:55. Eight nights on the ground in Asakusa.
 */
export const TRIP_DAYS = [
  { id: '2026-10-16', note: 'Fly SFO 11:55 (JL001)' },
  { id: '2026-10-17', note: 'Land HND 15:05' },
  { id: '2026-10-18', note: '' },
  { id: '2026-10-19', note: '' },
  { id: '2026-10-20', note: '' },
  { id: '2026-10-21', note: '' },
  { id: '2026-10-22', note: '' },
  { id: '2026-10-23', note: '' },
  { id: '2026-10-24', note: '' },
  { id: '2026-10-25', note: 'Fly home 17:55 (JL002)' },
].map((day) => {
  const date = new Date(`${day.id}T00:00:00Z`);
  return {
    ...day,
    label: date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
  };
});

const themeLabels = Object.fromEntries(THEMES.map((t) => [t.id, t.label]));
const typeLabels = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

export const themeLabel = (id) => themeLabels[id] ?? id;
export const typeLabel = (id) => typeLabels[id] ?? id;

/** Deep link that opens in Google Maps, or Apple Maps on iOS. */
export const mapUrl = (place) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.mapQuery)}`;

/**
 * Loads places and merges in the locally cached photo filename. Places without
 * a cached photo simply get no image and fall back to a coloured tile.
 */
export async function loadPlaces() {
  const [places, credits] = await Promise.all([
    fetch('data/places.json').then((r) => r.json()),
    fetch('data/image-credits.json')
      .then((r) => r.json())
      .catch(() => ({})),
  ]);

  return places.map((place) => ({
    ...place,
    image: credits[place.id] ? `images/${credits[place.id].file}` : null,
    credit: credits[place.id] ?? null,
  }));
}
