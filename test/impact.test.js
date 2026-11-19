import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cigaretteEquivalent, commuteAlternatives, computeImpact } from '../src/impact.js';
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
