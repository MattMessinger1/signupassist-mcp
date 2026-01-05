/**
 * money.ts
 * Shared money/currency formatting helpers for user-facing copy.
 *
 * Goal: consistent 2-decimal display for USD amounts (e.g. "$20.00").
 */

export function normalizeCurrencyCode(currency?: string | null): string {
  const c = String(currency || "USD").trim().toUpperCase();
  return c || "USD";
}

/**
 * Format a currency amount in major units (e.g., dollars for USD).
 *
 * Examples:
 * - formatCurrency(20, "USD") -> "$20.00"
 * - formatCurrency(40, "USD") -> "$40.00"
 */
export function formatCurrency(amount: number, currency?: string | null): string {
  const cur = normalizeCurrencyCode(currency);
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;

  try {
    // Force 2-decimal display for predictable UI copy (esp. USD).
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    const fixed = safe.toFixed(2);
    return cur === "USD" ? `$${fixed}` : `${cur} ${fixed}`;
  }
}

/**
 * Format a currency amount in minor units (cents).
 *
 * Example:
 * - formatCurrencyFromCents(2000, "USD") -> "$20.00"
 */
export function formatCurrencyFromCents(cents: number, currency?: string | null): string {
  const n = Number(cents);
  const safe = Number.isFinite(n) ? n : 0;
  return formatCurrency(safe / 100, currency);
}


