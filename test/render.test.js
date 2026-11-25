import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildResponse } from './helpers.js';

let renderResults;
let aqiScalePosition;
let container;
let doc;

before(async () => {
  const dom = new JSDOM('<!doctype html><body><section id="results" hidden></section></body>');
  doc = dom.window.document;
  globalThis.document = doc;
  ({ renderResults, aqiScalePosition } = await import('../public/render.js'));
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

test('long sections start collapsed and open from their button or the jump menu', async () => {
  renderResults(container, await buildResponse(), () => {});
  for (const id of ['indoor', 'swaps', 'community']) {
    const toggle = container.querySelector(`#${id} .fold-toggle`);
    const body = doc.getElementById(toggle.getAttribute('aria-controls'));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', `${id} starts collapsed`);
    assert.equal(body.hidden, true);
    assert.equal(toggle.closest('h2') !== null, true, 'toggle lives inside a real heading');
  }
  const indoor = container.querySelector('#indoor .fold-toggle');
  indoor.click();
  assert.equal(indoor.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.getElementById(indoor.getAttribute('aria-controls')).hidden, false);
  indoor.click();
  assert.equal(indoor.getAttribute('aria-expanded'), 'false');

  container.querySelector('.jump-nav a[href="#swaps"]').click();
  assert.equal(container.querySelector('#swaps .fold-toggle').getAttribute('aria-expanded'), 'true');
});

test('safety-critical and core sections are never collapsed', async () => {
  renderResults(
    container,
    await buildResponse({ household: { adults: 2, children: 1, seniors: 0, conditions: [] } }),
    () => {},
  );
  for (const id of ['first', 'impact', 'routine', 'care', 'help']) {
    assert.equal(container.querySelector(`#${id} .fold-toggle`), null, `${id} is always open`);
  }
});

test('the AQI scale places values inside the right band', () => {
  assert.equal(aqiScalePosition(0), 0);
  assert.equal(aqiScalePosition(50), 16.7);
  assert.equal(aqiScalePosition(100), 33.3);
  assert.equal(aqiScalePosition(500), 100);
  assert.equal(aqiScalePosition(900), 100);
  assert.equal(aqiScalePosition(-5), 0);
  const unhealthy = aqiScalePosition(170);
  assert.ok(unhealthy > 50 && unhealthy < 66.7);
});

test('visual scale and bars are hidden from screen readers because the text says it all', async () => {
  renderResults(container, await buildResponse(), () => {});
  assert.equal(container.querySelector('.scale').getAttribute('aria-hidden'), 'true');
  const bars = container.querySelectorAll('#impact .stat-bar');
  assert.equal(bars.length, 3);
  for (const bar of bars) assert.equal(bar.getAttribute('aria-hidden'), 'true');
});

test('renders interactive forecast SVG chart, pollutant breakdown, and what-if simulator', async () => {
  renderResults(container, await buildResponse(), () => {});
  assert.ok(container.querySelector('#timing svg.chart-svg'), 'renders 24h forecast SVG chart');
  assert.ok(container.querySelector('#air .pollutant-list'), 'renders pollutant vs WHO chart');
  const simBox = container.querySelector('#impact .sim-box');
  assert.ok(simBox, 'renders interactive what-if simulator');
  const before = simBox.querySelector('.sim-value').textContent;
  const purifierToggle = simBox.querySelector('#sim-purifier');
  purifierToggle.checked = false;
  purifierToggle.dispatchEvent(new doc.defaultView.Event('change'));
  const after = simBox.querySelector('.sim-value').textContent;
  assert.notEqual(before, after, 'simulator updates dose live when toggled');

  const helplines = container.querySelectorAll('#help .helpline-link');
  assert.ok(helplines.length >= 1, 'renders clickable medical helpline links');
  assert.match(helplines[0].getAttribute('href'), /^tel:/);
  assert.ok(helplines[0].getAttribute('aria-label').includes('Call '));

  assert.ok(container.querySelectorAll('details.explore-fold').length >= 3, 'renders explorable dropdowns');
  assert.ok(container.querySelector('#chat #chat-input'), 'renders follow-up chat input');
});
