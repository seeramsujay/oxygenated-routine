/** Shared test fixtures: a fake Open-Meteo and a helper that builds full API responses. */
import { createPlan } from '../src/planner.js';

const DAY = '2026-11-19';

/** Hourly AQI over 48 h: a bad morning peak (+40) and a clean afternoon dip (-40) around the base. */
function hourlyAqi(base) {
  const times = [];
  const values = [];
  for (const date of [DAY, '2026-11-20']) {
    for (let hour = 0; hour < 24; hour++) {
      times.push(`${date}T${String(hour).padStart(2, '0')}:00`);
      if (hour === 9 || hour === 10) values.push(base + 40);
      else values.push(hour === 14 || hour === 15 ? base - 40 : base);
    }
  }
  return { time: times, us_aqi: values };
}

/**
 * @param {{aqi?: number, pm25?: number|null, places?: object[], status?: number}} [options]
 * @returns {typeof fetch} a fetch replacement that records its calls on `.calls`
 */
export function fakeOpenMeteo({ aqi = 170, pm25 = 95, places, status = 200 } = {}) {
  const results = places ?? [{ name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.23 }];
  const impl = async (url) => {
    impl.calls.push(String(url));
    const json = String(url).includes('geocoding-api')
      ? { results }
      : {
          current: { time: `${DAY}T10:30`, us_aqi: aqi, pm2_5: pm25, pm10: 120, nitrogen_dioxide: 40 },
          hourly: hourlyAqi(aqi),
        };
    return { ok: status === 200, status, json: async () => json };
  };
  impl.calls = [];
  return impl;
}

/** Full API response for a profile, using the offline rule engine. */
export const buildResponse = (input = {}, deps = {}) =>
  createPlan({ location: 'Delhi', ...input }, { fetchImpl: fakeOpenMeteo(), llmEnabled: false, ...deps });
