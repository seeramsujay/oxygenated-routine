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
