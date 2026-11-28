import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSafetyViolation, findTextSafetyViolation, isWindowUnsafe, suitableAlternatives } from '../src/safety.js';
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
  assert.equal(findSafetyViolation(planSaying('Ride a bicycle to work.'), ctx), 'active_travel_on_avoid_day');
  assert.equal(findSafetyViolation(planSaying('Cycle to work.'), { ...ctx, guidance: 'limit' }), null);
});

test('flags outdoor play in an unsafe window, but not essential trips or indoor play', () => {
  // "limit" overall, but every hour of the window is at an "avoid" level.
  const ctx = { guidance: 'limit', window: window(170, 175), sensitive: false };
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
  assert.equal(
    findSafetyViolation(planSaying('Close the damper only when no fire is lit and the ashes are cold.'), ctx),
    null,
  );
  assert.equal(findSafetyViolation(planSaying('Keep the damper open until the ashes are cold.'), ctx), null);
  // A condition elsewhere in the sentence does not make the closing instruction safe.
  assert.equal(
    findSafetyViolation(planSaying('It is cold tonight, so close the damper and light the fire.'), ctx),
    'unsafe_damper_advice',
  );
  assert.equal(
    findSafetyViolation(planSaying('Close the damper once the ashes are cold.'), ctx),
    'unsafe_damper_advice',
  );
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

test('the window check understands 12-hour times and applies "indoors" only to its own clause', () => {
  const ctx = { guidance: 'limit', window: window(150, 160), sensitive: false };
  for (const text of [
    'Take the kids to the playground from 2 pm.',
    'Outdoor play is best between 2 and 4 pm.',
    'Play outside at 2:00 p.m., and stay indoors otherwise.',
  ]) {
    assert.equal(findSafetyViolation(planSaying(text), ctx), 'outdoor_play_in_unsafe_window', text);
  }
  assert.equal(findSafetyViolation(planSaying('From 2 pm, keep play indoors.'), ctx), null);
  assert.equal(
    findSafetyViolation(planSaying('Play outside at 9 am.'), ctx),
    null,
    'a different hour is not the window',
  );
});

test('every text field is checked, including the headline and benefits', () => {
  const ctx = { guidance: 'avoid', window: null, sensitive: false };
  const plan = { ...planSaying('Stay in.'), headline: 'Cycle to work and enjoy the day.' };
  assert.equal(findSafetyViolation(plan, ctx), 'active_travel_on_avoid_day');
  const benefit = {
    ...planSaying('Stay in.'),
    sustainable_alternatives: [{ swap: 'Commute differently', benefit: 'Walking to work saves CO2.', effort: 'easy' }],
  };
  assert.equal(findSafetyViolation(benefit, ctx), 'active_travel_on_avoid_day');
});

test('on avoid days outdoor play anywhere is flagged unless it is kept inside or ruled out', () => {
  const ctx = { guidance: 'avoid', window: null, sensitive: false };
  assert.equal(findSafetyViolation(planSaying('Let the kids play in the park.'), ctx), 'outdoor_play_on_avoid_day');
  assert.equal(findSafetyViolation(planSaying('Keep exercise, sport and playground time indoors today.'), ctx), null);
  assert.equal(
    findSafetyViolation(planSaying('Move play indoors, and avoid outdoor sports until the AQI drops.'), ctx),
    null,
  );
});

test('a negation only rules out the activity it directly precedes', () => {
  const avoid = { guidance: 'avoid', window: null, sensitive: false };
  assert.equal(
    findSafetyViolation(planSaying('Walk the kids to school and join a no-idling pledge.'), avoid),
    'active_travel_on_avoid_day',
  );
  assert.equal(findSafetyViolation(planSaying('Take the bus instead of cycling.'), avoid), null);
  assert.equal(findSafetyViolation(planSaying('Do not walk or cycle to work today.'), avoid), null);
  assert.equal(
    findSafetyViolation(planSaying('Avoid the main road, then cycle to work.'), avoid),
    'active_travel_on_avoid_day',
  );
});

test('abbreviated times do not split a window sentence', () => {
  const ctx = { guidance: 'limit', window: window(150, 160), sensitive: false };
  assert.equal(
    findSafetyViolation(planSaying('At 2 p.m. take the kids to the playground.'), ctx),
    'outdoor_play_in_unsafe_window',
  );
  assert.equal(findSafetyViolation(planSaying('Run errands at 2 p.m. Play outside at 9 a.m.'), ctx), null);
});

test('double negatives cancel, single negatives still rule an activity out', () => {
  const avoid = { guidance: 'avoid', window: null, sensitive: false };
  for (const text of ["Don't avoid cycling today.", 'Never skip walking to school.', 'Skip the car and cycle.']) {
    assert.equal(findSafetyViolation(planSaying(text), avoid), 'active_travel_on_avoid_day', text);
  }
  assert.equal(findSafetyViolation(planSaying("Don't skip outdoor exercise."), avoid), 'outdoor_play_on_avoid_day');
  for (const text of [
    'Avoid cycling today.',
    'Take the bus rather than walking or cycling.',
    'Skip heavy exercise outside.',
    'Do not walk or cycle to work.',
  ]) {
    assert.equal(findSafetyViolation(planSaying(text), avoid), null, text);
  }
});

test('findTextSafetyViolation audits standalone chat replies directly', () => {
  const avoidCtx = { guidance: 'avoid', window: null, sensitive: false };
  assert.equal(findTextSafetyViolation('Cycle to work today.', avoidCtx), 'active_travel_on_avoid_day');
  assert.equal(findTextSafetyViolation('Keep windows shut and stay indoors.', avoidCtx), null);
});
