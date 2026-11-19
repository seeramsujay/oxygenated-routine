/** Orchestrates one request: validate, fetch live data, compute impact, write the plan. */
import { config } from './config.js';
import { bestWindow, fetchAir, next24Hours, resolveLocation } from './airData.js';
import { categorize, outdoorGuidance, pm25FromAqi } from './aqi.js';
import { computeImpact } from './impact.js';
import { generatePlanWithClaude } from './llm.js';
import { PlanSchema } from './planSchema.js';
import { DEFAULTS, isSensitive, parseProfile } from './profile.js';
import { buildRulePlan } from './rules.js';

const DISCLAIMER =
  'General wellbeing guidance, not medical advice. Exposure figures are estimates built from stated assumptions.';

/** A manually entered AQI skips every network call, so it also works offline. */
function manualConditions(profile) {
  return {
    location: { name: profile.location, manual: true },
    air: {
      aqi: profile.manualAqi,
      pm25: pm25FromAqi(profile.manualAqi),
      pm10: null,
      no2: null,
      time: null,
      category: categorize(profile.manualAqi),
      hourly: [],
      source: 'manual',
    },
  };
}

async function liveConditions(profile, fetchImpl) {
  const location = profile.coordinates
    ? { name: profile.location, ...profile.coordinates }
    : await resolveLocation(profile.location, fetchImpl);
  const air = await fetchAir(location, fetchImpl);
  return { location, air: { ...air, source: 'open-meteo' } };
}

/** Pick Claude when available, and fall back to the rule engine on any failure. */
async function writePlan(ctx, { generate, llmEnabled }) {
  if (!llmEnabled) return { plan: buildRulePlan(ctx), source: 'rules', notice: null };
  try {
    const plan = PlanSchema.parse(await generate(ctx));
    return { plan, source: 'claude', notice: null };
  } catch (error) {
    // Log only the error type: never the profile or the model output.
    console.error('LLM plan failed, using rule engine:', error?.name, error?.status ?? '');
    return {
      plan: buildRulePlan(ctx),
      source: 'rules',
      notice: 'The AI service is unavailable right now, so this plan uses our built-in guidance.',
    };
  }
}

/** True when the user answered at least one household question, so we are not just assuming defaults. */
const isPersonalised = (input) => ['household', 'commute', 'home'].some((key) => input?.[key] !== undefined);

/**
 * @param {unknown} input raw request body
 * @param {{fetchImpl?: typeof fetch, generate?: Function, llmEnabled?: boolean}} [deps]
 */
export async function createPlan(input, deps = {}) {
  const { fetchImpl = fetch, generate = generatePlanWithClaude, llmEnabled = config.llmEnabled() } = deps;
  const profile = parseProfile(input);
  const { location, air } =
    profile.manualAqi === undefined ? await liveConditions(profile, fetchImpl) : manualConditions(profile);

  const sensitive = isSensitive(profile);
  const guidance = outdoorGuidance(air.aqi, { sensitive });
  const window = air.time ? bestWindow(air.hourly, air.time) : null;
  // The plan only tells people to wear a respirator outdoors when guidance is to limit or avoid outdoor time.
  const impact = computeImpact(profile, air, { respirator: guidance !== 'normal' });

  const ctx = { profile, location, air, impact, window, guidance, sensitive };
  const { plan, source, notice } = await writePlan(ctx, { generate, llmEnabled });

  const { hourly: _hourly, ...publicAir } = air;
  return {
    location,
    air: publicAir,
    forecast: air.time
      ? next24Hours(air.hourly, air.time).map((h) => ({ ...h, category: categorize(h.aqi).label }))
      : [],
    guidance,
    sensitive,
    window,
    impact,
    plan,
    meta: { source, notice, disclaimer: DISCLAIMER, personalised: isPersonalised(input), assumed: DEFAULTS },
  };
}
