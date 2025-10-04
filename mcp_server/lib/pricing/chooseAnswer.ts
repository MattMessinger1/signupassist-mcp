import type { DiscoveredField } from '../../types/pricing.js';

const PLACEHOLDER_RE = /^\s*(--?\s*)?(select|choose|please select)[\s-]*--?\s*$/i;

export function chooseDefaultAnswer(
  field: DiscoveredField,
  currentValue?: string
): string | undefined {
  // If a value was already provided/mapped (e.g., child profile), keep it
  if (currentValue) return currentValue;

  // Only act on choice fields
  const opts = field.options ?? [];
  if (!opts.length) return currentValue;

  // Price-bearing? Prefer $0
  if (field.isPriceBearing && field.priceOptions?.length) {
    const freeOpt = field.priceOptions.find(o => o.costCents === 0);
    if (freeOpt) return freeOpt.value;
    // no explicit $0—fallback to lowest cost
    const cheapest = [...field.priceOptions].sort((a, b) =>
      (a.costCents ?? 0) - (b.costCents ?? 0)
    )[0];
    if (cheapest) return cheapest.value;
  }

  // Non-price-bearing: pick first *real* option (skip placeholders/empty)
  const real = opts.find(o =>
    o.value?.trim() &&
    !PLACEHOLDER_RE.test(o.label ?? '') &&
    o.value.toLowerCase() !== 'none'
  );
  return real?.value ?? opts[0]?.value;
}

