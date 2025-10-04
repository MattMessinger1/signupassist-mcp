import type { DiscoveredField, PriceOption } from '../../types/pricing.js';

const MONEY_RE = /(?:\$|USD|US\$|£|€)\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/i;
const NUM_RE   = /\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/;

const FREE_WORDS = /\b(free|no charge|included|no cost|$0)\b/i;

function labelToCents(label: string): number | null {
  if (FREE_WORDS.test(label)) return 0;

  const moneyLike = label.match(MONEY_RE)?.[0] ?? null;
  const numLike   = moneyLike?.match(NUM_RE)?.[0] ?? null;
  if (!numLike) return null;

  const normalized = numLike.replace(/[,\s]/g, '');
  const value = Number.parseFloat(normalized);
  if (Number.isFinite(value)) return Math.round(value * 100);

  return null;
}

export function annotatePrice(field: DiscoveredField): DiscoveredField {
  if (!field) return field;

  // Only select/radio groups have discrete options to price
  const isChoice = field.type === 'select' || field.type === 'radio';
  if (!isChoice || !field.options?.length) return field;

  const priceOptions: PriceOption[] = field.options.map(opt => ({
    value: opt.value,
    label: opt.label,
    costCents: labelToCents(opt.label ?? ''),
  }));

  const hasAnyPriceSignal = priceOptions.some(o => o.costCents !== null);
  return {
    ...field,
    isPriceBearing: hasAnyPriceSignal,
    priceOptions: hasAnyPriceSignal ? priceOptions : undefined,
  };
}
