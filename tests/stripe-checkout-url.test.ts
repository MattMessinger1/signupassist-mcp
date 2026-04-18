import { describe, expect, it } from 'vitest';
import { normalizeStripeRedirectUrl } from '../mcp_server/lib/stripeCheckout.js';

describe('normalizeStripeRedirectUrl', () => {
  const fallback = 'https://signupassist.shipworx.ai/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}';

  it('keeps valid HTTPS Stripe return URLs', () => {
    expect(normalizeStripeRedirectUrl(
      'https://signupassist.shipworx.ai/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}',
      fallback,
    )).toBe('https://signupassist.shipworx.ai/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}');
  });

  it('allows localhost HTTP for local development only', () => {
    expect(normalizeStripeRedirectUrl(
      'http://localhost:5173/stripe_return?payment_setup=canceled',
      fallback,
    )).toBe('http://localhost:5173/stripe_return?payment_setup=canceled');
  });

  it('rejects unsafe protocols', () => {
    expect(normalizeStripeRedirectUrl('javascript:alert(1)', fallback)).toBe(fallback);
    expect(normalizeStripeRedirectUrl('data:text/html,hi', fallback)).toBe(fallback);
    expect(normalizeStripeRedirectUrl('ftp://example.com/stripe_return', fallback)).toBe(fallback);
  });

  it('rejects invalid URLs', () => {
    expect(normalizeStripeRedirectUrl('not a url', fallback)).toBe(fallback);
    expect(normalizeStripeRedirectUrl(undefined, fallback)).toBe(fallback);
  });
});
