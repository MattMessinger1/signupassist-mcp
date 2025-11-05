/**
 * Intent Parser
 * 
 * Extracts structured intent from user messages before login/search:
 * - Provider name
 * - Activity category (lessons, camps, race team, etc.)
 * - Child age
 * 
 * This enables targeted scraping and age-based filtering.
 */

export interface ParsedIntent {
  provider?: string;
  category?: string;
  childAge?: number;
  hasIntent: boolean;
}

/**
 * Parse user message for provider, activity, and child age
 * @param message - User's natural language input
 * @returns Structured intent object
 */
export function parseIntent(message: string): ParsedIntent {
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
 * @param intent - Currently parsed intent
 * @returns Question text to ask user
 */
export function buildIntentQuestion(intent: ParsedIntent): string | null {
  const missing: string[] = [];
  
  if (!intent.provider) missing.push('which provider (e.g., Blackhawk Ski Club)');
  if (!intent.category) missing.push('what type of activity (lessons, camps, or race team)');
  if (!intent.childAge) missing.push("your child's age");
  
  if (missing.length === 0) {
    return null; // No question needed
  }
  
  if (missing.length === 1) {
    return `Could you tell me ${missing[0]}?`;
  }
  
  const lastItem = missing.pop();
  return `Could you tell me ${missing.join(', ')}, and ${lastItem}?`;
}
