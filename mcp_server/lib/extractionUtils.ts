/**
 * Extraction utilities for program data processing
 * Provides HTML snippet cleanup and program validation/deduplication
 */

import type { ProgramData } from "./threePassExtractor.programs.js";

/**
 * Canonicalize an HTML snippet for LLM consumption
 * Strips scripts, styles, excess attributes, collapses whitespace
 * Keeps text content and anchor hrefs for register/details links
 * 
 * @param html - Raw HTML snippet
 * @returns Minified, canonicalized HTML snippet
 */
export function canonicalizeSnippet(html: string): string {
  let result = html;
  
  // 1. Strip <script> and <style> tags (including content)
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // 2. Remove excess attributes, but preserve href in <a> tags
  // Keep only href for anchor tags, remove all other attributes
  result = result.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    return hrefMatch ? `<a href="${hrefMatch[1]}">` : '<a>';
  });
  
  // Remove all attributes from other tags
  result = result.replace(/<(\w+)\s+[^>]*?>/g, (match, tag) => {
    // Skip if it's an anchor tag (already handled above)
    if (tag.toLowerCase() === 'a') return match;
    return `<${tag}>`;
  });
  
  // 3. Collapse whitespace
  // Replace multiple spaces with single space
  result = result.replace(/\s+/g, ' ');
  
  // Remove whitespace around tags
  result = result.replace(/>\s+</g, '><');
  
  // Trim leading/trailing whitespace
  result = result.trim();
  
  // 4. Deduplicate repeated lines (if any)
  const lines = result.split('\n').filter(line => line.trim());
  const uniqueLines = [...new Set(lines)];
  result = uniqueLines.join('\n');
  
  return result;
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
  // 1. Filter out items without titles
  let validated = items.filter(item => item.title && item.title.trim().length > 0);
  
  // 2. Normalize status to whitelist values
  validated = validated.map(item => {
    const status = item.status?.trim() || '';
    
    // Check if status is in the whitelist (case-insensitive)
    const normalizedStatus = VALID_STATUSES.find(
      validStatus => validStatus.toLowerCase() === status.toLowerCase()
    );
    
    return {
      ...item,
      status: normalizedStatus || '-' // Default to '-' if not in whitelist
    };
  });
  
  // 3. Deduplicate by program_ref (keep first occurrence)
  const seen = new Set<string>();
  const deduplicated = validated.filter(item => {
    if (!item.program_ref) {
      // Keep items without program_ref (shouldn't happen, but be safe)
      return true;
    }
    
    if (seen.has(item.program_ref)) {
      return false; // Skip duplicates
    }
    
    seen.add(item.program_ref);
    return true;
  });
  
  return deduplicated;
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
