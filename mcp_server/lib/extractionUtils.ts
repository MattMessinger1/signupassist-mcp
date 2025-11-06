/**
 * Extraction utilities for program data processing
 * Provides HTML snippet cleanup and program validation/deduplication
 */

// Import ProgramData type - will be used for validation
interface ProgramData {
  id: string;
  program_ref: string;
  title: string;
  description?: string;
  schedule?: string;
  age_range?: string;
  skill_level?: string;
  price?: string;
  actual_id?: string;
  org_ref?: string;
  status?: string;
  cta_href?: string;
}

/**
 * Canonicalize an HTML snippet for LLM consumption
 * Strips scripts, styles, excess attributes, collapses whitespace
 * Keeps text content and anchor hrefs for register/details links
 * 
 * @param html - Raw HTML snippet
 * @returns Minified, canonicalized HTML snippet
 */
export function canonicalizeSnippet(html: string): string {
  // TODO: Implement in Step 1b
  return html;
}

/**
 * Validate and deduplicate program data
 * - Filters out items without titles
 * - Normalizes status to whitelist values
 * - Deduplicates by program_ref (keeps first occurrence)
 * 
 * @param items - Array of extracted program data
 * @returns Validated and deduplicated program array
 */
export function validateAndDedupePrograms(items: ProgramData[]): ProgramData[] {
  // TODO: Implement in Step 1c
  return items;
}

/**
 * Valid status values for programs
 */
export const VALID_STATUSES = [
  "Open",
  "Register",
  "Waitlist",
  "Full",
  "Closed",
  "Sold Out",
  "Restricted",
  "TBD",
  "-"
] as const;

export type ValidStatus = typeof VALID_STATUSES[number];
