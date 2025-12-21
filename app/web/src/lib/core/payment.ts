/**
 * Payment Flow Configuration and State Management
 * Pure constants and type definitions for payment processing
 */

export const PAYMENT_CONFIG = {
  /** Interval between payment status checks (ms) */
  pollIntervalMs: 3000,
  /** Maximum number of poll attempts before timeout (~3 minutes) */
  maxPollAttempts: 60,
  /** Delay before transitioning after success (ms) */
  successDelayMs: 1500,
  /** Stripe session expiry duration (minutes) */
  sessionExpiryMinutes: 30,
} as const;

export type PaymentStatus = 'idle' | 'loading' | 'polling' | 'success' | 'error' | 'timeout';

export interface PaymentState {
  status: PaymentStatus;
  stripeUrl: string | null;
  errorMessage: string | null;
  pollCount: number;
}

/**
 * Create initial payment state
 */
export function createInitialPaymentState(): PaymentState {
  return {
    status: 'idle',
    stripeUrl: null,
    errorMessage: null,
    pollCount: 0,
  };
}

/**
 * Check if polling should continue
 */
export function shouldContinuePolling(state: PaymentState): boolean {
  return state.status === 'polling' && state.pollCount < PAYMENT_CONFIG.maxPollAttempts;
}

/**
 * Check if payment is in a terminal state
 */
export function isPaymentTerminal(status: PaymentStatus): boolean {
  return status === 'success' || status === 'error' || status === 'timeout';
}

/**
 * Get user-friendly message for payment status
 */
export function getPaymentStatusMessage(status: PaymentStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready to setup payment';
    case 'loading':
      return 'Loading...';
    case 'polling':
      return 'Waiting for payment confirmation...';
    case 'success':
      return 'Payment verified!';
    case 'error':
      return 'Payment failed';
    case 'timeout':
      return 'Payment verification timed out';
    default:
      return '';
  }
}
