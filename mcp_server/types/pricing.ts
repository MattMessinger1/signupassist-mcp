export type Currency = 'USD' | 'CAD' | 'EUR';

// For options that may carry price signals parsed from labels or DOM
export interface PriceOption {
  value: string;
  label: string;
  costCents: number | null; // null means unknown / not price-bearing
}

export interface DiscoveredField {
  id: string;
  type: 'select' | 'radio' | 'checkbox' | 'text' | 'date' | 'textarea';
  label?: string;
  required?: boolean;
  options?: { value: string; label: string }[];

  // NEW price-awareness annotations
  isPriceBearing?: boolean;
  priceOptions?: PriceOption[]; // same order as options/radios when present
}
