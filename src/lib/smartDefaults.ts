import type { EnhancedDiscoveredField } from '@/components/FieldRenderer';

const PLACEHOLDER_RE = /^\s*(--?\s*)?(select|choose|please select)[\s-]*--?\s*$/i;

/**
 * Automatically choose a default answer for a discovered field
 * - Prioritizes free options ($0) for price-bearing fields
 * - Falls back to cheapest option if no free option
 * - For non-price fields, picks first real option (skips placeholders)
 */
export function chooseDefaultAnswer(
  field: EnhancedDiscoveredField,
  currentValue?: string
): string | undefined {
  // If a value was already provided, keep it
  if (currentValue) return currentValue;

  // Only act on choice fields (select, radio, multi-select)
  if (!field.options || field.options.length === 0) {
    return undefined;
  }

  // Check if this is a price-bearing field
  const isPriceBearing = field.isPriceBearing || false;
  const priceOptions = field.priceOptions || [];

  // Price-bearing? Prefer $0
  if (isPriceBearing && priceOptions.length > 0) {
    const freeOpt = priceOptions.find(o => o.costCents === 0);
    if (freeOpt) return freeOpt.value;
    
    // No explicit $0—fallback to lowest cost
    const cheapest = [...priceOptions].sort((a, b) =>
      (a.costCents ?? 0) - (b.costCents ?? 0)
    )[0];
    if (cheapest) return cheapest.value;
  }

  // Non-price-bearing: pick first *real* option (skip placeholders/empty)
  // Handle both string[] and object[] formats
  const options = field.options;
  
  if (typeof options[0] === 'string') {
    // String array format
    const realOption = options.find(o => {
      const str = String(o);
      return str?.trim() && 
             !PLACEHOLDER_RE.test(str) && 
             str.toLowerCase() !== 'none';
    });
    return realOption ? String(realOption) : (options[0] ? String(options[0]) : undefined);
  } else {
    // Object format { value, label }
    const realOption = options.find((o: any) => {
      return o.value?.trim() &&
             !PLACEHOLDER_RE.test(o.label ?? '') &&
             o.value.toLowerCase() !== 'none';
    });
    return realOption ? (realOption as any).value : (options[0] ? (options[0] as any).value : undefined);
  }
}

