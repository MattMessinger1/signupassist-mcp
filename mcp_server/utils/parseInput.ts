/**
 * Input parsing utilities for provider search queries
 * Provides both heuristic and AI-assisted parsing capabilities
 */

import { lookupCity, CityLookupResult, formatCityDisplay } from "./cityLookup.js";

export interface ParsedProviderInput {
  raw: string;
  name: string;
  city?: string;
  state?: string;
  cityLookup?: CityLookupResult;
}

/**
 * Parse provider input using city lookup and heuristics
 * Extracts organization name and optional city/state from user input
 * 
 * @param userInput - Raw user input string
 * @returns Parsed provider information with city lookup results
 */
export function parseProviderInput(userInput: string): ParsedProviderInput {
  const cleaned = userInput
    .trim()
    .replace(/club|school|organization|org/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Try to extract city from the input using our comprehensive city lookup
  const cityLookup = lookupCity(cleaned);
  
  let city: string | undefined;
  let state: string | undefined;
  let name = cleaned;
  
  if (cityLookup.found && cityLookup.suggestedMatch) {
    const match = cityLookup.suggestedMatch;
    city = match.city;
    state = match.state;
    
    // Remove the city name from the search query to get the org name
    const cityRegex = new RegExp(`\\b${match.city}\\b`, 'gi');
    name = cleaned.replace(cityRegex, '').trim();
    
    // Also remove state abbreviation if present
    const stateRegex = new RegExp(`\\b${match.state}\\b`, 'gi');
    name = name.replace(stateRegex, '').trim();
    
    // Clean up any leftover commas or extra spaces
    name = name.replace(/,\s*$/, '').replace(/^\s*,/, '').replace(/\s+/g, ' ').trim();
  }
  
  return { 
    raw: userInput, 
    name: name || cleaned,
    city,
    state,
    cityLookup
  };
}

/**
 * Extract location from a message (city + optional state)
 * 
 * @param message - User message to parse
 * @returns City lookup result
 */
export function extractLocation(message: string): CityLookupResult {
  // Common patterns for location mentions
  const patterns = [
    /\bin\s+([A-Za-z\s]+?)(?:\s*,?\s*([A-Z]{2}))?\s*$/i,  // "in Madison WI"
    /\bnear\s+([A-Za-z\s]+?)(?:\s*,?\s*([A-Z]{2}))?\s*$/i, // "near Chicago"
    /\baround\s+([A-Za-z\s]+?)(?:\s*,?\s*([A-Z]{2}))?\s*$/i, // "around Denver"
    /\bfrom\s+([A-Za-z\s]+?)(?:\s*,?\s*([A-Z]{2}))?\s*$/i, // "I'm from Nashville"
    /^([A-Za-z\s]+?)(?:\s*,?\s*([A-Z]{2}))?$/i, // Just "Nashville" or "Nashville TN"
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const cityPart = match[1].trim();
      const statePart = match[2]?.trim();
      const query = statePart ? `${cityPart} ${statePart}` : cityPart;
      const result = lookupCity(query);
      if (result.found) {
        return result;
      }
    }
  }
  
  // Fallback: try the whole message as a city lookup
  return lookupCity(message);
}

/**
 * Format location for display
 */
export function formatLocation(city: string, state?: string): string {
  return state ? formatCityDisplay(city, state) : city;
}
