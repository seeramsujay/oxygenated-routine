/** Fixed-window, in-memory rate limiter (per process; fine for a single-instance app). */

const SWEEP_THRESHOLD = 1000;

/**
 * @param {{windowMs:number, max:number, now?:() => number}} options
 * @returns {(key:string) => {allowed:boolean, retryAfterSeconds:number}}
 */
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const windows = new Map();
  let nextSweepAt = 0;

  const sweep = (time) => {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= time) windows.delete(key);
    }
  };

  return (key) => {
    const time = now();
    // Sweep at most once per window so a map full of live entries is not rescanned on every request.
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
