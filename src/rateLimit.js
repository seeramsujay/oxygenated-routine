/**
 * @fileoverview In-memory fixed-window rate limiter.
 *
 * Implements lightweight, per-process sliding memory management with periodic sweeping
 * to prune expired IP tracking entries. Protects upstream APIs (Open-Meteo geocoding and air data)
 * and LLM inference endpoints from abuse or accidental request flooding.
 */

/** Number of tracked entries before triggering an automated expiration sweep. */
const SWEEP_THRESHOLD = 1000;

/**
 * Creates a rate limiter instance for a specific route or operation.
 *
 * @param {{
 *   windowMs: number,
 *   max: number,
 *   now?: () => number
 * }} options - Configuration containing window duration in ms, max allowed hits, and clock source.
 * @returns {(key: string) => { allowed: boolean, retryAfterSeconds: number }} Rate limit evaluator.
 */
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const windows = new Map();
  let nextSweepAt = 0;

  /** Removes expired window entries to prevent memory leaks during traffic surges. */
  const sweep = (time) => {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= time) windows.delete(key);
    }
  };

  return (key) => {
    const time = now();
    // Sweep at most once per window interval when map exceeds threshold to avoid rescanning on every request.
    if (windows.size > SWEEP_THRESHOLD && time >= nextSweepAt) {
      sweep(time);
      nextSweepAt = time + windowMs;
    }

    let entry = windows.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= max,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
    };
  };
}
