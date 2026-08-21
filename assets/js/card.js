/**
 * The place card. Photo, theme tag, neighborhood, what it is, why we flagged
 * it, and the two buttons that matter on the ground: Map and Link.
 */
import { themeLabel, mapUrl } from './data.js';
import { isFavorite, toggleFavorite, isHidden, toggleHidden } from './store.js';

const PIN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * The coloured tile sits underneath the photo. If the image 404s or fails to
 * decode we drop the <img> and the tile shows through, so a card is never blank.
 */
function photo(place) {
  const frame = el('div', 'card__photo');
  const fallback = el('span', 'card__fallback', place.name);
  fallback.setAttribute('aria-hidden', 'true'); // duplicates the card heading below
  frame.append(fallback);

  if (place.image) {
    const img = new Image();
    img.src = place.image;
    img.alt = place.credit?.subject ? `${place.credit.subject} (representative photo)` : place.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    frame.append(img);
  }

  return frame;
}

function starButton(place) {
  const button = el('button', 'card__star', '★');
  button.type = 'button';
  button.title = 'Save to favorites';
  button.setAttribute('aria-label', `Save ${place.name} to favorites`);
  button.setAttribute('aria-pressed', String(isFavorite(place.id)));
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(toggleFavorite(place.id)));
  });
  return button;
}

function hideButton(place, onHide) {
  const button = el('button', 'card__hide', '×');
  button.type = 'button';
  button.title = 'Hide this place';
  button.setAttribute('aria-label', `Hide ${place.name}`);
  button.setAttribute('aria-pressed', String(isHidden(place.id)));
  button.addEventListener('click', () => {
    const nowHidden = toggleHidden(place.id);
    button.setAttribute('aria-pressed', String(nowHidden));
    if (onHide) onHide(place.id, nowHidden);
  });
  return button;
}

export function createCard(place, { onHide } = {}) {
  const card = el('article', 'card');
  card.style.setProperty('--accent', `var(--theme-${place.theme})`);
  card.dataset.id = place.id;

  const frame = photo(place);
  frame.append(hideButton(place, onHide));
  frame.append(starButton(place));

  const tags = el('div', 'card__tags');
  tags.append(el('span', 'tag', themeLabel(place.theme)));
  const area = el('span', 'card__area');
  area.innerHTML = PIN_ICON;
  area.append(document.createTextNode(place.area));
  tags.append(area);

  const body = el('div', 'card__body');
  body.append(tags, el('h2', 'card__name', place.name), el('p', 'card__what', place.what));
  body.append(el('p', 'card__why', place.why));

  const actions = el('div', 'card__actions');
  const map = el('a', 'button button--primary', 'Map');
  map.href = mapUrl(place);
  map.target = '_blank';
  map.rel = 'noopener';
  actions.append(map);

  if (place.link) {
    const link = el('a', 'button', 'Link');
    link.href = place.link;
    link.target = '_blank';
    link.rel = 'noopener';
    actions.append(link);
  }

  body.append(actions);
  card.append(frame, body);
  return card;
}

/** Compact version of the same information, for map pin popups. */
export function popupHtml(place) {
  const link = place.link
    ? `<a class="button" href="${place.link}" target="_blank" rel="noopener">Link</a>`
    : '';
  return `
    <span class="tag" style="background: var(--theme-${place.theme})">${themeLabel(place.theme)}</span>
    <h3 class="popup__name">${place.name}</h3>
    <p class="popup__what">${place.what}</p>
    <p class="popup__why">${place.why}</p>
    <div class="popup__actions">
      <a class="button button--primary" href="${mapUrl(place)}" target="_blank" rel="noopener">Map</a>
      ${link}
    </div>`;
}
