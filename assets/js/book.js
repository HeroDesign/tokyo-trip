/**
 * Book view: the pre-trip checklist. Items come from data/checklist.json and
 * are grouped by when they have to happen, not by how much they matter, so the
 * two that can sell out sit at the top rather than buried under the flights.
 *
 * Each row ticks off into localStorage and expands for the detail: why now,
 * what to ask for, and what the fallback is if it is gone. Items that map to a
 * place link through to its Browse card.
 */
import { placeHash } from './data.js';
import { isBooked, toggleBooked, subscribe } from './store.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export async function initBook(places) {
  const root = document.querySelector('section[data-view="book"]');
  if (!root) return;
  const list = root.querySelector('[data-checklist]');
  const stats = root.querySelector('[data-book-stats]');
  const byId = new Map(places.map((place) => [place.id, place]));

  let data;
  try {
    data = await fetch('data/checklist.json').then((r) => r.json());
  } catch {
    list.replaceChildren(el('p', 'empty', 'The checklist could not be loaded.'));
    return;
  }

  // Items whose "done" is baked into the data (flights, hotel) are ticked and
  // stay ticked; everything else is the traveller's own progress.
  const isDone = (item) => item.done === true || isBooked(item.id);
  const openRows = new Set();

  function render() {
    const actionable = data.items.filter((item) => item.done !== true);
    const left = actionable.filter((item) => !isBooked(item.id));
    if (stats) {
      stats.replaceChildren();
      const done = el('span', 'stat');
      done.append(el('strong', null, String(actionable.length - left.length)), document.createTextNode(' of '));
      done.append(el('strong', null, String(actionable.length)), document.createTextNode(' done'));
      stats.append(done);
      const urgent = left.filter((item) => item.urgent).length;
      if (urgent) {
        const flag = el('span', 'stat stat--alert');
        flag.append(el('strong', null, String(urgent)), document.createTextNode(' can sell out'));
        stats.append(flag);
      }
    }

    list.replaceChildren(
      ...data.groups.map((group) => {
        const items = data.items.filter((item) => item.group === group.id);
        if (!items.length) return document.createDocumentFragment();

        const section = el('section', 'check-group');
        const head = el('div', 'check-group__head');
        head.append(el('h3', 'check-group__name', group.label));
        const outstanding = items.filter((item) => !isDone(item)).length;
        head.append(
          el('span', 'check-group__count', outstanding ? `${outstanding} to do` : 'all clear'),
        );
        section.append(head);
        if (group.note) section.append(el('p', 'check-group__note', group.note));

        items.forEach((item) => section.append(row(item)));
        return section;
      }),
    );
  }

  function row(item) {
    const done = isDone(item);
    const details = el('details', `check${done ? ' check--done' : ''}${item.urgent && !done ? ' check--urgent' : ''}`);
    details.open = openRows.has(item.id);
    details.addEventListener('toggle', () => {
      if (details.open) openRows.add(item.id);
      else openRows.delete(item.id);
    });

    const summary = el('summary', 'check__summary');

    const box = el('span', 'check__box');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(done));
    box.setAttribute('aria-label', `Mark ${item.title} done`);
    box.tabIndex = item.done === true ? -1 : 0;
    if (item.done === true) box.classList.add('check__box--fixed');
    const flip = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.done === true) return;
      toggleBooked(item.id);
      render();
    };
    box.addEventListener('click', flip);
    box.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') flip(event);
    });
    summary.append(box);

    const text = el('span', 'check__text');
    const title = el('span', 'check__title', item.title);
    if (item.optional) title.append(el('span', 'check__tag', 'optional'));
    if (item.urgent && !done) title.append(el('span', 'check__tag check__tag--urgent', 'can sell out'));
    text.append(title);
    text.append(el('span', 'check__meta', `${item.for} · ${item.summary}`));
    summary.append(text);
    details.append(summary);

    const body = el('div', 'check__body');
    body.append(el('p', 'check__detail', item.detail));
    const place = item.place ? byId.get(item.place) : null;
    if (place) {
      const link = el('a', 'check__link', `Open the ${place.name} card`);
      link.href = placeHash(place.id);
      body.append(link);
    }
    details.append(body);
    return details;
  }

  render();
  subscribe(render);
}
