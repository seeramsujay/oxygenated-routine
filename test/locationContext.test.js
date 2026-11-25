import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePollutants, buildLocationContext, detectRegion } from '../src/locationContext.js';
import { buildRulePlan } from '../src/rules.js';
import { findSafetyViolation } from '../src/safety.js';
import { buildResponse } from './helpers.js';

test('detectRegion maps countries and timezones to the right regional profile', () => {
  assert.equal(detectRegion({ country: 'India' }).id, 'south_asia');
  assert.equal(detectRegion({ country: 'United Kingdom' }).id, 'europe_uk');
  assert.equal(detectRegion({ country: 'China' }).id, 'east_asia');
  assert.equal(detectRegion({ country: 'United States' }).id, 'north_america');
  assert.equal(detectRegion({ country: 'Thailand' }).id, 'southeast_asia');
  assert.equal(detectRegion({}, 'Asia/Kolkata').id, 'south_asia');
  assert.equal(detectRegion({}, 'Europe/Warsaw').id, 'europe_uk');
  assert.equal(detectRegion({ country: 'Antarctica' }).id, 'global');
});

test('analyzePollutants compares PM2.5, PM10, and NO2 against WHO guidelines', () => {
  const result = analyzePollutants({ pm25: 90, pm10: 135, no2: 50 });
  assert.equal(result.items.length, 3);
  assert.equal(result.dominant.id, 'pm25');
  assert.equal(result.dominant.ratioToWho, 6);
});

test('buildLocationContext produces region-specific respirator and monitoring hints', () => {
  const uk = buildLocationContext({
    location: { name: 'London', country: 'United Kingdom' },
    air: { pm25: 30, pm10: 40, no2: 60 },
  });
  assert.equal(uk.region.respirator, 'FFP2');
  assert.equal(uk.pollutants.dominant.id, 'no2');
  assert.ok(uk.helplines.some((h) => h.number === '999'));
  assert.ok(uk.helplines.some((h) => h.number === '111'));

  const india = buildLocationContext({
    location: { name: 'Delhi, India', manual: true },
    air: { pm25: 120 },
  });
  assert.equal(india.region.id, 'south_asia');
  assert.ok(india.helplines.some((h) => h.number === '112'));
  assert.ok(india.helplines.some((h) => h.number === '108'));
});

test('regional rule plans remain safe on avoid days across all regions', async () => {
  const base = await buildResponse();
  for (const country of ['India', 'China', 'United Kingdom', 'United States', 'Thailand', 'Brazil']) {
    const ctx = {
      profile: {
        location: country,
        outdoorHours: 2,
        budget: 'medium',
        notes: '',
        household: { adults: 2, children: 1, seniors: 0, conditions: ['asthma'] },
        commute: { mode: 'car', oneWayKm: 8, daysPerWeek: 5 },
        home: { heating: 'gas', cooking: 'gas', hasPurifier: false },
      },
      location: { name: 'City', country },
      air: { aqi: 220, pm25: 170, pm10: 210, no2: 55, category: base.air.category },
      impact: base.impact,
      window: base.window,
      guidance: 'avoid',
      sensitive: true,
    };
    const plan = buildRulePlan(ctx);
    assert.equal(findSafetyViolation(plan, ctx), null, `safe plan for ${country}`);
  }
});
