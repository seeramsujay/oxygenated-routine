import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categorize, outdoorGuidance, pm25FromAqi } from '../src/aqi.js';

test('categorize maps band edges correctly', () => {
  const edges = [
    [0, 'good'],
    [50, 'good'],
    [51, 'moderate'],
    [100, 'moderate'],
    [101, 'unhealthy_sensitive'],
    [150, 'unhealthy_sensitive'],
    [151, 'unhealthy'],
    [200, 'unhealthy'],
    [201, 'very_unhealthy'],
    [300, 'very_unhealthy'],
    [301, 'hazardous'],
    [500, 'hazardous'],
  ];
  for (const [aqi, id] of edges) assert.equal(categorize(aqi).id, id, `AQI ${aqi}`);
});

test('categorize clamps out-of-range values and always explains itself in plain words', () => {
  assert.equal(categorize(-20).id, 'good');
  assert.equal(categorize(900).id, 'hazardous');
  assert.ok(categorize(160).meaning.length > 20);
});

test('pm25FromAqi hits breakpoints and increases monotonically', () => {
  assert.equal(pm25FromAqi(50), 9);
  assert.equal(pm25FromAqi(100), 35.4);
  let previous = -1;
  for (let aqi = 0; aqi <= 500; aqi += 5) {
    const value = pm25FromAqi(aqi);
    assert.ok(value >= previous, `non-monotonic at ${aqi}`);
    previous = value;
  }
});

test('outdoorGuidance is stricter for sensitive households', () => {
  assert.equal(outdoorGuidance(40, { sensitive: false }), 'normal');
  assert.equal(outdoorGuidance(120, { sensitive: false }), 'limit');
  assert.equal(outdoorGuidance(160, { sensitive: false }), 'avoid');
  assert.equal(outdoorGuidance(40, { sensitive: true }), 'normal');
  assert.equal(outdoorGuidance(60, { sensitive: true }), 'limit');
  assert.equal(outdoorGuidance(120, { sensitive: true }), 'avoid');
});

for (const [aqi, expected] of [
  [0, 0],
  [51, 9.1],
  [101, 35.5],
  [150, 55.4],
  [151, 55.5],
  [200, 125.4],
  [201, 125.5],
  [300, 225.4],
  [301, 225.5],
  [500, 325.4],
]) {
  test(`PM2.5 conversion preserves the EPA breakpoint at AQI ${aqi}`, () => {
    assert.equal(pm25FromAqi(aqi), expected);
  });
}

test('AQI helpers round before banding and clamp before conversion', () => {
  assert.equal(categorize(50.49).id, 'good');
  assert.equal(categorize(50.5).id, 'moderate');
  assert.equal(pm25FromAqi(-10), 0);
  assert.equal(pm25FromAqi(501), 325.4);
  assert.equal(pm25FromAqi(50.5), 9.1);
});

for (const [sensitive, limit, avoid] of [
  [false, 101, 151],
  [true, 51, 101],
]) {
  test(`outdoor guidance switches exactly at thresholds (sensitive: ${sensitive})`, () => {
    assert.equal(outdoorGuidance(limit - 1, { sensitive }), 'normal');
    assert.equal(outdoorGuidance(limit, { sensitive }), 'limit');
    assert.equal(outdoorGuidance(avoid - 1, { sensitive }), 'limit');
    assert.equal(outdoorGuidance(avoid, { sensitive }), 'avoid');
  });
}

for (const [aqi, expected] of [
  [0, 0],
  [50, 9],
  [51, 9.1],
  [100, 35.4],
  [101, 35.5],
  [150, 55.4],
  [151, 55.5],
  [200, 125.4],
  [201, 125.5],
  [300, 225.4],
  [301, 225.5],
  [500, 325.4],
]) {
  test(`PM2.5 conversion preserves the AQI ${aqi} breakpoint`, () => {
    assert.equal(pm25FromAqi(aqi), expected);
  });
}

test('AQI conversion clamps and rounds consistently at band transitions', () => {
  assert.equal(pm25FromAqi(-1), 0);
  assert.equal(pm25FromAqi(501), 325.4);
  assert.equal(categorize(50.49).id, 'good');
  assert.equal(categorize(50.5).id, 'moderate');
  assert.equal(pm25FromAqi(50.5), 9.1);
});

for (const [sensitive, edges] of [
  [
    false,
    [
      [100, 'normal'],
      [101, 'limit'],
      [150, 'limit'],
      [151, 'avoid'],
    ],
  ],
  [
    true,
    [
      [50, 'normal'],
      [51, 'limit'],
      [100, 'limit'],
      [101, 'avoid'],
    ],
  ],
]) {
  test(`outdoor guidance switches at exact thresholds for sensitive=${sensitive}`, () => {
    for (const [aqi, expected] of edges) assert.equal(outdoorGuidance(aqi, { sensitive }), expected);
  });
}
