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

for (const manualAqi of [0, 500]) {
  test(`manual AQI accepts the inclusive boundary ${manualAqi}`, () => {
    assert.equal(parseProfile({ location: 'Delhi', manualAqi }).manualAqi, manualAqi);
  });
}

for (const manualAqi of [-1, 501, 1.5, '100', null]) {
  test(`manual AQI rejects ${JSON.stringify(manualAqi)}`, () => {
    assert.throws(() => parseProfile({ location: 'Delhi', manualAqi }), AppError);
  });
}

test('coordinates accept both geographic extremes, including zero', () => {
  for (const coordinates of [
    { latitude: -90, longitude: -180 },
    { latitude: 90, longitude: 180 },
    { latitude: 0, longitude: 0 },
  ]) {
    assert.deepEqual(parseProfile({ location: 'Here', coordinates }).coordinates, coordinates);
  }
});

test('location validation runs after control-character removal and trimming', () => {
  assert.equal(parseProfile({ location: '  De\u0000lhi  ' }).location, 'Delhi');
  assert.throws(() => parseProfile({ location: ' \u0000a ' }), AppError);
  assert.throws(() => parseProfile({ location: 'x'.repeat(101) }), AppError);
});

test('unknown fields are stripped at the request and nested boundaries', () => {
  const profile = parseProfile({
    location: 'Delhi',
    apiKey: 'untrusted',
    household: { ...DEFAULTS.household, sensitive: false },
  });
  assert.equal(Object.hasOwn(profile, 'apiKey'), false);
  assert.deepEqual(profile.household, DEFAULTS.household);
});

test('invalid nested values identify the exact fields for the form', () => {
  assert.throws(
    () =>
      parseProfile({
        location: 'Delhi',
        household: { adults: 1.5, children: -1, seniors: 13, conditions: ['unknown'] },
        outdoorHours: 12.1,
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(error.details.map(({ field }) => field).sort(), [
        'household.adults',
        'household.children',
        'household.conditions.0',
        'household.seniors',
        'outdoorHours',
      ]);
      return true;
    },
  );
});

test('numeric limits accept their endpoints without coercing strings', () => {
  for (const manualAqi of [0, 500]) {
    assert.equal(parseProfile({ location: 'Delhi', manualAqi }).manualAqi, manualAqi);
  }
  for (const coordinates of [
    { latitude: -90, longitude: -180 },
    { latitude: 90, longitude: 180 },
  ]) {
    assert.deepEqual(parseProfile({ location: 'Delhi', coordinates }).coordinates, coordinates);
  }
  for (const manualAqi of [-1, 501, 1.5, '100', null, NaN, Infinity]) {
    assert.throws(() => parseProfile({ location: 'Delhi', manualAqi }), AppError);
  }
});

test('nested validation reports the precise field for invalid household and commute answers', () => {
  assert.throws(
    () =>
      parseProfile({
        location: 'Delhi',
        household: { adults: -1, children: 0.5, seniors: 13, conditions: ['unknown'] },
        commute: { mode: 'car', oneWayKm: 201, daysPerWeek: 1.5 },
        home: { heating: 'electric', cooking: 'gas', hasPurifier: 'false' },
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(
        error.details.map((issue) => issue.field).sort(),
        [
          'household.adults',
          'household.children',
          'household.seniors',
          'household.conditions.0',
          'commute.oneWayKm',
          'commute.daysPerWeek',
          'home.hasPurifier',
        ].sort(),
      );
      return true;
    },
  );
});

test('sanitised locations must still contain at least two characters', () => {
  for (const location of ['  ', '\u0000a\u007f', '\t\n']) {
    assert.throws(() => parseProfile({ location }), AppError);
  }
  assert.equal(parseProfile({ location: ' D\u0000elhi ', notes: ' a\tb\nc ' }).notes, 'a\tb\nc');
});

test('unknown request fields are stripped at both top and nested levels', () => {
  const profile = parseProfile({
    location: 'Delhi',
    apiKey: 'untrusted',
    household: { adults: 2, children: 0, seniors: 0, conditions: [], sensitive: false },
  });
  assert.equal(Object.hasOwn(profile, 'apiKey'), false);
  assert.equal(Object.hasOwn(profile.household, 'sensitive'), false);
});
