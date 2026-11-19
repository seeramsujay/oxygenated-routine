import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestWindow, fetchAir, geocode, resolveLocation } from '../src/airData.js';
import { AppError } from '../src/errors.js';
import { fakeOpenMeteo } from './helpers.js';

const rejects = (promise, status) =>
  assert.rejects(promise, (error) => error instanceof AppError && error.status === status);

test('geocode returns clean place objects', async () => {
  const [place] = await geocode('Delhi', fakeOpenMeteo());
  assert.deepEqual(Object.keys(place).sort(), ['admin1', 'country', 'latitude', 'longitude', 'name']);
});

test('geocode and resolveLocation validate input and report unknown places', async () => {
  await rejects(geocode('a', fakeOpenMeteo()), 400);
  await rejects(resolveLocation('Nowhereville', fakeOpenMeteo({ places: [] })), 404);
});

test('fetchAir parses current conditions and the hourly forecast', async () => {
  const air = await fetchAir({ latitude: 28.6, longitude: 77.2 }, fakeOpenMeteo({ aqi: 170, pm25: 95 }));
  assert.equal(air.aqi, 170);
  assert.equal(air.pm25, 95);
  assert.equal(air.category.id, 'unhealthy');
  assert.equal(air.hourly.length, 48);
});

test('fetchAir derives PM2.5 from AQI when the provider omits it', async () => {
  const air = await fetchAir({ latitude: 1, longitude: 1 }, fakeOpenMeteo({ aqi: 100, pm25: null }));
  assert.equal(air.pm25, 35.4);
});

test('upstream failures become friendly 502s, never raw errors', async () => {
  await rejects(fetchAir({ latitude: 1, longitude: 1 }, fakeOpenMeteo({ status: 500 })), 502);
  await rejects(
    fetchAir({ latitude: 1, longitude: 1 }, async () => {
      throw new Error('offline');
    }),
    502,
  );
  await rejects(
    fetchAir({ latitude: 1, longitude: 1 }, async () => ({ ok: true, json: async () => ({}) })),
    502,
  );
});

test('bestWindow finds the clean afternoon dip and the worst morning hour', async () => {
  const air = await fetchAir({ latitude: 1, longitude: 1 }, fakeOpenMeteo({ aqi: 170 }));
  assert.deepEqual(bestWindow(air.hourly, air.time), {
    start: '14:00',
    end: '16:00',
    day: 'today',
    avgAqi: 130,
    worstHour: '10:00',
    worstAqi: 210,
  });
});

test('bestWindow only considers waking hours and handles missing data', () => {
  const night = [0, 1, 2, 3].map((h) => ({ time: `2026-11-19T0${h}:00`, aqi: 30 }));
  assert.equal(bestWindow(night, '2026-11-19T00:10'), null);
  assert.equal(bestWindow([], '2026-11-19T10:00'), null);
  assert.equal(bestWindow(undefined, undefined), null);
});

const hours = (date, from, values) =>
  values.map((aqi, i) => ({ time: `${date}T${String(from + i).padStart(2, '0')}:00`, aqi }));

test('bestWindow labels a window that falls tomorrow', () => {
  const hourly = [
    ...hours('2026-11-19', 18, [200, 200, 200, 200]),
    ...hours('2026-11-20', 7, [200, 200, 120, 120, 200]),
  ];
  const window = bestWindow(hourly, '2026-11-19T18:30');
  assert.equal(window.day, 'tomorrow');
  assert.equal(window.start, '09:00');
});

test('bestWindow never spans a missing hour and never looks past 24 hours', () => {
  // 08:00 is missing; 07:00 and 09:00 must not be treated as consecutive.
  const gap = [...hours('2026-11-19', 7, [50]), ...hours('2026-11-19', 9, [50, 200, 200])];
  assert.notEqual(bestWindow(gap, '2026-11-19T07:00')?.start, '07:00');

  // A very clean slot 30 hours away is outside the horizon even if earlier readings are sparse.
  const sparse = [...hours('2026-11-19', 10, [200, 200]), ...hours('2026-11-20', 16, [20, 20])];
  assert.equal(bestWindow(sparse, '2026-11-19T10:00'), null);
});

test('bestWindow returns nothing when no hour is clearly cleaner', () => {
  const flat = hours('2026-11-19', 8, [200, 200, 200, 200, 200, 205]);
  assert.equal(bestWindow(flat, '2026-11-19T08:00'), null);
});
