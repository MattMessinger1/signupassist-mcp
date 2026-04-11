import { describe, expect, it, vi } from 'vitest';
import {
  normalizeSuccessFeeRefundReason,
  refundSuccessFeeWithGuard,
} from './refundGuard.js';

type ChargeFixture = {
  id: string;
  stripe_payment_intent: string | null;
  status: string;
  refunded_at: string | null;
  amount_cents: number | null;
  charged_at: string;
};

function recentCharge(overrides: Partial<ChargeFixture> = {}): ChargeFixture {
  return {
    id: 'charge_123',
    stripe_payment_intent: 'pi_123',
    status: 'succeeded',
    refunded_at: null,
    amount_cents: 2000,
    charged_at: new Date().toISOString(),
    ...overrides,
  };
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function makeSupabase(
  charge: ChargeFixture | null,
  invokeResult: {
    data: Record<string, unknown> | null;
    error: { message?: string } | null;
  } = {
    data: {
      success: true,
      refund_id: 're_123',
      refund_status: 'succeeded',
      amount_refunded_cents: 2000,
    },
    error: null,
  },
) {
  const single = vi.fn().mockResolvedValue({ data: charge, error: charge ? null : { message: 'not found' } });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const invoke = vi.fn().mockResolvedValue(invokeResult);

  return {
    supabase: {
      from,
      functions: { invoke },
    },
    from,
    select,
    eq,
    single,
    invoke,
  };
}

describe('refundSuccessFeeWithGuard', () => {
  it('approves a recent success-fee refund and calls the edge function with the validated amount', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge());

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'booking_cancelled',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      refund_id: 're_123',
      amount_refunded_cents: 2000,
      charge_id: 'charge_123',
      refund_reason: 'booking_cancelled',
      stripe_reason: 'requested_by_customer',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('stripe-refund-success-fee', {
      body: {
        charge_id: 'charge_123',
        amount_cents: 2000,
        reason: 'booking_cancelled',
        stripe_reason: 'requested_by_customer',
      },
    });
  });

  it('denies an already-refunded charge before invoking the provider', async () => {
    const { supabase, invoke } = makeSupabase(
      recentCharge({ refunded_at: new Date().toISOString() }),
    );

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'booking_cancelled',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'REFUND_GUARD_DENIED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('denies a charge outside the 90-day success-fee refund window before invoking the provider', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge({ charged_at: daysAgo(91) }));

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'booking_cancelled',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'REFUND_GUARD_DENIED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('denies invalid charge amounts before invoking the provider', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge({ amount_cents: 0 }));

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'booking_cancelled',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'REFUND_GUARD_DENIED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps duplicate charge business reasons to Stripe duplicate refunds', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge());

    await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'duplicate_charge',
    });

    expect(invoke).toHaveBeenCalledWith('stripe-refund-success-fee', {
      body: expect.objectContaining({
        reason: 'duplicate_charge',
        stripe_reason: 'duplicate',
      }),
    });
  });

  it('maps requested customer reasons to Stripe requested_by_customer refunds', async () => {
    expect(normalizeSuccessFeeRefundReason('requested_by_customer')).toEqual({
      businessReason: 'requested_by_customer',
      stripeReason: 'requested_by_customer',
    });
    expect(normalizeSuccessFeeRefundReason('user_requested')).toEqual({
      businessReason: 'requested_by_customer',
      stripeReason: 'requested_by_customer',
    });
    expect(normalizeSuccessFeeRefundReason('booking_cancelled')).toEqual({
      businessReason: 'booking_cancelled',
      stripeReason: 'requested_by_customer',
    });
  });

  it('denies unsupported arbitrary refund reasons before invoking the provider', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge());

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'my child got sick',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'REFUND_GUARD_DENIED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns a parent-friendly processing error when the edge refund fails', async () => {
    const { supabase, invoke } = makeSupabase(recentCharge(), {
      data: { success: false, error: 'Stripe refused the refund' },
      error: null,
    });

    const result = await refundSuccessFeeWithGuard({
      supabase,
      chargeId: 'charge_123',
      reason: 'booking_cancelled',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'STRIPE_API_ERROR',
      display: 'Refund processing error',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
