import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlan } from '../src/planner.js';
import { buildResponse, fakeOpenMeteo } from './helpers.js';

const noNetwork = async () => {
  throw new Error('network must not be used');
};

test('uses Claude when enabled and returns its plan', async () => {
  const canned = (await buildResponse()).plan;
  const generate = async () => ({ ...canned, headline: 'From Claude' });
  const result = await buildResponse({}, { llmEnabled: true, generate });
  assert.equal(result.plan.headline, 'From Claude');
  assert.equal(result.meta.source, 'claude');
  assert.equal(result.meta.notice, null);
});

test('falls back to the rule engine when Claude errors, with a visible notice', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const result = await buildResponse(
      {},
      {
        llmEnabled: true,
        generate: async () => {
          throw new Error('boom');
        },
      },
    );
    assert.equal(result.meta.source, 'rules');
    assert.match(result.meta.notice, /unavailable/i);
    assert.ok(result.plan.top_actions.length === 3);
    assert.ok(!JSON.stringify(errors).includes('Delhi'), 'logs must not contain user data');
  } finally {
    console.error = original;
  }
});

test('rejects model output that does not match the schema', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await buildResponse({}, { llmEnabled: true, generate: async () => ({ headline: 'only this' }) });
    assert.equal(result.meta.source, 'rules');
  } finally {
    console.error = original;
  }
});

test('never calls Claude when disabled', async () => {
  const generate = async () => assert.fail('should not be called');
  const result = await buildResponse({}, { llmEnabled: false, generate });
  assert.equal(result.meta.source, 'rules');
});

test('a manual AQI works fully offline', async () => {
  const result = await createPlan(
    { location: 'Anywhere', manualAqi: 155 },
    { fetchImpl: noNetwork, llmEnabled: false },
  );
  assert.equal(result.air.aqi, 155);
  assert.equal(result.air.source, 'manual');
  assert.equal(result.forecast.length, 0);
  assert.equal(result.window, null);
});

test('browser coordinates skip the place lookup', async () => {
  const fetchImpl = fakeOpenMeteo();
  const result = await createPlan(
    { location: 'My location', coordinates: { latitude: 28.6, longitude: 77.2 } },
    { fetchImpl, llmEnabled: false },
  );
  assert.equal(result.location.name, 'My location');
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0], /air-quality-api/);
});

test('reports whether the user personalised or we assumed defaults', async () => {
  assert.equal((await buildResponse()).meta.personalised, false);
  const answered = await buildResponse({ household: { adults: 1, children: 2, seniors: 0, conditions: [] } });
  assert.equal(answered.meta.personalised, true);
  assert.equal((await buildResponse()).meta.assumed.commute.mode, 'car');
});

test('the same AQI is judged more cautiously for a household with children', async () => {
  const adults = await buildResponse({ manualAqi: 120 });
  const family = await buildResponse({
    manualAqi: 120,
    household: { adults: 2, children: 1, seniors: 0, conditions: [] },
  });
  assert.equal(adults.guidance, 'limit');
  assert.equal(family.guidance, 'avoid');
  assert.equal(family.sensitive, true);
});

test('returns a 24-hour forecast with plain category labels and no raw hourly array', async () => {
  const result = await buildResponse();
  assert.equal(result.forecast.length, 24);
  assert.ok(result.forecast.every((hour) => typeof hour.category === 'string'));
  assert.equal(result.air.hourly, undefined);
});

test('model output with no medical-help guidance falls back to the rule engine', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const canned = (await buildResponse()).plan;
    for (const empty of [[], ['   ']]) {
      const generate = async () => ({ ...canned, seek_medical_help_if: empty });
      const result = await buildResponse({}, { llmEnabled: true, generate });
      assert.equal(result.meta.source, 'rules');
      assert.ok(result.plan.seek_medical_help_if.length > 0);
    }
  } finally {
    console.error = original;
  }
});

test('a Claude plan that breaks a safety rule is replaced by the rule engine', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const canned = (await buildResponse({ manualAqi: 400 })).plan;
    const generate = async () => ({
      ...canned,
      top_actions: ['Cycle to school today.', ...canned.top_actions.slice(1)],
    });
    const result = await buildResponse({ manualAqi: 400 }, { llmEnabled: true, generate });
    assert.equal(result.meta.source, 'rules');
    assert.match(result.meta.notice, /safety checks/);
    assert.ok(!result.plan.top_actions.includes('Cycle to school today.'));
  } finally {
    console.error = original;
  }
});
