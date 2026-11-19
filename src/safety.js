/**
 * Safety rules shared by the rule engine and the Claude path.
 * The rule engine follows them by construction; Claude is told them, and any Claude plan
 * that breaks one is replaced by the rule engine's plan.
 */
import { outdoorGuidance } from './aqi.js';

/** Walking and cycling mean heavy breathing outdoors, so they are never suggested on "avoid" days. */
const ACTIVE_MODES = new Set(['bike', 'walk']);

/** Commute alternatives that are safe to suggest today. */
export const suitableAlternatives = (alternatives, guidance) =>
  alternatives.filter((alt) => guidance !== 'avoid' || !ACTIVE_MODES.has(alt.mode));

/**
 * A relatively cleaner window can still be unhealthy. Judge it by its worst hour, not its average,
 * so play is never suggested while any part of the window is at an "avoid" level.
 */
export const isWindowUnsafe = (window, sensitive) =>
  Boolean(window) && outdoorGuidance(window.peakAqi, { sensitive }) === 'avoid';

const ACTIVE_WORDS = 'walk|walks|walking|cycle|cycles|cycling|bike|bikes|biking|bicycle|bicycles|bicycling';
const ACTIVE_TRAVEL = new RegExp(`\\b(${ACTIVE_WORDS})\\b`, 'i');
/** Running as exercise only: "the school run" is an errand, not a workout. */
const PLAY_OR_EXERCISE = /\b(play|playing|playground|exercise|sport|sports|go for a run|running|jog|jogging|PE)\b/i;
const KEPT_INSIDE = /\b(indoors?|inside|at home)\b/i;
/** A clause that rules an activity out rather than suggesting it. */
const RULED_OUT = /\b(avoid|skip|no|not|never|don't|do not|instead of|rather than|stop|cancel|postpone)\b/i;
const DAMPER_CLOSE = /\b(close|closing|shut|shutting)\b[^.;]*\bdamper\b|\bdamper\b[^.;]*\b(closed|shut)\b/i;
const DAMPER_KEEP_OPEN = /\b(keep|leave)\b[^.;]*\bdamper\b[^.;]*\bopen\b/i;
const FIRE_OUT = /\b(no fire is (lit|burning)|fire is (out|fully out)|not lit|unlit)\b/i;
const ASHES_COLD = /\b(ashes|embers)\b[^.;]*\bcold\b|\bcold\b[^.;]*\b(ashes|embers)\b/i;

const sentencesOf = (texts) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));
/**
 * Clauses are where a qualifier like "indoors" or "avoid" applies, so "play outside from 2 pm, and stay indoors
 * otherwise" is two clauses. A list such as "exercise, sport and playground time indoors" stays one.
 */
const clausesOf = (sentence) => sentence.split(/;|\bbut\b|\bthen\b|\botherwise\b|\bwhile\b|,\s*and\b/i);

/** Every string in the plan, so no field (headline, impact notes, benefits, medical text) escapes the check. */
const allTexts = (value) =>
  typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap((child) => allTexts(child));

/** True when a sentence refers to the hour `start` ("14:00"), written as 14:00, 2 pm, 2:00 p.m. or "2 to 4 pm". */
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

/** An activity is suggested outdoors when its clause neither keeps it inside nor rules it out. */
const suggestsOutdoor = (clause, activity) =>
  activity.test(clause) && !KEPT_INSIDE.test(clause) && !RULED_OUT.test(clause);
const suggestsActiveTravel = (clause) => ACTIVE_TRAVEL.test(clause) && !RULED_OUT.test(clause);

/** Closing a damper is only safe when the same clause requires the fire to be out and the ashes cold. */
const unsafeDamper = (clause) =>
  DAMPER_CLOSE.test(clause) && !DAMPER_KEEP_OPEN.test(clause) && !(FIRE_OUT.test(clause) && ASHES_COLD.test(clause));

/**
 * @param {object} plan a schema-valid plan
 * @param {{guidance: string, window: ?object, sensitive: boolean}} ctx
 * @returns {string|null} the broken rule, or null when the plan is safe
 */
export function findSafetyViolation(plan, { guidance, window, sensitive }) {
  const sentences = sentencesOf(allTexts(plan));
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
