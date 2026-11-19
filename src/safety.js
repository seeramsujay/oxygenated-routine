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

const ACTIVE_TRAVEL = /\b(walk|walks|walking|cycle|cycles|cycling|bike|bikes|biking)\b/i;
/** Phrases that mention walking or cycling only to rule them out. */
const NEGATED_ACTIVE_TRAVEL =
  /\b(instead of|rather than|avoid|skip|no|not|never|don't|do not)\s+(walk|walking|cycle|cycling|bike|biking)(\s+(or|and)\s+(walk|walking|cycle|cycling|bike|biking))?\b/gi;
/** Running as exercise only: "the school run" is an errand, not a workout. */
const PLAY_OR_EXERCISE = /\b(play|playing|playground|exercise|sport|sports|go for a run|running|jog|jogging|PE)\b/i;
const KEPT_INDOORS = /\bindoors?\b/i;
const DAMPER = /\bdamper\b/i;
const DAMPER_SAFE = /\bcold\b|\bno fire\b|\bfire is out\b|\bkeep\b[^.]*\bdamper\b[^.]*\bopen\b/i;

const sentencesOf = (texts) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));

/** Every piece of advice text in a plan. */
function adviceTexts(plan) {
  return [
    ...plan.top_actions,
    ...plan.daily_routine.flatMap((item) => [item.action, item.why]),
    ...plan.indoor_air_hacks.flatMap((hack) => [hack.title, ...hack.steps]),
    ...plan.sustainable_alternatives.map((swap) => swap.swap),
    ...plan.community_actions,
    ...plan.protect_vulnerable_members,
  ];
}

/**
 * @param {object} plan a schema-valid plan
 * @param {{guidance: string, window: ?object, sensitive: boolean}} ctx
 * @returns {string|null} the broken rule, or null when the plan is safe
 */
export function findSafetyViolation(plan, { guidance, window, sensitive }) {
  const sentences = sentencesOf(adviceTexts(plan));

  if (guidance === 'avoid') {
    const suggestsActiveTravel = sentences.some((s) => ACTIVE_TRAVEL.test(s.replace(NEGATED_ACTIVE_TRAVEL, '')));
    if (suggestsActiveTravel) return 'active_travel_on_avoid_day';
  }

  if (isWindowUnsafe(window, sensitive)) {
    const outdoorPlayInWindow = sentences.some(
      (s) => s.includes(window.start) && PLAY_OR_EXERCISE.test(s) && !KEPT_INDOORS.test(s),
    );
    if (outdoorPlayInWindow) return 'outdoor_play_in_unsafe_window';
  }

  if (sentences.some((s) => DAMPER.test(s) && !DAMPER_SAFE.test(s))) return 'unsafe_damper_advice';
  return null;
}
