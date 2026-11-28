/**
 * @fileoverview Safety guardrail verification system.
 *
 * Provides zero-trust validation of action plans. Generative AI outputs are strictly
 * audited against deterministic safety rules before delivery to users. If any violation
 * is detected, the LLM plan is rejected and replaced by the deterministic rule engine.
 *
 * Core Safety Invariants:
 * 1. No Active Travel on Avoid Days: Strenuous exertion (cycling, running, walking long distances)
 *    significantly increases respiratory minute volume, driving fine particulate matter (PM2.5)
 *    deep into bronchial and alveolar tissue.
 * 2. No Outdoor Play/Exercise in Unsafe Windows: Even if an interval represents the "cleanest"
 *    hours of a day, if its peak pollution exceeds safe thresholds, outdoor play and workouts
 *    must not be encouraged.
 * 3. Carbon Monoxide Damper Invariant: Closing a chimney or stove damper while a fire is lit
 *    or embers are hot traps combustion gases (specifically carbon monoxide, CO), creating an
 *    acute, lethal asphyxiation hazard.
 */
import { outdoorGuidance } from './aqi.js';

/**
 * Walking and cycling involve elevated respiratory rates outdoors.
 * On high-smog 'avoid' days, these modes are excluded from transit swaps.
 */
const ACTIVE_MODES = new Set(['bike', 'walk']);

/**
 * Filters commute alternatives to those deemed safe under current atmospheric conditions.
 *
 * @param {Array<{mode: string, savedKgPerWeek: number, savedKgPerWinter: number}>} alternatives - Feasible modes.
 * @param {'normal'|'limit'|'avoid'} guidance - Current outdoor activity guidance level.
 * @returns {Array<{mode: string, savedKgPerWeek: number, savedKgPerWinter: number}>}
 */
export const suitableAlternatives = (alternatives, guidance) =>
  alternatives.filter((alt) => guidance !== 'avoid' || !ACTIVE_MODES.has(alt.mode));

/**
 * Determines whether a forecast window is unsafe for outdoor physical activity.
 *
 * Evaluates the window's *peak* (worst) AQI rather than its average, preventing
 * temporary dips in pollution from masking dangerous exposure spikes.
 *
 * @param {{peakAqi: number}|null} window - Forecast cleanest window.
 * @param {boolean} sensitive - Household vulnerability flag.
 * @returns {boolean} True if outdoor play or exercise in this window is unsafe.
 */
export const isWindowUnsafe = (window, sensitive) =>
  Boolean(window) && outdoorGuidance(window.peakAqi, { sensitive }) === 'avoid';

const ACTIVE_WORDS = 'walk|walks|walking|cycle|cycles|cycling|bike|bikes|biking|bicycle|bicycles|bicycling';
const ACTIVE_TRAVEL = new RegExp(`\\b(${ACTIVE_WORDS})\\b`, 'i');

/** Matches recreational workouts and play (distinguishing workout runs from 'the school run'). */
const PLAY_OR_EXERCISE = /\b(play|playing|playground|exercise|sport|sports|go for a run|running|jog|jogging|PE)\b/i;
const KEPT_INSIDE = /\b(indoors?|inside|at home)\b/i;

/** Negation tokens that invert the recommendation of following action phrases. */
const NEGATIONS = new Set(['avoid', 'skip', 'no', 'not', "don't", 'don’t', 'never', 'stop', 'cancel', 'postpone']);
const PHRASE_NEGATIONS = { not: 'do', of: 'instead', than: 'rather' };

/** Syntactic filler words permitted between a negation token and an activity noun/verb. */
const FILLER = new Set([
  'or',
  'and',
  'nor',
  'any',
  'the',
  'a',
  'heavy',
  'strenuous',
  'long',
  'outdoor',
  'outdoors',
  'outside',
  'today',
]);

const DAMPER_CLOSE = /\b(close|closing|shut|shutting)\b[^.;]*\bdamper\b|\bdamper\b[^.;]*\b(closed|shut)\b/i;
const DAMPER_KEEP_OPEN = /\b(keep|leave)\b[^.;]*\bdamper\b[^.;]*\bopen\b/i;
const FIRE_OUT = /\b(no fire is (lit|burning)|fire is (out|fully out)|not lit|unlit)\b/i;
const ASHES_COLD = /\b(ashes|embers)\b[^.;]*\bcold\b|\bcold\b[^.;]*\b(ashes|embers)\b/i;

/**
 * Normalizes punctuation and splits text into discrete sentences.
 * Handles "a.m."/"p.m." so abbreviations do not break sentences prematurely.
 *
 * @param {string[]} texts - Array of text segments.
 * @returns {string[]} Individual normalized sentences.
 */
const sentencesOf = (texts) =>
  texts.flatMap((text) =>
    text
      .replace(/\b([apAP])\.[mM]\.(?!\s+[A-Z])/g, '$1m')
      .replace(/\b([ap])\.m\./gi, '$1m.')
      .split(/(?<=[.!?])\s+/),
  );

/**
 * Decomposes sentences into logical clauses at coordinating conjunctions and semicolons.
 * Allows assessing qualifiers (e.g. "indoors") within their specific clause scope.
 *
 * @param {string} sentence - Target sentence.
 * @returns {string[]} Component clauses.
 */
const clausesOf = (sentence) => sentence.split(/;|\bbut\b|\bthen\b|\botherwise\b|\bwhile\b|,\s*and\b/i);

/**
 * Recursively extracts every leaf string value from an arbitrary nested object.
 *
 * @param {unknown} value - Object or string.
 * @returns {string[]} Flat array of all contained text.
 */
const allTexts = (value) =>
  typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap((child) => allTexts(child));

/**
 * Checks if a sentence references a specific hour (e.g. "14:00", "2 pm", "2:00 p.m.", "2 to 4 pm").
 *
 * @param {string} sentence - Candidate sentence.
 * @param {string} start - Target hour string formatted as "HH:00".
 * @returns {boolean}
 */
function mentionsHour(sentence, start) {
  const hour = Number(start.slice(0, 2));
  const h12 = hour % 12 || 12;
  const suffix = hour < 12 ? '(am|a\\.m\\.)' : '(pm|p\\.m\\.)';
  const patterns = [
    `\\b0?${hour}[:.]00\\b`,
    `\\b${h12}([:.]00)?\\s?${suffix}`,
    `\\b${h12}([:.]00)?\\s*(-|–|to|and|until)\\s*\\d{1,2}([:.]00)?\\s?${suffix}`,
  ];
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(sentence));
}

const isFiller = (word, activity) => FILLER.has(word) || new RegExp(`^(${activity.source})$`, 'i').test(word);

/**
 * Backtracks from an activity mention over filler words to count preceding negation tokens.
 * Odd count = negated/prohibited; Even count = affirmative.
 *
 * @param {string} before - Text preceding the matched activity.
 * @param {RegExp} activity - Activity regex pattern.
 * @returns {boolean} True if the activity is explicitly negated.
 */
function isNegated(before, activity) {
  const words = before
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\w’']+|[^\w’']+$/g, ''))
    .filter(Boolean);
  let i = words.length - 1;
  while (i >= 0 && isFiller(words[i], activity)) i -= 1;
  let negations = 0;
  while (i >= 0) {
    if (PHRASE_NEGATIONS[words[i]] && words[i - 1] === PHRASE_NEGATIONS[words[i]]) i -= 2;
    else if (NEGATIONS.has(words[i])) i -= 1;
    else break;
    negations += 1;
  }
  return negations % 2 === 1;
}

/** Evaluates whether an activity regex match is stated affirmatively (without negation). */
function mentionsWithoutNegation(clause, activity) {
  const every = new RegExp(activity.source, 'gi');
  return [...clause.matchAll(every)].some((match) => !isNegated(clause.slice(0, match.index), activity));
}

/** Determines if a clause recommends an activity outdoors. */
const suggestsOutdoor = (clause, activity) => !KEPT_INSIDE.test(clause) && mentionsWithoutNegation(clause, activity);
const suggestsActiveTravel = (clause) => mentionsWithoutNegation(clause, ACTIVE_TRAVEL);

/** Identifies dangerous damper advice (closing a damper without ensuring fire is out and ashes cold). */
const unsafeDamper = (clause) =>
  DAMPER_CLOSE.test(clause) && !DAMPER_KEEP_OPEN.test(clause) && !(FIRE_OUT.test(clause) && ASHES_COLD.test(clause));

/**
 * Evaluates an array of text segments against all health & safety invariant rules.
 *
 * @param {string[]} texts - Untrusted plan or chat reply text segments.
 * @param {{
 *   guidance: 'normal'|'limit'|'avoid',
 *   window: object|null,
 *   sensitive: boolean
 * }} ctx - Atmospheric context.
 * @returns {string|null} Error code of broken invariant, or null if all texts are safe.
 */
function findSafetyViolationInTexts(texts, { guidance, window, sensitive }) {
  const sentences = sentencesOf(texts);
  const clauses = sentences.flatMap(clausesOf);

  if (guidance === 'avoid' && clauses.some(suggestsActiveTravel)) return 'active_travel_on_avoid_day';
  if (guidance === 'avoid' && clauses.some((c) => suggestsOutdoor(c, PLAY_OR_EXERCISE))) {
    return 'outdoor_play_on_avoid_day';
  }
  if (isWindowUnsafe(window, sensitive)) {
    const inWindow = sentences.filter((s) => mentionsHour(s, window.start)).flatMap(clausesOf);
    if (inWindow.some((c) => suggestsOutdoor(c, PLAY_OR_EXERCISE))) return 'outdoor_play_in_unsafe_window';
  }
  if (clauses.some(unsafeDamper)) return 'unsafe_damper_advice';
  return null;
}

/**
 * Evaluates an entire action plan against all health & safety invariant rules.
 *
 * @param {object} plan - Proposed plan object conforming to PlanSchema.
 * @param {{
 *   guidance: 'normal'|'limit'|'avoid',
 *   window: object|null,
 *   sensitive: boolean
 * }} ctx - Atmospheric context.
 * @returns {string|null} Error code of broken invariant, or null if plan is completely safe.
 */
export function findSafetyViolation(plan, ctx) {
  return findSafetyViolationInTexts(allTexts(plan), ctx);
}

/**
 * Evaluates a single free-form reply string (e.g. from follow-up chat) against safety invariants.
 *
 * @param {string} text - Assistant reply text.
 * @param {{ guidance: 'normal'|'limit'|'avoid', window: object|null, sensitive: boolean }} ctx
 * @returns {string|null} Error code of broken invariant, or null if safe.
 */
export const findTextSafetyViolation = (text, ctx) => findSafetyViolationInTexts([text], ctx);
