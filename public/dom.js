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
