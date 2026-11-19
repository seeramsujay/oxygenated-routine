/** Live location + air-quality data from Open-Meteo (free, no API key). */
import { config } from './config.js';
import { badRequest, notFound, upstream } from './errors.js';
import { categorize, pm25FromAqi } from './aqi.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw upstream('The air-quality service could not be reached. You can enter an AQI manually.');
  }
  if (!res.ok) throw upstream('The air-quality service returned an error. You can enter an AQI manually.');
  try {
    return await res.json();
  } catch {
    throw upstream('The air-quality service returned unreadable data.');
  }
}

/** @returns {Promise<Array<{name:string, admin1?:string, country?:string, latitude:number, longitude:number}>>} */
export async function geocode(query, fetchImpl = fetch) {
  const name = String(query ?? '').trim();
  if (name.length < 2) throw badRequest('Enter at least 2 characters.');
  const params = new URLSearchParams({ name, count: '5', language: 'en', format: 'json' });
  const data = await getJson(`${GEO_URL}?${params}`, fetchImpl);
  return (data.results ?? [])
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
}

/** Resolve free text to the best-matching place or throw 404. */
export async function resolveLocation(text, fetchImpl = fetch) {
  const [best] = await geocode(text, fetchImpl);
  if (!best) throw notFound(`We couldn't find "${text}". Try "City, Country".`);
  return best;
}

/**
 * Current air quality plus the hourly AQI forecast (local time of the place).
 * @returns {Promise<{aqi:number, pm25:number, pm10:number|null, no2:number|null, time:string, category:object, hourly:Array<{time:string, aqi:number}>}>}
 */
export async function fetchAir({ latitude, longitude }, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide',
    hourly: 'us_aqi',
    forecast_days: '2',
    timezone: 'auto',
  });
  const data = await getJson(`${AIR_URL}?${params}`, fetchImpl);
  const current = data?.current;
  if (!current || typeof current.us_aqi !== 'number') {
    throw upstream('No air-quality reading is available for this place yet. You can enter an AQI manually.');
  }
  const times = data.hourly?.time ?? [];
  const values = data.hourly?.us_aqi ?? [];
  const hourly = times.map((time, i) => ({ time, aqi: values[i] })).filter((h) => typeof h.aqi === 'number');
  return {
    aqi: Math.round(current.us_aqi),
    pm25: typeof current.pm2_5 === 'number' ? current.pm2_5 : pm25FromAqi(current.us_aqi),
    pm10: current.pm10 ?? null,
    no2: current.nitrogen_dioxide ?? null,
    time: current.time,
    category: categorize(current.us_aqi),
    hourly,
  };
}

const hourOf = (time) => Number(time.slice(11, 13));

/** Minutes since the epoch for a local ISO time (`YYYY-MM-DDTHH:MM`), compared only with each other. */
const minutesOf = (time) => Date.parse(`${time.slice(0, 16)}:00Z`) / 60_000;

/** A window is only worth recommending when it beats the day's worst waking hour by a clear margin. */
export const MIN_WINDOW_GAIN_AQI = 10;

const isWaking = (h) => hourOf(h.time) >= 7 && hourOf(h.time) <= 21;
const isConsecutive = (slice) =>
  slice.every((h, i) => i === 0 || minutesOf(h.time) - minutesOf(slice[i - 1].time) === 60);

/** Readings from the current hour up to (not including) 24 hours later, by elapsed time rather than count. */
export function next24Hours(hourly, currentTime) {
  const from = minutesOf(`${currentTime.slice(0, 13)}:00`);
  return hourly.filter((h) => {
    const offset = minutesOf(h.time) - from;
    return offset >= 0 && offset < 24 * 60;
  });
}

/** Lowest-average run of `span` consecutive waking hours. */
function cleanestRun(upcoming, span) {
  let best = null;
  for (let i = 0; i + span <= upcoming.length; i++) {
    const slice = upcoming.slice(i, i + span);
    if (!slice.every(isWaking) || !isConsecutive(slice)) continue;
    const avg = slice.reduce((sum, h) => sum + h.aqi, 0) / span;
    if (!best || avg < best.avgAqi) best = { start: slice[0].time, end: slice[span - 1].time, avgAqi: Math.round(avg) };
  }
  return best;
}

/**
 * Cleanest consecutive `span` waking hours (07:00–21:00) within the next 24 hours.
 * Times are the place's local time. Hours with missing readings break a window rather than being skipped.
 * Returns null when no window beats the worst waking hour by at least MIN_WINDOW_GAIN_AQI.
 * @returns {{start:string, end:string, day:'today'|'tomorrow', avgAqi:number, worstHour:string, worstAqi:number}|null}
 */
export function bestWindow(hourly, currentTime, span = 2) {
  if (!hourly?.length || !currentTime) return null;
  const upcoming = next24Hours(hourly, currentTime);
  const best = cleanestRun(upcoming, span);
  if (!best) return null;
  const worst = upcoming.filter(isWaking).reduce((w, h) => (h.aqi > w.aqi ? h : w));
  if (worst.aqi - best.avgAqi < MIN_WINDOW_GAIN_AQI) return null;
  // `end` is the start of the last hour; show the window as ending one hour later.
  const endHour = String((hourOf(best.end) + 1) % 24).padStart(2, '0');
  return {
    start: best.start.slice(11, 16),
    end: `${endHour}:00`,
    day: best.start.slice(0, 10) === currentTime.slice(0, 10) ? 'today' : 'tomorrow',
    avgAqi: best.avgAqi,
    worstHour: worst.time.slice(11, 16),
    worstAqi: worst.aqi,
  };
}
