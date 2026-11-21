/**
 * @fileoverview US EPA Air Quality Index (AQI) calculation and guidance engine.
 *
 * Implements the US EPA 2024 Air Quality Index reporting standards for fine particulate
 * matter (PM2.5). Provides piecewise linear concentration-to-index conversions, health
 * advisory category lookups, and household-sensitive outdoor activity guidance.
 *
 * Reference: EPA-454/B-24-001 "Technical Assistance Document for the Reporting of Daily Air Quality"
 */

/**
 * Standard EPA AQI categories, index ranges, and clinical/public health meanings.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   label: string,
 *   min: number,
 *   max: number,
 *   meaning: string
 * }>}
 */
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

/**
 * EPA 2024 PM2.5 Concentration Breakpoints (µg/m³).
 *
 * Format: [AQI_low, AQI_high, PM2.5_low, PM2.5_high]
 * Note: Under the 2024 revised standard, the 'Good' band upper breakpoint was tightened
 * from 12.0 µg/m³ to 9.0 µg/m³ to reflect updated epidemiological evidence on fine particle toxicity.
 *
 * @type {ReadonlyArray<[number, number, number, number]>}
 */
const PM25_BREAKPOINTS = [
  [0, 50, 0, 9.0],
  [51, 100, 9.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 125.4],
  [201, 300, 125.5, 225.4],
  [301, 500, 225.5, 325.4],
];

/**
 * Clamps an AQI value to the official EPA reporting scale [0, 500] and rounds to nearest integer.
 *
 * @param {number} aqi - Raw input AQI value.
 * @returns {number} Clamped integer in range 0–500.
 */
const clampAqi = (aqi) => Math.min(500, Math.max(0, Math.round(aqi)));

/**
 * Determines the EPA health advisory band for a given AQI value.
 *
 * @param {number} aqi - Air Quality Index value (clamped between 0 and 500).
 * @returns {{id: string, label: string, min: number, max: number, meaning: string}} Matching band descriptor.
 */
export function categorize(aqi) {
  const value = clampAqi(aqi);
  return BANDS.find((b) => value >= b.min && value <= b.max);
}

/**
 * Approximates PM2.5 mass concentration (µg/m³) from an AQI value using inverse piecewise linear interpolation.
 *
 * Used when only manual or consumer-sensor AQI readings are provided without raw particulate readings.
 * Math: Cp = ((I - I_low) / (I_high - I_low)) * (C_high - C_low) + C_low
 *
 * @param {number} aqi - Air Quality Index value.
 * @returns {number} Estimated PM2.5 concentration in µg/m³, rounded to 1 decimal place.
 */
export function pm25FromAqi(aqi) {
  const value = clampAqi(aqi);
  const [aLo, aHi, cLo, cHi] = PM25_BREAKPOINTS.find(([lo, hi]) => value >= lo && value <= hi);
  return Math.round((cLo + ((value - aLo) * (cHi - cLo)) / (aHi - aLo)) * 10) / 10;
}

/**
 * Assesses outdoor activity safety level based on AQI and household vulnerability profile.
 *
 * Stricter thresholds are applied for sensitive groups (children, seniors, individuals with
 * respiratory/cardiovascular illness, or pregnancy):
 * - Sensitive households: Limit outdoors at AQI >= 51 (Moderate), Avoid at AQI >= 101.
 * - General population: Limit outdoors at AQI >= 101 (Unhealthy for Sensitive), Avoid at AQI >= 151 (Unhealthy).
 *
 * @param {number} aqi - Air Quality Index value.
 * @param {{ sensitive: boolean }} options - Household vulnerability flag.
 * @returns {'normal'|'limit'|'avoid'} Prescribed outdoor activity level.
 */
export function outdoorGuidance(aqi, { sensitive }) {
  const value = clampAqi(aqi);
  const [limitFrom, avoidFrom] = sensitive ? [51, 101] : [101, 151];
  if (value >= avoidFrom) return 'avoid';
  if (value >= limitFrom) return 'limit';
  return 'normal';
}
