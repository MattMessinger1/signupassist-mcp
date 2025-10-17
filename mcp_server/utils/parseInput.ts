/**
 * Input parsing utilities for provider search queries
 * Provides both heuristic and AI-assisted parsing capabilities
 */

export interface ParsedProviderInput {
  raw: string;
  name: string;
  city?: string;
}

/**
 * Parse provider input using basic heuristics
 * Extracts organization name and optional city from user input
 * 
 * @param userInput - Raw user input string
 * @returns Parsed provider information
 */
export function parseProviderInput(userInput: string): ParsedProviderInput {
  const cleaned = userInput
    .trim()
    .replace(/club|school|organization|org/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Match common Wisconsin cities (can be expanded)
  const cityMatch = cleaned.match(/\b(Madison|Middleton|Verona|Fitchburg|Waunakee)\b/i);
  const city = cityMatch ? cityMatch[0] : undefined;

  const name = city ? cleaned.replace(city, "").trim() : cleaned;
  return { 
    raw: userInput, 
    name: name.replace(/\b\s+\b/g, " ").trim(), 
    city 
  };
}
