import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildResponse } from './helpers.js';

let renderResults;
let container;
let doc;

before(async () => {
  const dom = new JSDOM('<!doctype html><body><section id="results" hidden></section></body>');
  doc = dom.window.document;
  globalThis.document = doc;
  ({ renderResults } = await import('../public/render.js'));
  container = doc.querySelector('#results');
});

test('renders the answer first: hero, three actions, impact and a jump menu', async () => {
  renderResults(container, await buildResponse(), () => {});
  assert.equal(container.hidden, false);
  assert.equal(doc.activeElement.id, 'results-title');
  assert.equal(container.querySelectorAll('#first li').length, 3);
  assert.match(container.querySelector('.aqi-badge').getAttribute('aria-label'), /Air quality index 170, Unhealthy/);
  assert.match(container.querySelector('#impact .plain').textContent, /roughly like smoking .* cigarettes?/);

  const hrefs = [...container.querySelectorAll('.jump-nav a')].map((a) => a.getAttribute('href'));
  assert.ok(hrefs.length >= 7);
  for (const href of hrefs) assert.ok(container.querySelector(href), `${href} has a target section`);
});

test('every interactive and structural element is labelled for assistive tech', async () => {
  renderResults(container, await buildResponse(), () => {});
  assert.equal(container.querySelector('nav').getAttribute('aria-label'), 'Jump to a section');
  for (const th of container.querySelectorAll('th')) assert.equal(th.getAttribute('scope'), 'col');
  assert.ok(container.querySelector('table caption'));
  for (const button of container.querySelectorAll('button')) assert.equal(button.getAttribute('type'), 'button');
});

test('server text is inserted as text, never parsed as HTML', async () => {
  const data = await buildResponse();
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  data.plan.headline = payload;
  data.plan.top_actions[0] = payload;
  data.plan.daily_routine[0].why = payload;
  renderResults(container, data, () => {});
  assert.equal(container.querySelector('img'), null);
  assert.equal(container.querySelector('script'), null);
  assert.equal(container.querySelector('#results-title').textContent, payload);
});

test('nudges to personalise only when defaults were assumed', async () => {
  let clicks = 0;
  renderResults(container, await buildResponse(), () => (clicks += 1));
  const nudge = container.querySelector('.nudge');
  assert.match(nudge.textContent, /We assumed a typical household/);
  nudge.querySelector('button').click();
  assert.equal(clicks, 1);

  const answered = await buildResponse({ household: { adults: 1, children: 1, seniors: 0, conditions: [] } });
  renderResults(container, answered, () => {});
  assert.equal(container.querySelector('.nudge'), null);
});

test('shows the fallback notice and omits optional sections that have no content', async () => {
  const data = await buildResponse({ manualAqi: 60 });
  data.meta.notice = 'The AI service is unavailable right now.';
  renderResults(container, data, () => {});
  assert.match(container.querySelector('.notice').textContent, /unavailable/);
  assert.equal(container.querySelector('#care'), null);
  assert.equal(container.querySelector('#timing'), null);
});
