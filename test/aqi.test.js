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
