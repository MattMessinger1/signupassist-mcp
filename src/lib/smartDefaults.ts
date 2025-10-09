import type { EnhancedDiscoveredField } from '@/components/FieldRenderer';

const PLACEHOLDER_RE = /^\s*(--?\s*)?(select|choose|please select)[\s-]*--?\s*$/i;

/**
 * Automatically choose a default answer for a discovered field with enhanced priority logic
 * - Prioritizes free options ($0) for price-bearing fields
 * - Falls back to cheapest option if no free option
 * - For non-price fields, uses smart priority: free > None > basic/standard > first valid
 * 
 * @param field - The field to choose a default for
 * @param currentValue - Optional current value (preserved if provided)
 * @returns The selected default value, or undefined if none suitable
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

  // Normalize options to array of { value, label }
  const normalizedOptions = field.options.map(opt => 
    typeof opt === 'string' 
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label || opt.value }
  );

  // Filter out empty values and placeholders
  const validOptions = normalizedOptions.filter(opt => {
    const val = opt.value?.trim();
    const lbl = opt.label?.trim();
    return val && !PLACEHOLDER_RE.test(lbl);
  });

  if (validOptions.length === 0) {
    console.warn(`[chooseDefaultAnswer] No valid options for field: ${field.id}`);
    return undefined;
  }

  // Check if this is a price-bearing field
  const isPriceBearing = field.isPriceBearing || false;
  const priceOptions = field.priceOptions || [];

  // Price-bearing? Prefer $0, then lowest cost
  if (isPriceBearing && priceOptions.length > 0) {
    const freeOpt = priceOptions.find(o => o.costCents === 0);
    if (freeOpt) {
      console.log(`[chooseDefaultAnswer] ${field.id}: Selected free option: ${freeOpt.value}`);
      return freeOpt.value;
    }
    
    // No explicit $0—fallback to lowest cost
    const cheapest = [...priceOptions].sort((a, b) =>
      (a.costCents ?? Infinity) - (b.costCents ?? Infinity)
    )[0];
    if (cheapest) {
      console.log(`[chooseDefaultAnswer] ${field.id}: Selected cheapest option: ${cheapest.value} ($${(cheapest.costCents ?? 0) / 100})`);
      return cheapest.value;
    }
  }

  // Non-price-bearing: use priority logic
  // 1. Check for "None" or "No thanks" options
  const noneOption = validOptions.find(opt => 
    /^(none|no|n\/a|no thanks|skip)$/i.test(opt.value) ||
    /^(none|no|n\/a|no thanks|skip)$/i.test(opt.label)
  );
  if (noneOption) {
    console.log(`[chooseDefaultAnswer] ${field.id}: Selected "None" option: ${noneOption.value}`);
    return noneOption.value;
  }

  // 2. Check for "basic" or "standard" options
  const basicOption = validOptions.find(opt =>
    /(basic|standard|default)/i.test(opt.label)
  );
  if (basicOption) {
    console.log(`[chooseDefaultAnswer] ${field.id}: Selected basic/standard option: ${basicOption.value}`);
    return basicOption.value;
  }

  // 3. Fallback to first valid option
  const firstOption = validOptions[0];
  console.log(`[chooseDefaultAnswer] ${field.id}: Selected first valid option: ${firstOption.value}`);
  return firstOption.value;
}

