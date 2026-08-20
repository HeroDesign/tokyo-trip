/**
 * KML + CSV generation for Google My Maps.
 *
 * Pure string functions with no DOM or Node APIs, so the same code backs the
 * in-app download buttons and the `npm run export` build script.
 */
import { THEME_COLORS, themeLabel, typeLabel, mapUrl, TRIP_DAYS } from './data.js';

const xml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** #rrggbb -> KML's aabbggrr byte order. */
const kmlColor = (hex) => {
  const [, r, g, b] = /^#(\w{2})(\w{2})(\w{2})$/.exec(hex) ?? [];
  return r ? `ff${b}${g}${r}`.toLowerCase() : 'ff726b60';
};

const dayLabel = (dayId) => TRIP_DAYS.find((d) => d.id === dayId)?.label ?? '';

export function toKml(places, { name = 'Tokyo Field Guide', days = {} } = {}) {
  const themes = [...new Set(places.map((p) => p.theme))];

  const styles = themes
    .map(
      (theme) => `    <Style id="theme-${theme}">
      <IconStyle>
        <color>${kmlColor(THEME_COLORS[theme] ?? '#726b60')}</color>
        <scale>1.1</scale>
        <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>`,
    )
    .join('\n');

  const placemarks = places
    .map((place) => {
      const assigned = days[place.id] ? `Day: ${dayLabel(days[place.id])}\n` : '';
      const link = place.link ? `\n${place.link}` : '';
      const description = `${place.what}\n\nWhy: ${place.why}\n\n${assigned}${themeLabel(
        place.theme,
      )} / ${typeLabel(place.type)} / ${place.area}${
        place.coordPrecision === 'area' ? '\n(pin is area-level, not the exact address)' : ''
      }${link}`;

      return `    <Placemark>
      <name>${xml(place.name)}</name>
      <description>${xml(description)}</description>
      <styleUrl>#theme-${place.theme}</styleUrl>
      <Point><coordinates>${place.coords[1]},${place.coords[0]},0</coordinates></Point>
    </Placemark>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(name)}</name>
    <description>${xml(`${places.length} places, 16-25 October 2026.`)}</description>
${styles}
${placemarks}
  </Document>
</kml>
`;
}

const cell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(places, { days = {} } = {}) {
  const header = [
    'Name',
    'Theme',
    'Type',
    'Neighborhood',
    'What it is',
    'Why we flagged it',
    'Link',
    'Google Maps',
    'Latitude',
    'Longitude',
    'Pin precision',
    'Day',
  ];

  const rows = places.map((place) => [
    place.name,
    themeLabel(place.theme),
    typeLabel(place.type),
    place.area,
    place.what,
    place.why,
    place.link ?? '',
    mapUrl(place),
    place.coords[0],
    place.coords[1],
    place.coordPrecision,
    dayLabel(days[place.id]),
  ]);

  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
