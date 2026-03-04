import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeRateLimit, getStableRateLimitKey, resetRateLimitBuckets } from '../mcp_server/lib/rateLimit.js';

test('allows request under threshold', () => {
  resetRateLimitBuckets();
  const result = consumeRateLimit('user:a:chat', 2, 60_000);
  assert.equal(result.allowed, true);
  assert.equal(result.retryAfterSec, 0);
});

test('returns 429 semantics when exceeding threshold', () => {
  resetRateLimitBuckets();
  consumeRateLimit('user:a:chat', 1, 60_000);
  const result = consumeRateLimit('user:a:chat', 1, 60_000);
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSec >= 1);
});

test('tracks independent counters for separate users', () => {
  resetRateLimitBuckets();
  const userA = consumeRateLimit('user:a:chat', 1, 60_000);
  const userASecond = consumeRateLimit('user:a:chat', 1, 60_000);
  const userB = consumeRateLimit('user:b:chat', 1, 60_000);

  assert.equal(userA.allowed, true);
  assert.equal(userASecond.allowed, false);
  assert.equal(userB.allowed, true);
});

test('uses stable identifier from JWT sub when available', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|abc123' })).toString('base64url');
  const token = `header.${payload}.sig`;
  const req: any = { headers: { authorization: `Bearer ${token}` }, socket: {} };
  const key = getStableRateLimitKey(req);
  assert.match(key, /^uid_/);
});
