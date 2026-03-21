/**
 * Extraction utilities for program data processing
 * Provides HTML snippet cleanup, status validation, and text stripping
 */

/**
 * Canonicalize an HTML snippet for LLM consumption
 * Strips scripts, styles, excess attributes, collapses whitespace
 * Keeps text content and anchor hrefs for register/details links
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

/**
 * Strip HTML tags and decode entities from text
 * Removes HTML markup and structural prefixes like "Description → Section: General"
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  // Decode common HTML entities FIRST (before stripping tags)
  const entities: Record<string, string> = {
    '&rarr;': '→',
    '&larr;': '←',
    '&ndash;': '–',
    '&mdash;': '—',
    '&rsquo;': "'",
    '&lsquo;': "'",
    '&rdquo;': '"',
    '&ldquo;': '"',
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"'
  };
  
  let text = html;
  Object.entries(entities).forEach(([entity, char]) => {
    text = text.replace(new RegExp(entity, 'g'), char);
  });
  
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  
  // Remove structural prefixes like "Description → Section: General" ANYWHERE in text
  // This handles when the prefix appears after HTML was stripped
  text = text.replace(/Description\s*→\s*Section:\s*\w+/gi, '');
  
  // Clean up excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}
