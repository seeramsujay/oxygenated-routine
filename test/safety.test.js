import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSafetyViolation, isWindowUnsafe, suitableAlternatives } from '../src/safety.js';
import { buildResponse, fakeOpenMeteo } from './helpers.js';

const window = (avgAqi, peakAqi) => ({
  start: '14:00',
  end: '16:00',
  day: 'today',
  avgAqi,
  peakAqi,
  worstHour: '10:00',
  worstAqi: 300,
});

/** A minimal schema-shaped plan whose only advice is `lines`. */
const planSaying = (...lines) => ({
  top_actions: lines,
  daily_routine: [],
  indoor_air_hacks: [],
  sustainable_alternatives: [],
  community_actions: [],
  protect_vulnerable_members: [],
});

test('a window is judged by its worst hour, not its average', () => {
  assert.equal(isWindowUnsafe(window(140, 160), false), true, 'one hour at 160 makes it unsafe for everyone');
  assert.equal(isWindowUnsafe(window(140, 145), false), false);
  assert.equal(isWindowUnsafe(window(90, 105), true), true, 'stricter for sensitive households');
  assert.equal(isWindowUnsafe(null, false), false);
});

test('walking and cycling are dropped from alternatives only on avoid days', () => {
  const alts = [{ mode: 'wfh' }, { mode: 'bike' }, { mode: 'walk' }, { mode: 'bus' }];
  assert.deepEqual(
    suitableAlternatives(alts, 'avoid').map((a) => a.mode),
    ['wfh', 'bus'],
  );
  assert.equal(suitableAlternatives(alts, 'limit').length, 4);
});

test('flags active travel on avoid days but accepts sentences that rule it out', () => {
  const ctx = { guidance: 'avoid', window: null, sensitive: false };
  assert.equal(findSafetyViolation(planSaying('Cycle to work today.'), ctx), 'active_travel_on_avoid_day');
  assert.equal(findSafetyViolation(planSaying('Walk the kids to school.'), ctx), 'active_travel_on_avoid_day');
  assert.equal(findSafetyViolation(planSaying('Take the bus instead of cycling today.'), ctx), null);
  assert.equal(findSafetyViolation(planSaying('Carpool rather than walking or cycling.'), ctx), null);
  assert.equal(findSafetyViolation(planSaying('Cycle to work.'), { ...ctx, guidance: 'limit' }), null);
});

test('flags outdoor play in an unsafe window, but not essential trips or indoor play', () => {
  const ctx = { guidance: 'avoid', window: window(170, 175), sensitive: false };
  assert.equal(
    findSafetyViolation(planSaying('Take the kids to the playground between 14:00 and 16:00.'), ctx),
    'outdoor_play_in_unsafe_window',
  );
  assert.equal(
    findSafetyViolation(planSaying('Do essential errands between 14:00 and 16:00 with a respirator.'), ctx),
    null,
  );
  assert.equal(findSafetyViolation(planSaying('Between 14:00 and 16:00, keep play indoors.'), ctx), null);
  assert.equal(findSafetyViolation(planSaying('Do the school run between 14:00 and 16:00.'), ctx), null);
  assert.equal(
    findSafetyViolation(planSaying('Go for a run between 14:00 and 16:00.'), ctx),
    'outdoor_play_in_unsafe_window',
  );
  const safe = { guidance: 'limit', window: window(80, 90), sensitive: false };
  assert.equal(findSafetyViolation(planSaying('Outdoor play between 14:00 and 16:00 is fine.'), safe), null);
});

test('flags damper advice that does not require a cold, unlit fireplace', () => {
  const ctx = { guidance: 'normal', window: null, sensitive: false };
  assert.equal(findSafetyViolation(planSaying('Close the fireplace damper.'), ctx), 'unsafe_damper_advice');
  assert.equal(findSafetyViolation(planSaying('Close the damper only once the ashes are cold.'), ctx), null);
});

test('rule-engine plans always pass the safety check', async () => {
  const households = [
    { adults: 2, children: 0, seniors: 0, conditions: [] },
    { adults: 2, children: 2, seniors: 1, conditions: ['asthma'] },
  ];
  const commutes = [
    { mode: 'car', oneWayKm: 2, daysPerWeek: 5 },
    { mode: 'bus', oneWayKm: 12, daysPerWeek: 5 },
  ];
  for (const household of households) {
    for (const commute of commutes) {
      for (const heating of ['wood', 'electric']) {
        const home = { heating, cooking: 'gas', hasPurifier: false };
        for (const input of [{ manualAqi: 30 }, { manualAqi: 120 }, { manualAqi: 400 }, {}]) {
          for (const aqi of input.manualAqi === undefined ? [90, 170, 400] : [null]) {
            const deps = aqi ? { fetchImpl: fakeOpenMeteo({ aqi, pm25: aqi / 2 }) } : {};
            const result = await buildResponse({ ...input, household, commute, home }, deps);
            const ctx = { guidance: result.guidance, window: result.window, sensitive: result.sensitive };
            assert.equal(
              findSafetyViolation(result.plan, ctx),
              null,
              JSON.stringify({ input, aqi, household, commute }),
            );
          }
        }
      }
    }
  }
});
