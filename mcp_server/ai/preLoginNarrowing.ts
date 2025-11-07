/**
 * Pre-Login Narrowing (A-A-P Triage)
 * 
 * Extracts Age, Activity, Provider from user messages to enable
 * fast, cached program discovery without requiring login first.
 * 
 * Design DNA:
 * - Chat-native: Ask ONE clarifying question if needed
 * - Minimal friction: Don't loop, proceed with defaults if declined
 * - Parent-friendly: Natural language, no jargon
 */

export interface AAPTriad {
  age?: number;
  activity?: string;
  provider?: string;
  complete: boolean;
  missing: Array<'age' | 'activity' | 'provider'>;
}

/**
 * Parse A-A-P triad from user message
 */
export function parseAAPTriad(message: string, context?: Partial<AAPTriad>): AAPTriad {
  const lowerMsg = message.toLowerCase();
  
  // Extract age
  let age = context?.age;
  if (!age) {
    const agePatterns = [
      /\b(\d{1,2})\s*(?:year|yr|yo|y\.o\.)s?\s*old\b/i,
      /\bage[s]?\s*(\d{1,2})\b/i,
      /\b(\d{1,2})\s*(?:and|,)\s*\d+\b/, // "ages 7 and 9" or "7, 9"
      /,?\s*(\d{1,2})\s*$/,  // Trailing number like ", 10"
    ];
    
    for (const pattern of agePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const parsedAge = parseInt(match[1], 10);
        if (parsedAge >= 3 && parsedAge <= 18) {
          age = parsedAge;
          break;
        }
      }
    }
  }
  
  // Extract activity
  let activity = context?.activity;
  if (!activity) {
    const activityMap: Record<string, string> = {
      'ski': 'skiing',
      'skiing': 'skiing',
      'lesson': 'lessons',
      'lessons': 'lessons',
      'camp': 'camps',
      'camps': 'camps',
      'race': 'racing',
      'racing': 'racing',
      'team': 'racing',
      'swim': 'swimming',
      'swimming': 'swimming',
      'soccer': 'soccer',
      'hockey': 'hockey',
    };
    
    for (const [keyword, normalized] of Object.entries(activityMap)) {
      if (lowerMsg.includes(keyword)) {
        activity = normalized;
        break;
      }
    }
  }
  
  // Extract provider
  let provider = context?.provider;
  if (!provider) {
    const providerPatterns = [
      /blackhawk|black hawk/i,
      /vail|vail resorts/i,
      /ymca|y\.m\.c\.a/i,
      /ski\s+club/i,
    ];
    
    for (const pattern of providerPatterns) {
      if (pattern.test(message)) {
        provider = message.match(pattern)?.[0] || undefined;
        break;
      }
    }
  }
  
  const missing: Array<'age' | 'activity' | 'provider'> = [];
  if (!age) missing.push('age');
  if (!activity) missing.push('activity');
  if (!provider) missing.push('provider');
  
  return {
    age,
    activity,
    provider,
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Generate clarifying question for missing A-A-P component
 */
export function buildAAPQuestion(triad: AAPTriad): string | null {
  if (triad.complete) return null;
  
  // Ask for the first missing item only (minimal friction)
  const missing = triad.missing[0];
  
  const questions = {
    age: "What's your child's age? (This helps me show age-appropriate programs)",
    activity: "What activity are you interested in? (e.g., skiing, swimming, soccer)",
    provider: "Which organization? (e.g., Blackhawk Ski Club, YMCA)",
  };
  
  return questions[missing];
}

/**
 * Build scoped cache query from A-A-P triad
 */
export function buildCacheQuery(triad: AAPTriad): {
  orgRef?: string;
  category: string;
  age?: number;
} {
  return {
    orgRef: normalizeProviderRef(triad.provider),
    category: normalizeCategoryRef(triad.activity),
    age: triad.age,
  };
}

/**
 * Normalize provider name to org_ref
 */
function normalizeProviderRef(provider?: string): string | undefined {
  if (!provider) return undefined;
  
  const lower = provider.toLowerCase();
  if (lower.includes('blackhawk') || lower.includes('black hawk')) {
    return 'blackhawk-ski';
  }
  if (lower.includes('vail')) {
    return 'vail-resorts';
  }
  if (lower.includes('ymca')) {
    return 'ymca';
  }
  
  // Default: slugify
  return provider.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Normalize activity to category
 */
function normalizeCategoryRef(activity?: string): string {
  if (!activity) return 'all';
  
  const lower = activity.toLowerCase();
  if (lower.includes('lesson')) return 'lessons';
  if (lower.includes('camp')) return 'camps';
  if (lower.includes('race') || lower.includes('team')) return 'racing';
  
  return lower;
}
