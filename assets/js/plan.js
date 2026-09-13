/**
 * Plan view: a proper trip planner showing all days with favorites slotted in.
 * Always displays the full itinerary structure so you can see the whole trip.
 *
 * Each entry's name and meta line is a link through to its Browse card, which
 * is where the photo, the full description and the outbound link live.
 * Entries can be ordered as starred or grouped by neighborhood, which is how
 * you check a day actually walks in one direction.
 */
import { TRIP_DAYS, themeLabel, typeLabel, HOME_PLACE_ID, placeHash, relatedLabel } from './data.js';
import { favorites, dayFor, assignDay, toggleFavorite, subscribe, currentSettings, importSettings, hiddenPlaces } from './store.js';
import { toKml, toCsv } from './export.js';
import { toBriefing, parseTransfer } from './transfer.js';

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
  // Name and meta are one link to the card. The related links below stay
  // outside it so links are never nested inside one another.
  const open = el('a', 'slot__link');
  open.href = placeHash(place.id);
  open.title = `Open the ${place.name} card`;
  open.append(
    el('div', 'slot__name', place.name),
    el('div', 'slot__meta', `${themeLabel(place.theme)} · ${typeLabel(place.type)} · ${place.area}`),
  );
  text.append(open);

  const relatedPlaces = (place.related ?? []).map((id) => byId.get(id)).filter(Boolean);
  if (relatedPlaces.length) {
    const related = el('div', 'slot__related');
    related.append(document.createTextNode('In the guide: '));
    relatedPlaces.forEach((target, index) => {
      if (index > 0) related.append(document.createTextNode(' · '));
      const a = el('a', 'slot__related-link', relatedLabel(target));
      a.href = placeHash(target.id);
      related.append(a);
    });
    text.append(related);
  }
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

function homeStay(place) {
  const row = el('div', 'slot slot--home');
  row.append(el('span', 'slot__swatch'));
  const text = el('div', 'slot__text');
  text.append(el('div', 'slot__name', place.name), el('div', 'slot__meta', 'Home base · booked'));
  row.append(text);
  return row;
}

function renderStayBanner(place) {
  const banner = document.querySelector('[data-stay-banner]');
  if (!banner || !place) return;
  banner.hidden = false;
  banner.replaceChildren();
  banner.append(el('p', 'stay-banner__kicker', 'Home base · 8 nights'));
  banner.append(el('h2', 'stay-banner__name', place.name));
  banner.append(el('p', 'stay-banner__meta', place.area));
  if (place.link) {
    const link = el('a', 'stay-banner__link', 'Hotel site');
    link.href = place.link;
    link.target = '_blank';
    link.rel = 'noopener';
    banner.append(link);
  }
}

export function initPlan(places) {
  const root = document.querySelector('section[data-view="plan"]');
  const daysContainer = root.querySelector('[data-days]');
  const statsContainer = root.querySelector('[data-stats]');
  const byId = new Map(places.map((p) => [p.id, p]));
  const home = byId.get(HOME_PLACE_ID);
  renderStayBanner(home);

  // The unassigned bucket is collapsed by default and can hold dozens of places,
  // so its open state has to survive the re-render that every star or slot triggers.
  let unassignedOpen = false;

  const sortSelect = root.querySelector('[data-plan-sort]');
  let planSort = sortSelect?.value ?? 'added';

  /**
   * Some areas in the data are compound - "Hanakawado / Asakusa", "Nezu/Yanaka",
   * "Shinjuku (Waseda)". Sorting the raw string files those away from the plain
   * "Asakusa" and "Yanaka" entries they belong beside, so group on the last
   * segment with any parenthetical dropped.
   */
  const areaKey = (place) => place.area.split('/').pop().replace(/\(.*\)/, '').trim();

  /**
   * "As starred" keeps the order you added things, which is the order the seed
   * file lists them in. "By neighborhood" groups a day's stops by area so you
   * can see whether it walks in one direction or zig-zags across the city.
   */
  const ordered = (list) =>
    planSort === 'area'
      ? [...list].sort(
          (a, b) => areaKey(a).localeCompare(areaKey(b)) || a.name.localeCompare(b.name),
        )
      : list;

  sortSelect?.addEventListener('change', () => {
    planSort = sortSelect.value;
    render();
  });

  function render() {
    const starred = favorites()
      .map((id) => byId.get(id))
      .filter(Boolean);
    const activities = starred.filter((p) => p.id !== HOME_PLACE_ID);

    const assigned = activities.filter((p) => dayFor(p.id));
    const unassigned = activities.filter((p) => !dayFor(p.id));

    // Update stats
    if (statsContainer) {
      statsContainer.innerHTML = `
        <span class="stat"><strong>${TRIP_DAYS.length}</strong> days</span>
        <span class="stat"><strong>${activities.length}</strong> starred</span>
        <span class="stat"><strong>${assigned.length}</strong> assigned</span>
        ${unassigned.length ? `<span class="stat stat--alert"><strong>${unassigned.length}</strong> unassigned</span>` : ''}
      `;
    }

    // Build the days grid - always show all days
    const daysHtml = TRIP_DAYS.map((day, index) => {
      const inDay = ordered(activities.filter((place) => dayFor(place.id) === day.id));
      const isTravel = day.note && (day.note.includes('Fly') || day.note.includes('Land'));
      const overnight = index > 0 && index < TRIP_DAYS.length - 1;
      
      const section = el('section', `day ${isTravel ? 'day--travel' : ''}`);
      section.dataset.dayId = day.id;
      
      const head = el('div', 'day__head');
      const dayNum = el('span', 'day__number', `Day ${index + 1}`);
      const dayLabel = el('h3', 'day__name', day.label);
      head.append(dayNum, dayLabel);
      if (day.note) head.append(el('span', 'day__note', day.note));
      section.append(head);

      const content = el('div', 'day__content');
      if (overnight && home) content.append(homeStay(home));
      if (inDay.length) {
        inDay.forEach((place) => content.append(slot(place, byId, render)));
      } else {
        const emptyMsg = isTravel && !overnight
          ? 'Travel day — limited time'
          : 'Drop favorites here';
        content.append(el('p', 'day__empty', emptyMsg));
      }
      section.append(content);
      
      return section;
    });

    // Unassigned bucket - only show if there are unassigned items, and keep it
    // folded away by default so a long shortlist does not bury the days below it.
    let unassignedSection = null;
    if (unassigned.length) {
      const details = el('details', 'day day--unassigned');
      details.open = unassignedOpen;
      details.addEventListener('toggle', () => {
        unassignedOpen = details.open;
      });

      const head = el('summary', 'day__head day__head--toggle');
      head.append(el('h3', 'day__name', 'Unassigned'));
      head.append(el('span', 'day__note', `${unassigned.length} to slot in`));
      details.append(head);

      const content = el('div', 'day__content');
      ordered(unassigned).forEach((place) => content.append(slot(place, byId, render)));
      details.append(content);
      unassignedSection = details;
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

  const status = root.querySelector('[data-transfer-status]');
  const importBox = root.querySelector('[data-import-text]');
  const knownIds = new Set(places.map((place) => place.id));

  const flash = (message, ok = true) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('plan__flash--error', !ok);
  };

  const briefing = () =>
    toBriefing(places, { ...currentSettings(), hidden: hiddenPlaces() });

  async function copyPlan(button) {
    const text = briefing();
    try {
      await navigator.clipboard.writeText(text);
      const label = button.textContent;
      button.textContent = 'Copied!';
      flash('Plan copied. Paste it into Notes, ChatGPT or Claude.');
      setTimeout(() => {
        button.textContent = label;
      }, 2000);
    } catch {
      window.prompt('Copy this plan:', text);
    }
  }

  async function sharePlan() {
    const text = briefing();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Tokyo Field Guide plan', text });
        flash('Plan shared. Save it in Notes or Files for later.');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await copyPlan(root.querySelector('[data-transfer="copy"]'));
  }

  function importPlan() {
    const raw = importBox?.value ?? '';
    let result;
    try {
      result = parseTransfer(raw, knownIds);
    } catch (error) {
      flash(error.message || 'Could not read that plan.', false);
      return;
    }
    if (!window.confirm('Replace the stars and day plan on this phone with the pasted plan?')) return;
    importSettings(result.settings);
    const skipped = result.skipped.length
      ? ` Ignored ${result.skipped.length} unknown id${result.skipped.length === 1 ? '' : 's'}.`
      : '';
    flash(`Restored ${result.settings.favorites.length} starred place${result.settings.favorites.length === 1 ? '' : 's'}.${skipped}`);
    importBox.value = '';
    render();
  }

  root.querySelector('.plan__sync').addEventListener('click', (event) => {
    const action = event.target.closest('[data-transfer]')?.dataset.transfer;
    if (!action) return;
    if (action === 'share') sharePlan();
    else if (action === 'copy') copyPlan(event.target.closest('[data-transfer]'));
    else if (action === 'file') download('tokyo-field-guide-plan.md', briefing(), 'text/markdown;charset=utf-8');
    else if (action === 'import') importPlan();
  });

  subscribe(render);
  render();
  return { render };
}
