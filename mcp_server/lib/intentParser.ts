/**
 * Intent Parser
 * 
 * Extracts structured intent from user messages before login/search:
 * - Provider name
 * - Activity category (lessons, camps, race team, etc.)
 * - Child age
 * 
 * Uses AI-powered parsing with OpenAI for better natural language handling,
 * falls back to regex-based parsing if AI fails.
 */

import { parseIntentWithAI, type ExtendedIntent } from "./aiIntentParser.js";
import Logger from "../utils/logger.js";

export interface ParsedIntent {
  provider?: string;
  category?: string;
  childAge?: number;
  hasIntent: boolean;
  isNewUser?: boolean;          // NEW: Detected "I'm new" signals
  userType?: 'first_time_parent' | 'returning_user' | 'unknown'; // NEW: User classification
  rawEmail?: string;            // NEW: Raw email input
  normalizedEmail?: string;     // NEW: Normalized email
}

// Re-export ExtendedIntent for backward compatibility
export type { ExtendedIntent };

// Cache to avoid duplicate API calls (TTL: 5 minutes)
const intentCache = new Map<string, { result: ParsedIntent; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Main intent parser - tries AI first, falls back to regex
 * @param message - User's natural language input
 * @returns Structured intent object
 */
export async function parseIntent(message: string): Promise<ParsedIntent> {
  // Check cache first
  const cacheKey = message.toLowerCase().trim();
  const cached = intentCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expires) {
    Logger.info('[Intent Cache] Hit for:', message);
    return cached.result;
  }

  // Try AI parser first
  try {
    const result = await parseIntentWithAI(message);
    
    // Cache successful result
    intentCache.set(cacheKey, {
      result,
      expires: Date.now() + CACHE_TTL
    });
    
    return result;
    
  } catch (error: any) {
    Logger.warn('[Intent Parser] AI failed, falling back to regex:', error.message);
    
    // Fallback to regex parser
    const regexResult = parseIntentRegex(message);
    
    // Cache regex result too (avoid repeated fallbacks)
    intentCache.set(cacheKey, {
      result: regexResult,
      expires: Date.now() + CACHE_TTL
    });
    
    return regexResult;
  }
}

/**
 * Regex-based intent parser (fallback)
 * Kept for fallback when AI parser fails or API is unavailable
 * @param message - User's natural language input
 * @returns Structured intent object
 */
export function parseIntentRegex(message: string): ParsedIntent {
  const lowerMessage = message.toLowerCase();
  const intent: ParsedIntent = { hasIntent: false };
  
  // Provider detection
  const providerPatterns = [
    { pattern: /blackhawk|black hawk/i, value: 'blackhawk-ski-club' },
    { pattern: /vail|vail resorts/i, value: 'vail' },
    { pattern: /ski\s+club/i, value: 'ski-club' },
  ];
  
  for (const { pattern, value } of providerPatterns) {
    if (pattern.test(message)) {
      intent.provider = value;
      intent.hasIntent = true;
      break;
    }
  }
  
  // Category detection
  const categoryPatterns = [
    { pattern: /\blesson(s)?\b/i, value: 'lessons' },
    { pattern: /\bcamp(s)?\b/i, value: 'camps' },
    { pattern: /\brace(s)?\b|\bteam(s)?\b/i, value: 'races' },
    { pattern: /\bski(ing)?\b/i, value: 'lessons' }, // Default ski to lessons
  ];
  
  for (const { pattern, value } of categoryPatterns) {
    if (pattern.test(message)) {
      intent.category = value;
      intent.hasIntent = true;
      break;
    }
  }
  
  // Age detection
  const agePatterns = [
    /,?\s*(\d{1,2})\s*$/,  // Trailing number like ", 10" or " 10" at end of text
    /^\s*(\d{1,2})\s*$/,  // Standalone number (e.g., "9", "10") - context-aware parsing
    /(\d+)[\s-]?year[\s-]?old/i,
    /age[s]?\s+(\d+)/i,
    /(\d+)\s+years?\s+old/i,
    /child.*?(\d+)/i,
  ];
  
  for (const pattern of agePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const age = parseInt(match[1], 10);
      if (age >= 3 && age <= 18) { // Reasonable age range for programs
        intent.childAge = age;
        intent.hasIntent = true;
        break;
      }
    }
  }
  
  console.log('[parseIntentRegex] Input:', message);
  console.log('[parseIntentRegex] Output:', intent);
  
  return intent;
}

/**
 * Filter programs by age range
 * @param programs - Array of program objects with age_range field
 * @param childAge - Child's age in years
 * @returns Filtered array of programs
 */
export function filterByAge<T extends { age_range?: string }>(
  programs: T[],
  childAge?: number
): T[] {
  if (!childAge) {
    return programs; // No filtering if age not provided
  }
  
  return programs.filter(program => {
    if (!program.age_range) {
      return true; // Include programs without age restriction
    }
    
    // Parse age range like "Ages 7-10" or "7-10 years"
    const ageMatch = program.age_range.match(/(\d+)[\s-]+(\d+)/);
    if (ageMatch) {
      const minAge = parseInt(ageMatch[1], 10);
      const maxAge = parseInt(ageMatch[2], 10);
      return childAge >= minAge && childAge <= maxAge;
    }
    
    // Parse single age like "Age 8" or "8 years"
    const singleMatch = program.age_range.match(/(\d+)/);
    if (singleMatch) {
      const targetAge = parseInt(singleMatch[1], 10);
      return childAge === targetAge;
    }
    
    // Include if can't parse (avoid false negatives)
    return true;
  });
}

/**
 * Format combined question for missing intent parts
 * Pre-login Intent Gate: concise one-turn follow-up with chips
 * @param intent - Currently parsed intent
 * @returns Question text to ask user, or null if all present
 */
export function buildIntentQuestion(intent: ParsedIntent): string | null {
  const missing: { type: string; question: string; chips?: string[] }[] = [];
  
  if (!intent.provider) {
    missing.push({ 
      type: 'provider', 
      question: "Which provider or club?" 
    });
  }
  
  if (!intent.category) {
    missing.push({ 
      type: 'category', 
      question: "Looking for Lessons/Classes or Race Team/Events?",
      chips: ["Lessons", "Team/Events", "Not sure"]
    });
  }
  
  if (!intent.childAge) {
    missing.push({ 
      type: 'age', 
      question: "What's your child's age?" 
    });
  }
  
  if (missing.length === 0) {
    return null; // All intent present
  }
  
  // Build concise single-turn question for all missing pieces
  if (missing.length === 1) {
    return missing[0].question;
  }
  
  if (missing.length === 2) {
    return `${missing[0].question} And ${missing[1].question.toLowerCase()}`;
  }
  
  // All three missing
  return `${missing[0].question} ${missing[1].question} And ${missing[2].question.toLowerCase()}`;
}

/**
 * Check if user is declining to provide intent
 * @param message - User's response
 * @returns true if user is declining
 */
export function isIntentDeclined(message: string): boolean {
  const declinePatterns = [
    /prefer\s+not/i,
    /skip/i,
    /don't\s+know/i,
    /not\s+sure/i,
    /can't\s+say/i,
    /just\s+show/i,
    /show\s+all/i,
    /continue\s+anyway/i,
  ];
  
  return declinePatterns.some(pattern => pattern.test(message));
}
