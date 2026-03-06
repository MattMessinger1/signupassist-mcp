import { describe, expect, it } from 'vitest';
import { consumeRateLimit, getStableRateLimitKey } from '../mcp_server/lib/rateLimit';

describe('rateLimit helpers', () => {
  it('derives a stable token-based key from authorization header', () => {
    const key = getStableRateLimitKey({ headers: { authorization: 'Bearer abc123' } });
    expect(key).toMatch(/^tok_[a-f0-9]{16}$/);
  });

  it('falls back to IP-based key when no bearer token is present', () => {
    const key = getStableRateLimitKey({
      headers: { 'x-forwarded-for': '203.0.113.9, 70.1.2.3' },
      socket: { remoteAddress: '::ffff:10.0.0.1' },
    });
    expect(key).toBe('ip_203.0.113.9');
  });

  it('enforces max requests within a window', () => {
    const k = 'test-rate-limit-window';

    const a = consumeRateLimit(k, 2, 60_000);
    const b = consumeRateLimit(k, 2, 60_000);
    const c = consumeRateLimit(k, 2, 60_000);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.retryAfterSec).toBeGreaterThan(0);
  });
});
