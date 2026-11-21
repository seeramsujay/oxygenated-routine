/**
 * @fileoverview Plan orchestration pipeline.
 *
 * Coordinates end-to-end plan creation:
 * 1. Validates and normalizes untrusted user input into a strongly typed profile.
 * 2. Resolves atmospheric conditions:
 *    - Manual AQI: fully offline path using local monitor inputs.
 *    - Geocoded: live Open-Meteo atmospheric readings and hourly forecasts.
 * 3. Assesses household vulnerability (children, seniors, chronic conditions).
 * 4. Determines EPA outdoor activity advisory level ('normal', 'limit', 'avoid').
 * 5. Discovers the diurnal cleanest forecast window (waking hours 07:00–21:00).
 * 6. Calculates quantitative impact and cigarette equivalents deterministically.
 * 7. Synthesizes personalized plan via Anthropic Claude (if configured), verified by
 *    zero-trust safety guardrails, seamlessly falling back to the deterministic rule engine.
 */
import { config } from './config.js';
import { bestWindow, fetchAir, next24Hours, resolveLocation } from './airData.js';
import { categorize, outdoorGuidance, pm25FromAqi } from './aqi.js';
import { computeImpact } from './impact.js';
import { generatePlanWithClaude } from './llm.js';
import { PlanSchema } from './planSchema.js';
import { DEFAULTS, isSensitive, parseProfile } from './profile.js';
import { buildRulePlan } from './rules.js';
import { findSafetyViolation } from './safety.js';

const DISCLAIMER =
  'General wellbeing guidance, not medical advice. Exposure figures are estimates built from stated assumptions.';

/**
 * Constructs an air conditions record when the user enters an AQI manually from a local sensor.
 * Completely skips network calls, enabling 100% offline functionality.
 *
 * @param {object} profile - Validated household profile.
 * @returns {{location: object, air: object}}
 */
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

/**
 * Resolves geolocation coordinates and retrieves live atmospheric conditions and forecasts.
 *
 * @param {object} profile - Validated household profile.
 * @param {typeof fetch} fetchImpl - Injected fetch implementation.
 * @returns {Promise<{location: object, air: object}>}
 */
async function liveConditions(profile, fetchImpl) {
  const location = profile.coordinates
    ? { name: profile.location, ...profile.coordinates }
    : await resolveLocation(profile.location, fetchImpl);
  const air = await fetchAir(location, fetchImpl);
  return { location, air: { ...air, source: 'open-meteo' } };
}

/**
 * Generates plan content via generative LLM if enabled, falling back to the deterministic
 * rule engine on any error, refusal, timeout, or safety guardrail violation.
 *
 * @param {object} ctx - Planning context.
 * @param {{generate: Function, llmEnabled: boolean}} options
 * @returns {Promise<{plan: object, source: 'claude'|'rules', notice: string|null}>}
 */
async function writePlan(ctx, { generate, llmEnabled }) {
  if (!llmEnabled) return { plan: buildRulePlan(ctx), source: 'rules', notice: null };
  let plan;
  try {
    plan = PlanSchema.parse(await generate(ctx));
  } catch (error) {
    // Log only safe error metadata: never the user profile or the raw prompt content.
    console.error('LLM plan failed, using rule engine:', error?.name, error?.status ?? '');
    return {
      plan: buildRulePlan(ctx),
      source: 'rules',
      notice: 'The AI service is unavailable right now, so this plan uses our built-in guidance.',
    };
  }
  const violation = findSafetyViolation(plan, ctx);
  if (violation) {
    console.error('LLM plan failed a safety check, using rule engine:', violation);
    return {
      plan: buildRulePlan(ctx),
      source: 'rules',
      notice: 'The AI-written plan did not pass our safety checks, so this plan uses our built-in guidance.',
    };
  }
  return { plan, source: 'claude', notice: null };
}

/** Determines if the user submitted personalized household answers rather than accepting defaults. */
const isPersonalised = (input) => ['household', 'commute', 'home'].some((key) => input?.[key] !== undefined);

/**
 * Orchestrates plan creation from raw request payload through final verified response.
 *
 * @param {unknown} input - Raw untrusted request body.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   generate?: Function,
 *   llmEnabled?: boolean
 * }} [deps] - Dependency injection overrides for testing.
 * @returns {Promise<object>} Complete plan payload with air, forecast, impact, and routine.
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
