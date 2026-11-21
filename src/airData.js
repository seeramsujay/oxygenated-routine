/**
 * @fileoverview Live air quality and meteorological forecast integration via Open-Meteo APIs.
 *
 * Provides hyper-local geocoding and atmospheric dispersion forecasts without requiring API keys.
 * Implements waking-hours window search (07:00–21:00) to find cleaner outdoor intervals,
 * ensuring plans never recommend activities during nocturnal air inversions or high-pollution peaks.
 */
import { config } from './config.js';
import { badRequest, notFound, upstream } from './errors.js';
import { categorize, pm25FromAqi } from './aqi.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Executes a resilient HTTP GET for JSON endpoints with timeout abort signals.
 *
 * @param {string} url - Target URL.
 * @param {typeof fetch} fetchImpl - Injected fetch implementation for testability.
 * @returns {Promise<any>} Parsed JSON payload.
 * @throws {AppError} Upstream 502 error if connection fails or response is not OK.
 */
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

/**
 * Searches for geographic locations matching a user query string.
 *
 * @param {string} query - City, town, or regional place name.
 * @param {typeof fetch} [fetchImpl=fetch] - Injected fetch implementation.
 * @returns {Promise<Array<{name:string, admin1?:string, country?:string, latitude:number, longitude:number}>>}
 */
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

/**
 * Resolves free text into the top matching place or throws a 404 AppError.
 *
 * @param {string} text - Location search string.
 * @param {typeof fetch} [fetchImpl=fetch] - Injected fetch implementation.
 * @returns {Promise<{name:string, admin1?:string, country?:string, latitude:number, longitude:number}>}
 */
export async function resolveLocation(text, fetchImpl = fetch) {
  const [best] = await geocode(text, fetchImpl);
  if (!best) throw notFound(`We couldn't find "${text}". Try "City, Country".`);
  return best;
}

/**
 * Fetches real-time atmospheric measurements and 48-hour hourly AQI forecasts.
 *
 * Retrieves US AQI, PM2.5, PM10, and Nitrogen Dioxide (NO2) in the local timezone of the coordinates.
 *
 * @param {{ latitude: number, longitude: number }} coords - Coordinates of the target location.
 * @param {typeof fetch} [fetchImpl=fetch] - Injected fetch implementation.
 * @returns {Promise<{
 *   aqi: number,
 *   pm25: number,
 *   pm10: number|null,
 *   no2: number|null,
 *   time: string,
 *   category: object,
 *   hourly: Array<{time:string, aqi:number}>
 * }>}
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

/** Extracts integer hour (0-23) from an ISO time string like "2026-11-22T14:00". */
const hourOf = (time) => Number(time.slice(11, 13));

/**
 * Converts local ISO time string (`YYYY-MM-DDTHH:MM`) to epoch minutes for difference calculations.
 * Used exclusively for relative interval comparisons between timestamps of the same local timezone.
 */
const minutesOf = (time) => Date.parse(`${time.slice(0, 16)}:00Z`) / 60_000;

/**
 * Minimum improvement threshold in AQI points required to recommend an outdoor window.
 * Ensures the app only advises shifting schedules when there is a tangible air quality advantage.
 */
export const MIN_WINDOW_GAIN_AQI = 10;

/** Waking hours filter: 07:00 to 21:00 inclusive. */
const isWaking = (h) => hourOf(h.time) >= 7 && hourOf(h.time) <= 21;

/** Checks if an array of hourly readings contains strictly contiguous, consecutive 60-minute intervals. */
const isConsecutive = (slice) =>
  slice.every((h, i) => i === 0 || minutesOf(h.time) - minutesOf(slice[i - 1].time) === 60);

/**
 * Filters forecast readings for the 24-hour horizon starting from the current hour.
 *
 * @param {Array<{time: string, aqi: number}>} hourly - Forecast readings.
 * @param {string} currentTime - ISO timestamp of the current reading.
 * @returns {Array<{time: string, aqi: number}>} Next 24 hours of readings.
 */
export function next24Hours(hourly, currentTime) {
  const from = minutesOf(`${currentTime.slice(0, 13)}:00`);
  return hourly.filter((h) => {
    const offset = minutesOf(h.time) - from;
    return offset >= 0 && offset < 24 * 60;
  });
}

/**
 * Finds the consecutive run of `span` waking hours with the lowest average AQI.
 *
 * @param {Array<{time: string, aqi: number}>} upcoming - Forecast readings for the upcoming 24 hours.
 * @param {number} span - Length of consecutive window in hours.
 * @returns {{start: string, end: string, avgAqi: number, peakAqi: number}|null}
 */
function cleanestRun(upcoming, span) {
  let best = null;
  for (let i = 0; i + span <= upcoming.length; i++) {
    const slice = upcoming.slice(i, i + span);
    if (!slice.every(isWaking) || !isConsecutive(slice)) continue;
    const avg = slice.reduce((sum, h) => sum + h.aqi, 0) / span;
    if (!best || avg < best.avgAqi) {
      best = {
        start: slice[0].time,
        end: slice[span - 1].time,
        avgAqi: Math.round(avg),
        peakAqi: Math.max(...slice.map((h) => h.aqi)),
      };
    }
  }
  return best;
}

/**
 * Identifies the cleanest consecutive `span` waking hours (07:00–21:00) within the next 24 hours.
 *
 * Returns null if no window provides at least `MIN_WINDOW_GAIN_AQI` improvement over the worst waking hour.
 * Preserves `peakAqi` within the window so downstream health & safety checks verify that even the
 * highest hour in the window is acceptable.
 *
 * @param {Array<{time: string, aqi: number}>} hourly - Hourly AQI forecast.
 * @param {string} currentTime - Current time in local ISO format.
 * @param {number} [span=2] - Target window length in hours (default 2 hours).
 * @returns {{
 *   start: string,
 *   end: string,
 *   day: 'today'|'tomorrow',
 *   avgAqi: number,
 *   peakAqi: number,
 *   worstHour: string,
 *   worstAqi: number
 * }|null}
 */
export function bestWindow(hourly, currentTime, span = 2) {
  if (!hourly?.length || !currentTime) return null;
  const upcoming = next24Hours(hourly, currentTime);
  const best = cleanestRun(upcoming, span);
  if (!best) return null;
  const worst = upcoming.filter(isWaking).reduce((w, h) => (h.aqi > w.aqi ? h : w));
  if (worst.aqi - best.avgAqi < MIN_WINDOW_GAIN_AQI) return null;
  // `end` is the start of the last hour; display the window as ending one hour later.
  const endHour = String((hourOf(best.end) + 1) % 24).padStart(2, '0');
  return {
    start: best.start.slice(11, 16),
    end: `${endHour}:00`,
    day: best.start.slice(0, 10) === currentTime.slice(0, 10) ? 'today' : 'tomorrow',
    avgAqi: best.avgAqi,
    peakAqi: best.peakAqi,
    worstHour: worst.time.slice(11, 16),
    worstAqi: worst.aqi,
  };
}
