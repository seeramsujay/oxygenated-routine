import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cigaretteEquivalent, commuteAlternatives, computeImpact, meanExposure } from '../src/impact.js';
import { parseProfile } from '../src/profile.js';

const profileWith = (overrides = {}) => parseProfile({ location: 'Delhi', ...overrides });

test('22 ug/m3 over a day is one cigarette, and dose scales with time', () => {
  assert.equal(cigaretteEquivalent(22), 1);
  assert.equal(cigaretteEquivalent(44, 12), 1);
});

test('commute alternatives are ranked by CO2e saved and respect distance limits', () => {
  const far = commuteAlternatives({ mode: 'car', oneWayKm: 10, daysPerWeek: 5 });
  assert.deepEqual(
    far.map((a) => a.mode),
    ['wfh', 'metro', 'bus'],
  );
  assert.equal(far[0].savedKgPerWeek, 17); // 100 km a week at 0.17 kg/km
  assert.equal(far.find((a) => a.mode === 'metro').savedKgPerWeek, 13);

  const near = commuteAlternatives({ mode: 'car', oneWayKm: 2, daysPerWeek: 5 });
  assert.ok(near.some((a) => a.mode === 'walk') && near.some((a) => a.mode === 'bike'));
});

test('nobody is told to switch to something dirtier', () => {
  assert.deepEqual(commuteAlternatives({ mode: 'walk', oneWayKm: 1, daysPerWeek: 5 }), []);
  assert.deepEqual(commuteAlternatives({ mode: 'metro', oneWayKm: 5, daysPerWeek: 0 }), []);
});

test('following the plan always lowers exposure', () => {
  const { exposure } = computeImpact(profileWith(), { aqi: 170, pm25: 90 });
  assert.ok(exposure.todayWithPlanCigarettes < exposure.todayCurrentHabitsCigarettes);
  assert.ok(exposure.todayCurrentHabitsCigarettes < exposure.standingOutsideAllDayCigarettes);
  assert.ok(exposure.reductionPercent > 0 && exposure.reductionPercent < 100);
});

test('owning a purifier already lowers the baseline, so the plan adds less', () => {
  const air = { aqi: 170, pm25: 90 };
  const without = computeImpact(profileWith(), air).exposure;
  const withOne = computeImpact(
    profileWith({ home: { heating: 'electric', cooking: 'gas', hasPurifier: true } }),
    air,
  ).exposure;
  assert.ok(withOne.todayCurrentHabitsCigarettes < without.todayCurrentHabitsCigarettes);
  assert.ok(withOne.reductionPercent < without.reductionPercent);
});

test('falls back to an AQI-derived PM2.5 and tolerates zero hours outdoors', () => {
  const { outdoorPm25, exposure } = computeImpact(profileWith({ outdoorHours: 0 }), { aqi: 100, pm25: undefined });
  assert.equal(outdoorPm25, 35.4);
  assert.ok(exposure.todayWithPlanCigarettes >= 0);
});

test('respirator credit is only given when the plan asks for one', () => {
  const profile = profileWith({ outdoorHours: 12, home: { heating: 'electric', cooking: 'gas', hasPurifier: true } });
  const air = { aqi: 100, pm25: 35 };
  assert.equal(computeImpact(profile, air, { respirator: false }).exposure.reductionPercent, 0);
  assert.ok(computeImpact(profile, air, { respirator: true }).exposure.reductionPercent > 0);
});

test('zero measured PM2.5 stays zero even when AQI is high', () => {
  const result = computeImpact(profileWith(), { aqi: 500, pm25: 0 });
  assert.equal(result.outdoorPm25, 0);
  assert.deepEqual(result.exposure, {
    standingOutsideAllDayCigarettes: 0,
    todayCurrentHabitsCigarettes: 0,
    todayWithPlanCigarettes: 0,
    reductionPercent: 0,
    meanPm25CurrentHabits: 0,
    meanPm25WithPlan: 0,
  });
});

test('exposure uses time-weighted indoor and outdoor doses with rounded display values', () => {
  const { exposure } = computeImpact(profileWith({ outdoorHours: 12 }), { aqi: 170, pm25: 100 });
  assert.deepEqual(exposure, {
    standingOutsideAllDayCigarettes: 4.5,
    todayCurrentHabitsCigarettes: 4.3,
    todayWithPlanCigarettes: 1.6,
    reductionPercent: 63,
    meanPm25CurrentHabits: 95,
    meanPm25WithPlan: 35,
  });
});

test('a respirator gives no extra reduction when no time is spent outdoors', () => {
  const profile = profileWith({ outdoorHours: 0 });
  const air = { aqi: 170, pm25: 100 };
  assert.deepEqual(computeImpact(profile, air), computeImpact(profile, air, { respirator: false }));
});

for (const [oneWayKm, walk, bike] of [
  [3, true, true],
  [3.01, false, true],
  [8, false, true],
  [8.01, false, false],
]) {
  test(`commute distance ${oneWayKm} km respects active travel boundaries`, () => {
    const modes = commuteAlternatives({ mode: 'car', oneWayKm, daysPerWeek: 5 }).map((a) => a.mode);
    assert.equal(modes.includes('walk'), walk);
    assert.equal(modes.includes('bike'), bike);
  });
}

test('commute savings include the round trip and thirteen-week winter', () => {
  const { commute } = computeImpact(profileWith(), { aqi: 100, pm25: 35.4 });
  assert.equal(commute.currentKgCo2ePerWeek, 13.6);
  assert.deepEqual(
    commute.alternatives.find((a) => a.mode === 'metro'),
    {
      mode: 'metro',
      savedKgPerWeek: 10.4,
      savedKgPerWinter: 135,
    },
  );
  assert.deepEqual(commuteAlternatives({ mode: 'car', oneWayKm: 0, daysPerWeek: 5 }), []);
});

test('mean exposure weights indoor and outdoor hours and applies respirators only outdoors', () => {
  const base = { outdoorPm25: 100, indoorRatio: 0.3, respirator: false };
  assert.equal(meanExposure({ ...base, outdoorHours: 0 }), 30);
  assert.equal(meanExposure({ ...base, outdoorHours: 24 }), 100);
  assert.equal(meanExposure({ ...base, outdoorHours: 12 }), 65);
  assert.equal(meanExposure({ ...base, outdoorHours: 12, respirator: true }), 35);
  assert.equal(meanExposure({ ...base, outdoorHours: 0, respirator: true }), 30);
});

test('clean air produces zero exposure without falling back to the AQI estimate', () => {
  const impact = computeImpact(profileWith(), { aqi: 100, pm25: 0 });
  assert.equal(impact.outdoorPm25, 0);
  for (const value of Object.values(impact.exposure)) assert.equal(value, 0);
});

for (const [oneWayKm, bike, walk] of [
  [3, true, true],
  [3.01, true, false],
  [8, true, false],
  [8.01, false, false],
]) {
  test(`active commute distance boundaries at ${oneWayKm} km`, () => {
    const alternatives = commuteAlternatives({ mode: 'car', oneWayKm, daysPerWeek: 5 });
    assert.equal(
      alternatives.some((a) => a.mode === 'bike'),
      bike,
    );
    assert.equal(
      alternatives.some((a) => a.mode === 'walk'),
      walk,
    );
  });
}

test('commute savings count both directions and all thirteen winter weeks', () => {
  const alternatives = commuteAlternatives({ mode: 'car', oneWayKm: 10, daysPerWeek: 5 });
  assert.deepEqual(alternatives, [
    { mode: 'wfh', savedKgPerWeek: 17, savedKgPerWinter: 221 },
    { mode: 'metro', savedKgPerWeek: 13, savedKgPerWinter: 169 },
    { mode: 'bus', savedKgPerWeek: 7, savedKgPerWinter: 91 },
  ]);
  assert.deepEqual(commuteAlternatives({ mode: 'car', oneWayKm: 0, daysPerWeek: 5 }), []);
});

test('meanExposure handles 24-hour outdoor and 24-hour indoor boundary cases', () => {
  // 24 hours outdoors, no respirator: mean is 100% outdoor
  const outdoorAllDay = meanExposure({ outdoorPm25: 100, outdoorHours: 24, indoorRatio: 0.5, respirator: false });
  assert.equal(outdoorAllDay, 100);

  // 24 hours outdoors with respirator (60% reduction -> 40% remains)
  const outdoorRespirator = meanExposure({ outdoorPm25: 100, outdoorHours: 24, indoorRatio: 0.5, respirator: true });
  assert.equal(outdoorRespirator, 40);

  // 0 hours outdoors (24 hours indoors at 0.3 ratio): mean is 30 µg/m³
  const indoorAllDay = meanExposure({ outdoorPm25: 100, outdoorHours: 0, indoorRatio: 0.3, respirator: false });
  assert.equal(indoorAllDay, 30);
});

test('commute alternatives handle motorbike and bus current modes', () => {
  const bikeCommute = commuteAlternatives({ mode: 'motorbike', oneWayKm: 5, daysPerWeek: 5 });
  assert.ok(bikeCommute.some((a) => a.mode === 'metro'));
  assert.ok(bikeCommute.some((a) => a.mode === 'bike'));
  assert.ok(!bikeCommute.some((a) => a.mode === 'car')); // car is dirtier, never suggested

  const busCommute = commuteAlternatives({ mode: 'bus', oneWayKm: 5, daysPerWeek: 5 });
  assert.ok(busCommute.some((a) => a.mode === 'metro'));
  assert.ok(!busCommute.some((a) => a.mode === 'motorbike')); // motorbike is dirtier than bus
});
