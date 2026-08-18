/**
 * Plan view: favorites grouped into itinerary days, plus the Google My Maps
 * exports. Assignments live in localStorage via store.js.
 */
import { TRIP_DAYS, themeLabel, typeLabel } from './data.js';
import { favorites, dayFor, assignDay, toggleFavorite, subscribe } from './store.js';
import { toKml, toCsv } from './export.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const BUCKETS = [{ id: '', label: 'Unassigned', note: 'Starred, not yet slotted' }, ...TRIP_DAYS];

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
  const byId = new Map(places.map((p) => [p.id, p]));

  function render() {
    const starred = favorites()
      .map((id) => byId.get(id))
      .filter(Boolean);

    if (!starred.length) {
      daysContainer.replaceChildren(
        Object.assign(el('p', 'day__empty'), {
          textContent: 'No favorites yet — tap the star on any card in Browse.',
        }),
      );
      return;
    }

    daysContainer.replaceChildren(
      ...BUCKETS.map((bucket) => {
        const inBucket = starred.filter((place) => dayFor(place.id) === bucket.id);
        if (bucket.id === '' && !inBucket.length) return document.createComment('');

        const section = el('section', 'day');
        const head = el('div', 'day__head');
        head.append(el('h3', 'day__name', bucket.label));
        if (bucket.note) head.append(el('span', 'day__note', bucket.note));
        section.append(head);

        if (inBucket.length) {
          inBucket.forEach((place) => section.append(slot(place, byId, render)));
        } else {
          section.append(el('p', 'day__empty', 'Nothing slotted yet'));
        }
        return section;
      }),
    );
  }

  root.querySelector('.plan__buttons').addEventListener('click', (event) => {
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

  subscribe(render);
  render();
  return { render };
}
