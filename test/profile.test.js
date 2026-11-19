import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../src/errors.js';
import { DEFAULTS, isSensitive, parseProfile } from '../src/profile.js';

test('only a location is required; the rest falls back to a typical household', () => {
  const profile = parseProfile({ location: '  Delhi ' });
  assert.equal(profile.location, 'Delhi');
  assert.deepEqual(profile.household, DEFAULTS.household);
  assert.equal(profile.commute.mode, 'car');
  assert.equal(profile.notes, '');
});

test('rejects invalid input with a 400 that names each field', () => {
  const bad = {
    location: 'x',
    budget: 'huge',
    manualAqi: 900,
    commute: { mode: 'rocket', oneWayKm: -1, daysPerWeek: 9 },
  };
  assert.throws(
    () => parseProfile(bad),
    (error) => {
      assert.ok(error instanceof AppError && error.status === 400);
      const fields = error.details.map((d) => d.field);
      for (const field of ['location', 'budget', 'manualAqi', 'commute.mode']) assert.ok(fields.includes(field), field);
      return true;
    },
  );
});

test('rejects non-object bodies and wrong types', () => {
  for (const body of [null, 'Delhi', 42, [], { location: 7 }]) assert.throws(() => parseProfile(body), AppError);
});

test('notes are length-limited and stripped of control characters', () => {
  const clean = parseProfile({ location: 'Delhi', notes: 'a\u0000b\u0007c\nd' });
  assert.equal(clean.notes, 'abc\nd');
  assert.throws(() => parseProfile({ location: 'Delhi', notes: 'x'.repeat(301) }), AppError);
});

test('coordinates must be real latitudes and longitudes', () => {
  assert.doesNotThrow(() => parseProfile({ location: 'Here', coordinates: { latitude: 28.6, longitude: 77.2 } }));
  assert.throws(() => parseProfile({ location: 'Here', coordinates: { latitude: 91, longitude: 0 } }), AppError);
});

test('isSensitive flags children, seniors and conditions only', () => {
  assert.equal(isSensitive(parseProfile({ location: 'Delhi' })), false);
  const household = (extra) => ({ adults: 2, children: 0, seniors: 0, conditions: [], ...extra });
  assert.equal(isSensitive(parseProfile({ location: 'Delhi', household: household({ children: 1 }) })), true);
  assert.equal(isSensitive(parseProfile({ location: 'Delhi', household: household({ seniors: 1 }) })), true);
  assert.equal(
    isSensitive(parseProfile({ location: 'Delhi', household: household({ conditions: ['asthma'] }) })),
    true,
  );
});
