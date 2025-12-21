/**
 * Fee Calculation Logic
 * Pure functions for service fee and total calculations
 */

export const FEE_CONFIG = {
  /** Minimum service fee in cents ($1.99) */
  serviceMinCents: 199,
  /** Maximum service fee in cents ($9.99) */
  serviceMaxCents: 999,
  /** Default service fee percentage */
  defaultPercentage: 5,
} as const;

/**
 * Calculate service fee based on program fee
 * Applies min/max caps: $1.99 minimum, $9.99 maximum
 */
export function calculateServiceFee(
  programFeeCents: number,
  percentage = FEE_CONFIG.defaultPercentage
): number {
  const calculated = Math.round(programFeeCents * (percentage / 100));
  return Math.max(FEE_CONFIG.serviceMinCents, Math.min(calculated, FEE_CONFIG.serviceMaxCents));
}

/**
 * Calculate total cost (program fee + service fee)
 */
export function calculateTotal(programFeeCents: number, serviceFeeCents: number): number {
  return programFeeCents + serviceFeeCents;
}

/**
 * Check if program has a fee that would require payment
 */
export function hasProgramFee(priceCents?: number): boolean {
  return typeof priceCents === 'number' && priceCents > 0;
}
