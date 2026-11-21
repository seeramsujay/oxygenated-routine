/**
 * @fileoverview Deterministic environmental impact and exposure calculation engine.
 *
 * All exposure figures, cigarette-equivalents, and commute carbon emissions shown
 * to users are computed deterministically here. Generative models only explain and
 * contextualize these pre-computed metrics—they never invent or estimate figures.
 *
 * Scientific foundations:
 * - Berkeley Earth Rule of Thumb: 22 µg/m³ PM2.5 over 24h ≈ 1 cigarette equivalent.
 *   Reference: Berkeley Earth study on particulate air pollution and cigarette equivalence.
 * - Indoor particle infiltration factors:
 *   - Natural ventilation (open windows): ~90% infiltration ratio (0.90).
 *   - Closed/sealed building envelope: ~60% infiltration ratio (0.60).
 *   - Portable HEPA filtration: cuts remaining indoor PM2.5 by ~50% (effective ~0.30).
 * - Respiratory protection: well-fitted N95/FFP2 respirator delivers ~60% effective exposure
 *   reduction in real-world everyday wearing conditions (factoring in minor face-seal leakages).
 * - Commute emissions: UK DEFRA & International Energy Agency (IEA) average passenger-km factors.
 */
import { pm25FromAqi } from './aqi.js';

/**
 * Standard environmental and epidemiological conversion factors.
 */
export const FACTORS = Object.freeze({
  /** Berkeley Earth rule of thumb: 22 µg/m³ of PM2.5 over 24 h ≈ 1 cigarette. */
  PM25_PER_CIGARETTE: 22,
  /** Indoor/outdoor PM2.5 ratio, windows open vs. closed and sealed. */
  INDOOR_RATIO_OPEN: 0.9,
  INDOOR_RATIO_SEALED: 0.6,
  /** A HEPA purifier sized for the room removes roughly half of remaining indoor PM2.5. */
  PURIFIER_REDUCTION: 0.5,
  /** Well-fitted N95/FFP2: ~95% filtration on paper, ~60% in everyday wear. */
  RESPIRATOR_REDUCTION: 0.6,
  /** Approximate kg CO2e per passenger-km (DEFRA/IEA-style averages). */
  CO2E_KG_PER_KM: Object.freeze({
    car: 0.17,
    motorbike: 0.11,
    bus: 0.1,
    metro: 0.04,
    bike: 0,
    walk: 0,
    wfh: 0,
  }),
  /** Number of weeks in a typical peak winter smog season. */
  WINTER_WEEKS: 13,
});

/**
 * Helper to round numbers to a fixed number of decimal digits.
 *
 * @param {number} n - Number to round.
 * @param {number} [digits=1] - Decimal precision.
 * @returns {number} Rounded value.
 */
const round = (n, digits = 1) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

/**
 * Converts breathing a given PM2.5 concentration for a duration into cigarette equivalents.
 *
 * Formula: (pm25 * hours) / (24 * 22 µg/m³)
 *
 * @param {number} pm25 - Particulate concentration in µg/m³.
 * @param {number} [hours=24] - Exposure duration in hours.
 * @returns {number} Cigarette-equivalent dosage.
 */
export function cigaretteEquivalent(pm25, hours = 24) {
  return (pm25 * hours) / 24 / FACTORS.PM25_PER_CIGARETTE;
}

/**
 * Computes the 24-hour time-weighted average PM2.5 concentration inhaled by a person.
 *
 * Formula: (C_out * T_out * F_resp + C_out * R_in * T_in) / 24
 * where:
 * - C_out = outdoor PM2.5
 * - T_out = hours spent outdoors
 * - F_resp = respirator penetration factor (0.4 if worn, 1.0 if not)
 * - R_in = indoor/outdoor penetration ratio
 * - T_in = hours spent indoors (24 - T_out)
 *
 * @param {{
 *   outdoorPm25: number,
 *   outdoorHours: number,
 *   indoorRatio: number,
 *   respirator: boolean
 * }} params - Exposure parameters.
 * @returns {number} Time-weighted mean PM2.5 in µg/m³.
 */
export function meanExposure({ outdoorPm25, outdoorHours, indoorRatio, respirator }) {
  const outdoorFactor = respirator ? 1 - FACTORS.RESPIRATOR_REDUCTION : 1;
  const indoorHours = 24 - outdoorHours;
  return (outdoorPm25 * outdoorHours * outdoorFactor + outdoorPm25 * indoorRatio * indoorHours) / 24;
}

/**
 * Determines plausible alternative transit modes given one-way commute distance.
 *
 * @param {number} oneWayKm - Commute distance one way in kilometers.
 * @returns {string[]} Feasible transit modes.
 */
function feasibleModes(oneWayKm) {
  const modes = ['wfh', 'metro', 'bus'];
  if (oneWayKm <= 8) modes.push('bike');
  if (oneWayKm <= 3) modes.push('walk');
  return modes;
}

/**
 * Calculates weekly and seasonal greenhouse gas (CO2e) savings from swapping the current commute.
 *
 * @param {{ mode: string, oneWayKm: number, daysPerWeek: number }} commute - Current commute details.
 * @returns {Array<{ mode: string, savedKgPerWeek: number, savedKgPerWinter: number }>} Ranked alternatives.
 */
export function commuteAlternatives({ mode, oneWayKm, daysPerWeek }) {
  const perKm = FACTORS.CO2E_KG_PER_KM;
  const weeklyKm = oneWayKm * 2 * daysPerWeek;
  const current = perKm[mode] * weeklyKm;
  return feasibleModes(oneWayKm)
    .filter((alt) => alt !== mode && perKm[alt] < perKm[mode])
    .map((alt) => {
      const savedKgPerWeek = round(current - perKm[alt] * weeklyKm, 1);
      return { mode: alt, savedKgPerWeek, savedKgPerWinter: round(savedKgPerWeek * FACTORS.WINTER_WEEKS, 0) };
    })
    .filter((a) => a.savedKgPerWeek > 0)
    .sort((a, b) => b.savedKgPerWeek - a.savedKgPerWeek);
}

/**
 * Computes comparative exposure metrics and emission reduction options for a household.
 *
 * Compares three scenarios:
 * 1. Unprotected: spending 24 hours outdoors in current conditions.
 * 2. Baseline: current household habits (indoor infiltration based on current purifier status, no outdoor mask).
 * 3. With Plan: recommended actions (sealed windows, HEPA air cleaning, and outdoor N95 respirator if indicated).
 *
 * @param {object} profile - Validated household profile.
 * @param {{ aqi: number, pm25?: number }} air - Current air quality conditions.
 * @param {{ respirator?: boolean }} [options] - Whether the action plan recommends wearing a respirator outdoors.
 * @returns {object} Quantified exposure reduction and commute carbon alternatives.
 */
export function computeImpact(profile, air, { respirator = true } = {}) {
  const outdoorPm25 = air.pm25 ?? pm25FromAqi(air.aqi);
  const outdoorHours = profile.outdoorHours;

  const baselineRatio = profile.home.hasPurifier
    ? FACTORS.INDOOR_RATIO_SEALED * (1 - FACTORS.PURIFIER_REDUCTION)
    : FACTORS.INDOOR_RATIO_OPEN;
  const actionRatio = FACTORS.INDOOR_RATIO_SEALED * (1 - FACTORS.PURIFIER_REDUCTION);

  const baselineMean = meanExposure({ outdoorPm25, outdoorHours, indoorRatio: baselineRatio, respirator: false });
  const actionMean = meanExposure({ outdoorPm25, outdoorHours, indoorRatio: actionRatio, respirator });

  const unprotected = cigaretteEquivalent(outdoorPm25);
  const baseline = cigaretteEquivalent(baselineMean);
  const withActions = cigaretteEquivalent(actionMean);

  return {
    outdoorPm25: round(outdoorPm25, 1),
    exposure: {
      standingOutsideAllDayCigarettes: round(unprotected, 1),
      todayCurrentHabitsCigarettes: round(baseline, 1),
      todayWithPlanCigarettes: round(withActions, 1),
      reductionPercent: baseline > 0 ? Math.round((1 - withActions / baseline) * 100) : 0,
      meanPm25CurrentHabits: round(baselineMean, 1),
      meanPm25WithPlan: round(actionMean, 1),
    },
    commute: {
      currentKgCo2ePerWeek: round(
        FACTORS.CO2E_KG_PER_KM[profile.commute.mode] * profile.commute.oneWayKm * 2 * profile.commute.daysPerWeek,
        1,
      ),
      alternatives: commuteAlternatives(profile.commute),
    },
    assumptions: [
      '22 µg/m³ of PM2.5 over 24 h ≈ 1 cigarette (Berkeley Earth rule of thumb) — a communication aid, not a medical measurement.',
      'Indoor PM2.5 ≈ 90% of outdoor with windows open, ≈ 60% with windows closed, and about half of that again with a right-sized HEPA purifier.',
      'A well-fitted N95/FFP2 respirator cuts what you inhale outdoors by about 60% in everyday use.',
      'Commute CO2e uses average passenger-km factors (car 0.17, motorbike 0.11, bus 0.10, metro 0.04 kg/km).',
    ],
  };
}
