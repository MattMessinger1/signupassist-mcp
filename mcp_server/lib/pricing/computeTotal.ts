import type { DiscoveredField } from '../../types/pricing.js';

type Answers = Record<string, string | string[]>;

export function computeTotalCents(
  baseProgramPriceCents: number | null,          // from feed/scrape; null if unknown
  fields: DiscoveredField[],
  answers: Answers
): number {
  let total = baseProgramPriceCents ?? 0;

  for (const f of fields) {
    if (!f.isPriceBearing || !f.priceOptions?.length) continue;

    const val = answers[f.id];
    const chosen = Array.isArray(val) ? val : [val];

    for (const v of chosen) {
      const opt = f.priceOptions.find(o => o.value === v);
      if (opt?.costCents != null) total += opt.costCents;
    }
  }
  return total;
}
