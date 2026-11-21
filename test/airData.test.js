import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestWindow, fetchAir, geocode, next24Hours, resolveLocation } from '../src/airData.js';
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
    peakAqi: 130,
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

test('bestWindow requires the exact minimum improvement of ten AQI points', () => {
  const date = '2026-11-19';
  assert.equal(bestWindow(hours(date, 7, [90, 90, 99]), `${date}T07:00`), null);
  assert.deepEqual(bestWindow(hours(date, 7, [90, 90, 100]), `${date}T07:00`), {
    start: '07:00',
    end: '09:00',
    day: 'today',
    avgAqi: 90,
    peakAqi: 90,
    worstHour: '09:00',
    worstAqi: 100,
  });
});

test('bestWindow keeps the peak reading for safety even when the average is cleaner', () => {
  assert.deepEqual(bestWindow(hours('2026-11-19', 7, [200, 50, 150, 200]), '2026-11-19T07:00'), {
    start: '08:00',
    end: '10:00',
    day: 'today',
    avgAqi: 100,
    peakAqi: 150,
    worstHour: '07:00',
    worstAqi: 200,
  });
});

test('bestWindow excludes night readings from both the best and worst waking hours', () => {
  const hourly = hours('2026-11-19', 6, [500, 100, 100, 105]);
  assert.equal(bestWindow(hourly, '2026-11-19T06:00'), null);
  assert.equal(bestWindow(hours('2026-11-19', 20, [100, 100, 0]), '2026-11-19T20:00'), null);
});

test('bestWindow supports a three-hour span and rejects isolated clean hours', () => {
  const hourly = hours('2026-11-19', 7, [200, 50, 50, 50, 200]);
  assert.equal(bestWindow(hourly, '2026-11-19T07:00', 3).end, '11:00');
  assert.equal(bestWindow(hours('2026-11-19', 7, [50]), '2026-11-19T07:00'), null);
});

test('unreadable upstream JSON is reported as an application error', async () => {
  await rejects(
    geocode('Delhi', async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('private upstream details');
      },
    })),
    502,
  );
});

test('geocode filters invalid coordinates and encodes search text as one query parameter', async () => {
  let requested;
  const place = { name: 'Test', latitude: 0, longitude: 0 };
  const results = await geocode('  A&B  ', async (url) => {
    requested = new URL(url);
    return {
      ok: true,
      json: async () => ({ results: [place, { ...place, latitude: null }, { ...place, longitude: '0' }] }),
    };
  });
  assert.equal(requested.searchParams.get('name'), 'A&B');
  assert.equal(results.length, 1);
  assert.equal(results[0].latitude, 0);
  assert.equal(results[0].longitude, 0);
});

test('next24Hours includes the current hour and excludes the hour exactly one day later', () => {
  const hourly = [...hours('2026-11-19', 9, [1, 2, 3]), ...hours('2026-11-20', 9, [4, 5, 6])];
  assert.deepEqual(next24Hours(hourly, '2026-11-19T10:59'), [hourly[1], hourly[2], hourly[3]]);
});

test('forecast horizon includes the current partial hour and excludes exactly 24 hours later', () => {
  const hourly = [...hours('2026-11-19', 9, [10, 20, 30]), ...hours('2026-11-20', 9, [40, 50])];
  assert.deepEqual(next24Hours(hourly, '2026-11-19T10:59'), [hourly[1], hourly[2], hourly[3]]);
});

test('a window qualifies at exactly ten AQI points of improvement', () => {
  assert.equal(bestWindow(hours('2026-11-19', 7, [90, 90, 100]), '2026-11-19T07:00').avgAqi, 90);
  assert.equal(bestWindow(hours('2026-11-19', 7, [91, 91, 100]), '2026-11-19T07:00'), null);
});

test('window reports its peak separately from its mean and includes the full final hour', () => {
  assert.deepEqual(bestWindow(hours('2026-11-19', 19, [200, 80, 120]), '2026-11-19T19:00'), {
    start: '20:00',
    end: '22:00',
    day: 'today',
    avgAqi: 100,
    peakAqi: 120,
    worstHour: '19:00',
    worstAqi: 200,
  });
});

test('geocoding encodes queries and ignores places without finite coordinates', async () => {
  const fetchImpl = fakeOpenMeteo({
    places: [
      { name: 'Bad', latitude: null, longitude: 1 },
      { name: 'Bad', latitude: 1, longitude: Infinity },
      { name: 'Valid', latitude: 0, longitude: 0 },
    ],
  });
  const places = await geocode('  A&B / city  ', fetchImpl);
  assert.deepEqual(
    places.map((p) => p.name),
    ['Valid'],
  );
  assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('name'), 'A&B / city');
});

test('unreadable upstream JSON becomes a safe 502', async () => {
  await assert.rejects(
    fetchAir({ latitude: 0, longitude: 0 }, async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('private provider response');
      },
    })),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'upstream_error');
      assert.doesNotMatch(error.message, /private provider response/);
      return true;
    },
  );
});
