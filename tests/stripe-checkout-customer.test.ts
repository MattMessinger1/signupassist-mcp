import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createHostedPaymentSetupSession customer recovery', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock('stripe');
  });

  it('replaces stale stored Stripe customers before creating checkout sessions', async () => {
    const upserts: unknown[] = [];
    const stripeMock = {
      customers: {
        retrieve: vi.fn(async () => {
          const error = new Error('No such customer');
          Object.assign(error, {
            code: 'resource_missing',
            param: 'customer',
          });
          throw error;
        }),
        list: vi.fn(async () => ({ data: [] })),
        create: vi.fn(async () => ({ id: 'cus_test_replacement' })),
      },
      checkout: {
        sessions: {
          create: vi.fn(async (input) => ({
            id: 'cs_test_123',
            url: `https://checkout.stripe.com/c/pay/${input.customer}`,
          })),
        },
      },
    };

    const StripeConstructor = vi.fn(function Stripe() {
      return stripeMock;
    });
    vi.doMock('stripe', () => ({
      default: StripeConstructor,
    }));
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_reviewer');
    vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'signupassist.shipworx.ai');

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { stripe_customer_id: 'cus_live_or_stale' },
              error: null,
            })),
          })),
        })),
        upsert: vi.fn(async (row) => {
          upserts.push(row);
          return { error: null };
        }),
      })),
    };

    const { createHostedPaymentSetupSession } = await import('../mcp_server/lib/stripeCheckout.js');
    const session = await createHostedPaymentSetupSession({
      supabase: supabase as never,
      userId: '63949f19-ed61-426b-bb54-7f5cea6ef198',
      userEmail: 'openai-reviewer@shipworx.ai',
    });

    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith('cus_live_or_stale');
    expect(stripeMock.customers.create).toHaveBeenCalledWith({
      email: 'openai-reviewer@shipworx.ai',
      metadata: { supabase_user_id: '63949f19-ed61-426b-bb54-7f5cea6ef198' },
    });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_test_replacement',
      mode: 'setup',
    }));
    expect(upserts).toEqual([
      expect.objectContaining({
        stripe_customer_id: 'cus_test_replacement',
        default_payment_method_id: null,
        payment_method_brand: null,
        payment_method_last4: null,
      }),
    ]);
    expect(session).toEqual(expect.objectContaining({
      customer_id: 'cus_test_replacement',
      session_id: 'cs_test_123',
      url: 'https://signupassist.shipworx.ai/stripe_checkout?session_id=cs_test_123',
    }));
  });
});
