/**
 * @fileoverview Location-aware & pollutant-specific intelligence engine.
 *
 * Enriches air-quality data with:
 * 1. Regional smog & climate profiles (local respirator standard, dominant sources,
 *    monitoring resources, and region-specific practical tips).
 * 2. Country-resolved emergency & medical helpline numbers.
 * 3. Pollutant-vs-WHO-guideline analysis (PM2.5, PM10, NO2).
 */
import {
  COUNTRY_HELPLINES,
  COUNTRY_TO_REGION,
  REGIONAL_PROFILES,
  REGION_FALLBACK_HELPLINES,
  TIMEZONE_PREFIX_TO_REGION,
  TIMEZONE_TO_COUNTRY,
  WHO_GUIDELINES,
} from './locationData.js';

export { WHO_GUIDELINES };

/** Matches a trailing country name in free-text locations (e.g. "Delhi, India") when `location.country` is absent. */
function matchNameSuffix(name, table) {
  const lower = String(name ?? '')
    .trim()
    .toLowerCase();
  if (!lower) return null;
  for (const key of table.keys()) {
    if (new RegExp(`(?:^|,\\s*)${key}$`, 'i').test(lower)) return key;
  }
  return null;
}

/** Resolves a canonical lowercase country key from structured country, location suffix, or Open-Meteo timezone. */
function resolveCountryKey(location = {}, timezone = null, table = COUNTRY_HELPLINES) {
  const country = String(location.country ?? '')
    .trim()
    .toLowerCase();
  if (table.has(country)) return country;
  const fromName = matchNameSuffix(location.name, table);
  if (fromName) return fromName;
  const tzCountry = TIMEZONE_TO_COUNTRY.get(String(timezone ?? ''));
  return tzCountry && table.has(tzCountry) ? tzCountry : null;
}

/**
 * Resolves the regional profile from location country, name, or Open-Meteo timezone.
 *
 * @param {object} location
 * @param {string|null|undefined} [timezone]
 * @returns {object}
 */
export function detectRegion(location = {}, timezone = null) {
  const countryKey = resolveCountryKey(location, timezone, COUNTRY_TO_REGION);
  if (countryKey) return REGIONAL_PROFILES[COUNTRY_TO_REGION.get(countryKey)];
  const tz = String(timezone ?? '');
  for (const [prefix, regionId] of TIMEZONE_PREFIX_TO_REGION) {
    if (tz.startsWith(prefix)) return REGIONAL_PROFILES[regionId];
  }
  return REGIONAL_PROFILES.global;
}

/**
 * Resolves emergency & medical helpline numbers from location country, timezone, or regional fallback.
 *
 * @param {object} location
 * @param {string} regionId
 * @param {string|null|undefined} [timezone]
 * @returns {Array<{label: string, number: string}>}
 */
export function getHelplines(location = {}, regionId = 'global', timezone = null) {
  const key = resolveCountryKey(location, timezone, COUNTRY_HELPLINES);
  if (key) return COUNTRY_HELPLINES.get(key);
  return REGION_FALLBACK_HELPLINES[regionId] ?? REGION_FALLBACK_HELPLINES.global;
}

/**
 * Builds structured pollutant-vs-WHO comparisons from available air readings.
 *
 * @param {{ pm25?: number|null, pm10?: number|null, no2?: number|null }} air
 * @returns {{
 *   items: Array<{id: string, label: string, value: number, unit: string, whoGuideline: number, ratioToWho: number, meaning: string, advice: string}>,
 *   dominant: {id: string, label: string, ratioToWho: number, advice: string}|null
 * }}
 */
export function analyzePollutants(air = {}) {
  const specs = [
    {
      id: 'pm25',
      label: 'PM2.5 (fine smoke & haze)',
      value: air.pm25,
      whoGuideline: WHO_GUIDELINES.pm25,
      meaning:
        'Microscopic particles from smoke, exhaust and secondary smog that travel deep into lungs and bloodstream.',
      advice: 'Prioritise HEPA/MERV-13 indoor filtration and a well-sealed respirator outdoors.',
    },
    {
      id: 'pm10',
      label: 'PM10 (coarse dust)',
      value: air.pm10,
      whoGuideline: WHO_GUIDELINES.pm10,
      meaning: 'Larger dust particles from roads, construction and dry soil that irritate eyes, nose and airways.',
      advice: 'Wet-mop floors, leave shoes at the door, and avoid dusty construction corridors.',
    },
    {
      id: 'no2',
      label: 'NO₂ (traffic & gas)',
      value: air.no2,
      whoGuideline: WHO_GUIDELINES.no2,
      meaning:
        'Irritant gas mainly from diesel/petrol engines and unvented gas stoves that triggers airway inflammation.',
      advice: 'Keep away from busy road kerbs and always run an outside-vented extractor when cooking with gas.',
    },
  ];

  const items = specs
    .filter((s) => typeof s.value === 'number' && Number.isFinite(s.value) && s.value >= 0)
    .map((s) => ({
      id: s.id,
      label: s.label,
      value: Math.round(s.value * 10) / 10,
      unit: 'µg/m³',
      whoGuideline: s.whoGuideline,
      ratioToWho: Math.round((s.value / s.whoGuideline) * 10) / 10,
      meaning: s.meaning,
      advice: s.advice,
    }));

  if (items.length === 0) return { items: [], dominant: null };
  const top = [...items].sort((a, b) => b.ratioToWho - a.ratioToWho)[0];
  return {
    items,
    dominant: { id: top.id, label: top.label, ratioToWho: top.ratioToWho, advice: top.advice },
  };
}

/**
 * Builds complete location- and pollutant-specific context for the planner, rules, and UI.
 *
 * @param {{ location: object, air: object }} params
 */
export function buildLocationContext({ location, air }) {
  const region = detectRegion(location, air?.timezone);
  const pollutants = analyzePollutants(air);
  const helplines = getHelplines(location, region.id, air?.timezone);
  return {
    region: {
      id: region.id,
      label: region.label,
      respirator: region.respirator,
      sources: region.sources,
      monitorHint: region.monitorHint,
      tips: region.tips,
    },
    helplines,
    pollutants,
  };
}
