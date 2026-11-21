import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from '../src/rateLimit.js';

test('allows up to max requests per window, per key', () => {
  const limit = createRateLimiter({ windowMs: 1000, max: 2, now: () => 0 });
  assert.equal(limit('a').allowed, true);
  assert.equal(limit('a').allowed, true);
  assert.equal(limit('a').allowed, false);
  assert.equal(limit('b').allowed, true);
});

test('the window resets and retry-after is reported', () => {
  let time = 0;
  const limit = createRateLimiter({ windowMs: 1000, max: 1, now: () => time });
  limit('a');
  time = 400;
  assert.deepEqual(limit('a'), { allowed: false, retryAfterSeconds: 1 });
  time = 1000;
  assert.equal(limit('a').allowed, true);
});

test('expired entries are swept when the table grows', () => {
  let time = 0;
  const limit = createRateLimiter({ windowMs: 10, max: 1, now: () => time });
  for (let i = 0; i < 1100; i++) limit(`ip-${i}`);
  time = 100;
  assert.equal(limit('fresh').allowed, true);
});

test('a full table of live entries is not rescanned on every request', () => {
  let time = 0;
  const limit = createRateLimiter({ windowMs: 1000, max: 1, now: () => time });
  for (let i = 0; i < 1100; i++) limit(`ip-${i}`);
  const started = performance.now();
  for (let i = 0; i < 2000; i++) limit(`more-${i}`);
  assert.ok(performance.now() - started < 200, 'insertions stay cheap while entries are unexpired');
  // Counters for live clients survive any sweep.
  assert.equal(limit('ip-0').allowed, false);
  time = 2000;
  assert.equal(limit('ip-0').allowed, true);
});

test('blocked requests do not extend the fixed window and retry-after rounds up', () => {
  let time = 0;
  const limit = createRateLimiter({ windowMs: 2500, max: 1, now: () => time });
  assert.deepEqual(limit('client'), { allowed: true, retryAfterSeconds: 3 });
  time = 1499;
  assert.deepEqual(limit('client'), { allowed: false, retryAfterSeconds: 2 });
  time = 2499;
  assert.deepEqual(limit('client'), { allowed: false, retryAfterSeconds: 1 });
  time = 2500;
  assert.deepEqual(limit('client'), { allowed: true, retryAfterSeconds: 3 });
});

test('clients have independent reset times', () => {
  let time = 0;
  const limit = createRateLimiter({ windowMs: 1000, max: 1, now: () => time });
  limit('first');
  time = 500;
  limit('second');
  time = 1000;
  assert.equal(limit('first').allowed, true);
  assert.equal(limit('second').allowed, false);
  time = 1500;
  assert.equal(limit('second').allowed, true);
});
