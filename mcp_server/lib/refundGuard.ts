import { Refunds, DENIAL_MESSAGES } from '@mattmessinger/refund-guard';
import type { ParentFriendlyError, ProviderResponse } from '../types.js';
import { formatCurrencyFromCents } from '../utils/money.js';

export const SUCCESS_FEE_REFUND_BUSINESS_REASONS = [
  'booking_cancelled',
  'requested_by_customer',
  'duplicate_charge',
  'technical_error',
] as const;

export const SUCCESS_FEE_REFUND_INPUT_REASONS = [
  ...SUCCESS_FEE_REFUND_BUSINESS_REASONS,
  'user_requested',
  'provider_cancelled',
  'duplicate',
] as const;

export type SuccessFeeRefundBusinessReason =
  (typeof SUCCESS_FEE_REFUND_BUSINESS_REASONS)[number];

export type StripeRefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';

export type SuccessFeeRefundData = {
  refund_id: string;
  refund_status?: string;
  amount_refunded_cents: number;
  charge_id: string;
  refund_reason: SuccessFeeRefundBusinessReason;
  stripe_reason: StripeRefundReason;
};

type ChargeRecord = {
  id: string;
  stripe_payment_intent: string | null;
  status?: string | null;
  refunded_at: string | null;
  amount_cents: number | null;
  charged_at: string;
};

export type SupabaseRefundClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        single: () => PromiseLike<{ data: ChargeRecord | null; error: unknown }>;
      };
    };
  };
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, unknown> },
    ) => PromiseLike<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
  };
};

type NormalizedRefundReason = {
  businessReason: SuccessFeeRefundBusinessReason;
  stripeReason: StripeRefundReason;
};

type SuccessFeeRefundInput = {
  supabase: SupabaseRefundClient;
  chargeId: string;
  reason?: string;
};

const DEFAULT_SUCCESS_FEE_CENTS = 2000;

export const SUCCESS_FEE_DENIAL_MESSAGES: Record<string, string> = {
  ...DENIAL_MESSAGES,
  refund_reason_not_allowed: 'This refund reason is not allowed for this item.',
};

export const refundGuard = new Refunds({
  skus: {
    success_fee: {
      refund_window_days: 90,
      allowed_reasons: [...SUCCESS_FEE_REFUND_BUSINESS_REASONS],
    },
  },
});

export { DENIAL_MESSAGES };

export function normalizeSuccessFeeRefundReason(
  reason?: string,
): NormalizedRefundReason | null {
  const normalized = (reason ?? 'requested_by_customer').trim().toLowerCase();

  if (!normalized || normalized === 'requested_by_customer' || normalized === 'user_requested') {
    return {
      businessReason: 'requested_by_customer',
      stripeReason: 'requested_by_customer',
    };
  }

  if (normalized === 'booking_cancelled' || normalized === 'provider_cancelled') {
    return {
      businessReason: 'booking_cancelled',
      stripeReason: 'requested_by_customer',
    };
  }

  if (normalized === 'duplicate_charge' || normalized === 'duplicate') {
    return {
      businessReason: 'duplicate_charge',
      stripeReason: 'duplicate',
    };
  }

  if (normalized === 'technical_error') {
    return {
      businessReason: 'technical_error',
      stripeReason: 'requested_by_customer',
    };
  }

  return null;
}

export async function refundSuccessFeeWithGuard({
  supabase,
  chargeId,
  reason,
}: SuccessFeeRefundInput): Promise<ProviderResponse<SuccessFeeRefundData>> {
  if (!chargeId) {
    return {
      success: false,
      error: {
        display: 'Unable to process refund',
        recovery: 'Missing charge information. Please contact support.',
        severity: 'medium',
        code: 'STRIPE_MISSING_CHARGE_ID',
      } satisfies ParentFriendlyError,
    };
  }

  try {
    const { data: charge, error: chargeError } = await supabase
      .from('charges')
      .select('id, stripe_payment_intent, status, refunded_at, amount_cents, charged_at')
      .eq('id', chargeId)
      .single();

    if (chargeError || !charge) {
      return {
        success: false,
        error: {
          display: 'Charge not found',
          recovery: 'The charge record could not be located. Please contact support.',
          severity: 'medium',
          code: 'STRIPE_CHARGE_NOT_FOUND',
        } satisfies ParentFriendlyError,
      };
    }

    const parsedReason = normalizeSuccessFeeRefundReason(reason);
    if (!parsedReason) {
      return refundDenied('refund_reason_not_allowed');
    }

    const amountPaidMinorUnits = charge.amount_cents ?? DEFAULT_SUCCESS_FEE_CENTS;

    if (!Number.isFinite(amountPaidMinorUnits) || amountPaidMinorUnits <= 0) {
      return refundDenied('invalid_amount');
    }

    const refund = refundGuard.makeRefundTool({
      sku: 'success_fee',
      transactionId: charge.stripe_payment_intent ?? chargeId,
      amountPaidMinorUnits,
      purchasedAt: new Date(charge.charged_at),
      refundedAt: charge.refunded_at ? new Date(charge.refunded_at) : null,
      provider: 'stripe',
      providerRefundFn: async (amount) => {
        const amountCents = Math.round(amount * 100);
        const { data, error } = await supabase.functions.invoke(
          'stripe-refund-success-fee',
          {
            body: {
              charge_id: chargeId,
              amount_cents: amountCents,
              reason: parsedReason.businessReason,
              stripe_reason: parsedReason.stripeReason,
            },
          },
        );

        if (error) throw new Error(error.message ?? 'Edge function error');
        if (!data?.success) throw new Error(String(data?.error ?? 'Refund failed'));
        return data;
      },
    });

    const result = await refund(undefined, { reason: parsedReason.businessReason });

    if (result.status === 'denied') {
      return refundDenied(result.reason as string);
    }

    if (result.status === 'error') {
      return refundProcessingError();
    }

    const providerData = result.provider_result as Record<string, unknown> | undefined;
    const amountRefundedCents = Number(
      providerData?.amount_refunded_cents ?? charge.amount_cents ?? DEFAULT_SUCCESS_FEE_CENTS,
    );
    const refundId = String(providerData?.refund_id ?? 'unknown');

    return {
      success: true,
      data: {
        refund_id: refundId,
        refund_status:
          typeof providerData?.refund_status === 'string'
            ? providerData.refund_status
            : undefined,
        amount_refunded_cents: amountRefundedCents,
        charge_id: chargeId,
        refund_reason: parsedReason.businessReason,
        stripe_reason: parsedReason.stripeReason,
      },
      ui: {
        cards: [
          {
            title: 'Refund Processed',
            description: `${formatCurrencyFromCents(amountRefundedCents)} SignupAssist fee refunded successfully`,
          },
        ],
      },
    };
  } catch {
    return refundProcessingError();
  }
}

function refundDenied(reason: string): ProviderResponse<SuccessFeeRefundData> {
  return {
    success: false,
    error: {
      display: 'Refund not allowed',
      recovery: SUCCESS_FEE_DENIAL_MESSAGES[reason] ?? 'Please contact support.',
      severity: 'medium',
      code: 'REFUND_GUARD_DENIED',
    } satisfies ParentFriendlyError,
  };
}

function refundProcessingError(): ProviderResponse<SuccessFeeRefundData> {
  return {
    success: false,
    error: {
      display: 'Refund processing error',
      recovery: 'Please contact support if you don\'t see your refund within 5-10 business days.',
      severity: 'medium',
      code: 'STRIPE_API_ERROR',
    } satisfies ParentFriendlyError,
  };
}
