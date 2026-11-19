/**
 * Deterministic impact engine. Every number shown to the user comes from here —
 * the language model only explains these figures, it never invents them.
 */
import { pm25FromAqi } from './aqi.js';

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
  WINTER_WEEKS: 13,
});

const round = (n, digits = 1) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

/** Cigarette-equivalents of breathing a constant PM2.5 level for `hours`. */
export function cigaretteEquivalent(pm25, hours = 24) {
  return (pm25 * hours) / 24 / FACTORS.PM25_PER_CIGARETTE;
}

/** Time-weighted mean PM2.5 (µg/m³) a person breathes over 24 h. */
export function meanExposure({ outdoorPm25, outdoorHours, indoorRatio, respirator }) {
  const outdoorFactor = respirator ? 1 - FACTORS.RESPIRATOR_REDUCTION : 1;
  const indoorHours = 24 - outdoorHours;
  return (outdoorPm25 * outdoorHours * outdoorFactor + outdoorPm25 * indoorRatio * indoorHours) / 24;
}

function feasibleModes(oneWayKm) {
  const modes = ['wfh', 'metro', 'bus'];
  if (oneWayKm <= 8) modes.push('bike');
  if (oneWayKm <= 3) modes.push('walk');
  return modes;
}

/** Weekly/seasonal CO2e saved by swapping the current commute mode for each feasible one. */
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
 * @param {object} profile validated profile
 * @param {{aqi:number, pm25:number}} air current conditions
 * @param {{respirator?: boolean}} [plan] whether the plan asks people to wear a respirator outdoors
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
