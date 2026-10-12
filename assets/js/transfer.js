/**
 * LLM-friendly export of starred places and the day plan, plus a parser that
 * can restore that JSON (or the older my-settings.json shape) back into the app.
 */
import { HOME_PLACE_ID, TRIP_DAYS, themeLabel, typeLabel, mapUrl } from './data.js';

export const TRANSFER_KIND = 'tokyo-field-guide-transfer';

const dayLabel = (dayId) => TRIP_DAYS.find((day) => day.id === dayId)?.label ?? '';

const asId = (item) => (typeof item === 'string' ? item : item?.id);

function extractJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('Nothing to import');

  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(fences[i][1]);
    } catch {
      /* try the next fence, then the whole blob */
    }
  }

  return JSON.parse(trimmed);
}

/** Snapshot the plan as structured JSON an LLM can read and the app can import. */
export function toTransfer(places, { favorites = [], days = {}, hidden = [], seedVersion = 0 } = {}) {
  const byId = new Map(places.map((place) => [place.id, place]));
  const home = byId.get(HOME_PLACE_ID);

  return {
    kind: TRANSFER_KIND,
    version: 1,
    seedVersion,
    trip: 'Alan and Ever, 16–25 Oct 2026, eight nights at OMO3 Asakusa',
    hotel: home ? { id: home.id, name: home.name, area: home.area } : null,
    favorites: favorites.map((id) => {
      const place = byId.get(id);
      const day = days[id] || '';
      if (!place) return { id, missing: true, day: day || null };
      return {
        id: place.id,
        name: place.name,
        theme: themeLabel(place.theme),
        type: typeLabel(place.type),
        area: place.area,
        what: place.what,
        why: place.why,
        day: day || null,
        dayLabel: day ? dayLabel(day) : null,
        maps: mapUrl(place),
        link: place.link,
      };
    }),
    hidden: [...hidden],
    days: { ...days },
  };
}

/** Markdown briefing plus a JSON block so one clipboard paste works for chat or restore. */
export function toBriefing(places, snapshot) {
  const transfer = toTransfer(places, snapshot);
  const byId = new Map(places.map((place) => [place.id, place]));
  const home = byId.get(HOME_PLACE_ID);
  const starred = snapshot.favorites.map((id) => byId.get(id)).filter(Boolean);
  const activities = starred.filter((place) => place.id !== HOME_PLACE_ID);
  const assigned = (dayId) => activities.filter((place) => snapshot.days[place.id] === dayId);
  const unassigned = activities.filter((place) => !snapshot.days[place.id]);

  const lineFor = (place) => {
    const day = snapshot.days[place.id];
    const when = day ? ` · ${dayLabel(day)}` : '';
    return `- **${place.name}** — ${place.area} · ${themeLabel(place.theme)} · ${typeLabel(place.type)}${when}\n  ${place.what}\n  Why: ${place.why}`;
  };

  const dayBlocks = TRIP_DAYS.map((day, index) => {
    const note = day.note ? ` — ${day.note}` : '';
    const overnight = index > 0 && index < TRIP_DAYS.length - 1 && home;
    const inDay = assigned(day.id);
    const items = [
      overnight ? `- **${home.name}** — home base, booked` : '',
      ...inDay.map(lineFor),
    ].filter(Boolean);
    const body = items.length ? items.join('\n') : '- (nothing slotted)';
    return `### ${day.label}${note}\n${body}`;
  });

  const hidden = (snapshot.hidden ?? []).map((id) => byId.get(id)?.name ?? id);

  return `# Tokyo Field Guide — Alan & Ever
16–25 Oct 2026. Home: ${home ? `${home.name} (${home.area})` : 'OMO3 Asakusa'}.

Starred **${starred.length}** place${starred.length === 1 ? '' : 's'}. Paste this into ChatGPT or Claude to talk about the trip. To put stars and days back on a phone, paste this whole note (or just the JSON at the bottom) into Plan → Import.

## Starred
${starred.length ? starred.map(lineFor).join('\n') : '- (none yet)'}

## Day by day
${dayBlocks.join('\n\n')}

## Unassigned
${unassigned.length ? unassigned.map(lineFor).join('\n') : '- (all slotted)'}
${hidden.length ? `\n## Hidden\n${hidden.map((name) => `- ${name}`).join('\n')}\n` : ''}
## Machine copy
Keep this JSON if you want to import the plan back into the app.

\`\`\`json
${JSON.stringify(transfer, null, 2)}
\`\`\`
`;
}

/**
 * Accepts transfer JSON, a briefing that still contains that JSON, or the older
 * `{ favorites, days, hidden }` settings file. Unknown place ids are dropped.
 */
export function settingsFromTransfer(data, knownIds) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Not a plan JSON object');
  }

  const rawList = data.favorites ?? data.starred ?? [];
  if (!Array.isArray(rawList)) throw new Error('JSON needs a favorites list');

  const ids = [];
  const days = {};
  for (const item of rawList) {
    const id = asId(item);
    if (!id) continue;
    ids.push(id);
    if (item && typeof item === 'object' && item.day) days[id] = item.day;
  }

  if (data.days && typeof data.days === 'object') {
    for (const [id, day] of Object.entries(data.days)) {
      if (day) days[id] = day;
    }
  }

  const hidden = Array.isArray(data.hidden) ? data.hidden.filter(Boolean) : [];
  const unique = [...new Set(ids)];
  const known = knownIds ? unique.filter((id) => knownIds.has(id)) : unique;
  const skipped = knownIds ? unique.filter((id) => !knownIds.has(id)) : [];
  const keep = new Set(known);

  return {
    settings: {
      favorites: known,
      days: Object.fromEntries(Object.entries(days).filter(([id, day]) => keep.has(id) && day)),
      hidden: [...new Set(hidden.filter((id) => !knownIds || knownIds.has(id)))],
      seedVersion: Number.isInteger(data.seedVersion) ? data.seedVersion : 0,
    },
    skipped,
  };
}

export function parseTransfer(text, knownIds) {
  try {
    return settingsFromTransfer(extractJson(text), knownIds);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('That does not look like a saved plan. Paste the whole copied plan, or the JSON block at the bottom.');
    }
    throw error;
  }
}
