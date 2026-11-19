/** Tiny DOM helpers. Text always goes through textContent, so server output is never parsed as HTML. */

/**
 * @param {string} tag
 * @param {{className?: string, text?: string, attrs?: Record<string, string>}} [options]
 * @param {...(Node|null|undefined|false)} children
 */
export function el(tag, { className, text, attrs = {} } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children.filter(Boolean));
  return node;
}

/** A bordered list; `render` returns the children of each item. */
export const list = (items, render, className = 'list') =>
  el('ul', { className }, ...items.map((item) => el('li', {}, ...render(item))));

/** A list of plain strings. */
export const plainList = (items) => list(items, (text) => [document.createTextNode(text)]);

/** A titled section card that can be linked to by id. */
export const card = (id, title, ...children) =>
  el('section', { className: 'card', attrs: { id } }, el('h2', { text: title }), ...children);

let foldCount = 0;

/**
 * A titled card whose body starts collapsed (WAI-ARIA disclosure pattern: a real heading wrapping a button).
 * Keeps long results short while every section stays one tap away.
 * @param {string} id
 * @param {string} title
 * @param {string} summary short teaser shown next to the title, e.g. "4 ideas"
 */
export function foldCard(id, title, summary, ...children) {
  foldCount += 1;
  const bodyId = `${id}-body-${foldCount}`;
  const button = el(
    'button',
    { className: 'fold-toggle', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId } },
    el('span', { text: title }),
    el('span', { className: 'fold-summary', text: summary }),
  );
  const body = el('div', { attrs: { id: bodyId }, className: 'fold-body' }, ...children);
  body.hidden = true;
  button.addEventListener('click', () => setFold(button, button.getAttribute('aria-expanded') !== 'true'));
  return el('section', { className: 'card fold', attrs: { id } }, el('h2', {}, button), body);
}

/** Open or close a fold card's body. */
export function setFold(button, open) {
  button.setAttribute('aria-expanded', String(open));
  document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
}
