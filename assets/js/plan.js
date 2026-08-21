/**
 * Plan view: a proper trip planner showing all days with favorites slotted in.
 * Always displays the full itinerary structure so you can see the whole trip.
 */
import { TRIP_DAYS, themeLabel, typeLabel } from './data.js';
import { favorites, dayFor, assignDay, toggleFavorite, subscribe, exportSettings } from './store.js';
import { toKml, toCsv } from './export.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const UNASSIGNED = { id: '', label: 'Unassigned', note: 'Starred, not yet slotted' };
const BUCKETS = [UNASSIGNED, ...TRIP_DAYS];

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function slot(place, byId, rerender) {
  const row = el('div', 'slot');
  row.style.setProperty('--accent', `var(--theme-${place.theme})`);
  row.append(el('span', 'slot__swatch'));

  const text = el('div', 'slot__text');
  text.append(
    el('div', 'slot__name', place.name),
    el('div', 'slot__meta', `${themeLabel(place.theme)} · ${typeLabel(place.type)} · ${place.area}`),
  );
  row.append(text);

  const select = document.createElement('select');
  select.setAttribute('aria-label', `Day for ${place.name}`);
  select.replaceChildren(
    ...BUCKETS.map((bucket) => new Option(bucket.label, bucket.id, false, dayFor(place.id) === bucket.id)),
  );
  select.addEventListener('change', () => assignDay(place.id, select.value));
  row.append(select);

  const remove = el('button', 'slot__remove', '×');
  remove.type = 'button';
  remove.title = 'Remove from favorites';
  remove.setAttribute('aria-label', `Remove ${place.name} from favorites`);
  remove.addEventListener('click', () => {
    toggleFavorite(place.id);
    // Keep the star on the matching Browse card in sync.
    document
      .querySelector(`.card[data-id="${place.id}"] .card__star`)
      ?.setAttribute('aria-pressed', 'false');
    rerender();
  });
  row.append(remove);

  return row;
}

export function initPlan(places) {
  const root = document.querySelector('section[data-view="plan"]');
  const daysContainer = root.querySelector('[data-days]');
  const statsContainer = root.querySelector('[data-stats]');
  const byId = new Map(places.map((p) => [p.id, p]));

  function render() {
    const starred = favorites()
      .map((id) => byId.get(id))
      .filter(Boolean);

    const assigned = starred.filter((p) => dayFor(p.id));
    const unassigned = starred.filter((p) => !dayFor(p.id));

    // Update stats
    if (statsContainer) {
      statsContainer.innerHTML = `
        <span class="stat"><strong>${TRIP_DAYS.length}</strong> days</span>
        <span class="stat"><strong>${starred.length}</strong> starred</span>
        <span class="stat"><strong>${assigned.length}</strong> assigned</span>
        ${unassigned.length ? `<span class="stat stat--alert"><strong>${unassigned.length}</strong> unassigned</span>` : ''}
      `;
    }

    // Build the days grid - always show all days
    const daysHtml = TRIP_DAYS.map((day, index) => {
      const inDay = starred.filter((place) => dayFor(place.id) === day.id);
      const isTravel = day.note && (day.note.includes('Fly') || day.note.includes('Land'));
      
      const section = el('section', `day ${isTravel ? 'day--travel' : ''}`);
      section.dataset.dayId = day.id;
      
      const head = el('div', 'day__head');
      const dayNum = el('span', 'day__number', `Day ${index + 1}`);
      const dayLabel = el('h3', 'day__name', day.label);
      head.append(dayNum, dayLabel);
      if (day.note) head.append(el('span', 'day__note', day.note));
      section.append(head);

      const content = el('div', 'day__content');
      if (inDay.length) {
        inDay.forEach((place) => content.append(slot(place, byId, render)));
      } else {
        const emptyMsg = isTravel 
          ? 'Travel day — limited time' 
          : 'Drop favorites here';
        content.append(el('p', 'day__empty', emptyMsg));
      }
      section.append(content);
      
      return section;
    });

    // Unassigned bucket - only show if there are unassigned items
    let unassignedSection = null;
    if (unassigned.length) {
      unassignedSection = el('section', 'day day--unassigned');
      const head = el('div', 'day__head');
      head.append(el('h3', 'day__name', 'Unassigned'));
      head.append(el('span', 'day__note', `${unassigned.length} to slot in`));
      unassignedSection.append(head);
      
      const content = el('div', 'day__content');
      unassigned.forEach((place) => content.append(slot(place, byId, render)));
      unassignedSection.append(content);
    }

    // Empty state prompt if no favorites at all
    let emptyPrompt = null;
    if (!starred.length) {
      emptyPrompt = el('div', 'plan__empty-prompt');
      emptyPrompt.innerHTML = `
        <p class="plan__empty-text">Star places in Browse to add them to your trip</p>
        <p class="plan__empty-hint">Use the ★ button on any card</p>
      `;
    }

    daysContainer.replaceChildren(
      ...(emptyPrompt ? [emptyPrompt] : []),
      ...(unassignedSection ? [unassignedSection] : []),
      ...daysHtml
    );
  }

  root.querySelector('.plan__export .plan__buttons').addEventListener('click', (event) => {
    const kind = event.target.closest('[data-export]')?.dataset.export;
    if (!kind) return;

    const [format, scope] = kind.split('-');
    const selection =
      scope === 'favorites' ? favorites().map((id) => byId.get(id)).filter(Boolean) : places;

    if (!selection.length) {
      window.alert('No favorites starred yet.');
      return;
    }

    const days = Object.fromEntries(selection.map((p) => [p.id, dayFor(p.id)]).filter(([, d]) => d));
    const stem = `tokyo-field-guide-${scope}`;

    if (format === 'kml') {
      download(`${stem}.kml`, toKml(selection, { name: 'Tokyo Field Guide', days }), 'application/vnd.google-earth.kml+xml');
    } else {
      download(`${stem}.csv`, toCsv(selection, { days }), 'text/csv;charset=utf-8');
    }
  });

  root.querySelector('.plan__sync .plan__buttons').addEventListener('click', async (event) => {
    if (!event.target.closest('[data-settings="export"]')) return;
    try {
      await navigator.clipboard.writeText(exportSettings());
      event.target.textContent = 'Copied!';
      setTimeout(() => { event.target.textContent = 'Copy settings to clipboard'; }, 2000);
    } catch {
      window.prompt('Copy this JSON to data/my-settings.json:', exportSettings());
    }
  });

  subscribe(render);
  render();
  return { render };
}
