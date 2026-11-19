import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from '../src/server.js';
import { fakeOpenMeteo } from './helpers.js';

/** Start a real server on a random port for the duration of `run`. */
async function withServer(run, deps = {}) {
  const server = createServer({ fetchImpl: fakeOpenMeteo(), llmEnabled: false, now: () => 0, ...deps });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const postPlan = (base, body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/plan`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('health endpoint reports status', () =>
  withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', ai: false });
  }));

test('a location-only request returns a full plan', () =>
  withServer(async (base) => {
    const response = await postPlan(base, { location: 'Delhi' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.plan.top_actions.length, 3);
    assert.equal(body.air.aqi, 170);
  }));

test('every response carries hardened security headers', () =>
  withServer(async (base) => {
    for (const path of ['/', '/api/health', '/nope']) {
      const { headers } = await fetch(base + path);
      assert.match(headers.get('content-security-policy'), /default-src 'self'/);
      assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(headers.get('x-content-type-options'), 'nosniff');
      assert.equal(headers.get('referrer-policy'), 'no-referrer');
    }
  }));

test('validation errors are 400 with field details and no stack traces', () =>
  withServer(async (base) => {
    const response = await postPlan(base, { location: 'x' });
    assert.equal(response.status, 400);
    const { error } = await response.json();
    assert.equal(error.code, 'bad_request');
    assert.equal(error.details[0].field, 'location');
    assert.ok(!JSON.stringify(error).includes('at '));
  }));

test('rejects bad content types, malformed JSON and oversized bodies', () =>
  withServer(async (base) => {
    assert.equal((await postPlan(base, 'location=Delhi', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await postPlan(base, '{not json')).status, 400);
    const huge = JSON.stringify({ location: 'Delhi', notes: 'x'.repeat(40_000) });
    assert.equal((await postPlan(base, huge)).status, 413);
  }));

test('unknown API routes are 404 and wrong methods on pages are 405', () =>
  withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/secret`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  }));

test('serves the app and refuses path traversal and unknown file types', () =>
  withServer(async (base) => {
    const page = await fetch(base);
    assert.match(await page.text(), /Get my plan/);
    assert.equal((await fetch(`${base}/styles.css`)).status, 200);
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc/server.js', '/%00']) {
      const response = await fetch(base + path);
      assert.ok([400, 404].includes(response.status), `${path} -> ${response.status}`);
    }
    assert.equal((await fetch(`${base}/index.html.bak`)).status, 404);
  }));

test('plan requests are rate limited per client with Retry-After', () =>
  withServer(async (base) => {
    const statuses = [];
    let last;
    for (let i = 0; i < 8; i++) {
      last = await postPlan(base, { location: 'Anywhere', manualAqi: 120 });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
  }));

test('geocode endpoint validates its query', () =>
  withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/geocode?q=a`)).status, 400);
    const ok = await fetch(`${base}/api/geocode?q=Delhi`);
    assert.equal((await ok.json()).results[0].name, 'Delhi');
  }));

test('upstream outages surface as a 502 with a helpful message', () =>
  withServer(
    async (base) => {
      const response = await postPlan(base, { location: 'Delhi' });
      assert.equal(response.status, 502);
      assert.match((await response.json()).error.message, /enter an AQI manually/i);
    },
    { fetchImpl: fakeOpenMeteo({ status: 503 }) },
  ));
