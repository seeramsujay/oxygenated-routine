/** US EPA AQI helpers: categories, PM2.5 conversion and outdoor-activity guidance. */

const BANDS = [
  { id: 'good', label: 'Good', min: 0, max: 50, meaning: 'Air is clean. Normal outdoor life is fine.' },
  {
    id: 'moderate',
    label: 'Moderate',
    min: 51,
    max: 100,
    meaning: 'Acceptable for most people. Unusually sensitive people may notice effects.',
  },
  {
    id: 'unhealthy_sensitive',
    label: 'Unhealthy for sensitive groups',
    min: 101,
    max: 150,
    meaning: 'Children, older adults and people with heart or lung conditions should cut back outdoors.',
  },
  {
    id: 'unhealthy',
    label: 'Unhealthy',
    min: 151,
    max: 200,
    meaning:
      'Everyone may start to feel effects, such as a scratchy throat or tiredness. Sensitive groups are at higher risk.',
  },
  {
    id: 'very_unhealthy',
    label: 'Very unhealthy',
    min: 201,
    max: 300,
    meaning: 'Health warning: everyone should avoid prolonged time outdoors.',
  },
  {
    id: 'hazardous',
    label: 'Hazardous',
    min: 301,
    max: 500,
    meaning: 'Emergency conditions: stay indoors with clean air and avoid all outdoor exertion.',
  },
];

/** [aqiLow, aqiHigh, pm25Low, pm25High] — EPA 2024 PM2.5 breakpoints (µg/m³). */
const PM25_BREAKPOINTS = [
  [0, 50, 0, 9.0],
  [51, 100, 9.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 125.4],
  [201, 300, 125.5, 225.4],
  [301, 500, 225.5, 325.4],
];

const clampAqi = (aqi) => Math.min(500, Math.max(0, Math.round(aqi)));

/** @param {number} aqi */
export function categorize(aqi) {
  const value = clampAqi(aqi);
  return BANDS.find((b) => value >= b.min && value <= b.max);
}

/** Approximate PM2.5 (µg/m³) for an AQI value; used when only a manual AQI is known. */
export function pm25FromAqi(aqi) {
  const value = clampAqi(aqi);
  const [aLo, aHi, cLo, cHi] = PM25_BREAKPOINTS.find(([lo, hi]) => value >= lo && value <= hi);
  return Math.round((cLo + ((value - aLo) * (cHi - cLo)) / (aHi - aLo)) * 10) / 10;
}

/**
 * How much time outdoors is sensible. Sensitive groups (children, seniors, people
 * with heart/lung conditions, pregnancy) are held to a stricter threshold.
 * @returns {'normal'|'limit'|'avoid'}
 */
export function outdoorGuidance(aqi, { sensitive }) {
  const value = clampAqi(aqi);
  const [limitFrom, avoidFrom] = sensitive ? [51, 101] : [101, 151];
  if (value >= avoidFrom) return 'avoid';
  if (value >= limitFrom) return 'limit';
  return 'normal';
}
