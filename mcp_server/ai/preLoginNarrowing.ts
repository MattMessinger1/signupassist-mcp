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
 * Generate clarifying question for missing A-A-P component (template-based fallback)
 */
export function buildAAPQuestion(triad: AAPTriad): string | null {
  if (triad.complete) return null;
  
  const questions = {
    age: "What's your child's age? (This helps me show age-appropriate programs)",
    activity: "What activity are you interested in? (e.g., skiing, swimming, soccer)",
    provider: "Which organization? (e.g., Blackhawk Ski Club, YMCA)",
  };
  
  // Get all missing questions
  const missingQuestions = triad.missing.map(key => questions[key]);
  
  // Combine based on count
  if (missingQuestions.length === 1) {
    return missingQuestions[0];
  }
  
  if (missingQuestions.length === 2) {
    // "Question 1? And question 2?"
    return `${missingQuestions[0]} And ${missingQuestions[1].toLowerCase()}`;
  }
  
  // All 3 missing: "Provider? Activity? And age?"
  return `${missingQuestions[0]} ${missingQuestions[1]} And ${missingQuestions[2].toLowerCase()}`;
}

/**
 * AI-Powered Natural Question Generator
 * 
 * Uses OpenAI to generate contextual, friendly questions that combine
 * all missing AAP components into a single, natural question.
 * 
 * @param triad - Current AAP triad state
 * @param userMessage - User's last message for context
 * @returns Natural language question or null if complete
 */
export async function buildNaturalAAPQuestion(
  triad: AAPTriad, 
  userMessage: string
): Promise<string | null> {
  if (triad.complete) return null;
  
  // Import here to avoid circular dependencies
  const { callOpenAI_JSON } = await import("../lib/openaiHelpers.js");
  const Logger = (await import("../utils/logger.js")).default;
  
  try {
    Logger.info('[AAP AI Question] Generating natural question for missing:', triad.missing);
    
    // Build context about what we have and what we need
    const hasItems = [];
    if (triad.age) hasItems.push(`age ${triad.age}`);
    if (triad.activity) hasItems.push(`activity: ${triad.activity}`);
    if (triad.provider) hasItems.push(`provider: ${triad.provider}`);
    
    const needsItems = triad.missing.map(item => {
      switch (item) {
        case 'age': return 'child\'s age';
        case 'activity': return 'activity type (e.g., skiing, swimming)';
        case 'provider': return 'organization name (e.g., Blackhawk Ski Club, YMCA)';
        default: return item;
      }
    });
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: `You generate friendly, concise questions for parent registration flows.

Your job: Combine multiple missing pieces into ONE natural question.

Guidelines:
- Be warm and conversational, like a helpful assistant
- Keep it under 25 words total
- Use "and" to connect items naturally
- Add brief context in parentheses only if helpful
- Never use jargon or technical terms

Examples:
- Missing age only: "What's your child's age? (Helps me show the right programs)"
- Missing activity + age: "What activity are you interested in, and how old is your child?"
- Missing all three: "Which organization are you looking at? What activity interests you? And what's your child's age?"

Generate ONE question that asks for all missing items in a natural, friendly way.`,
      user: {
        userMessage,
        currentlyHave: hasItems.join(', ') || 'nothing yet',
        needsToKnow: needsItems,
      },
      maxTokens: 100,
      temperature: 0.3, // Some creativity for natural language
      useResponsesAPI: false,
    });
    
    const question = result.question || result.text || result.content;
    Logger.info('[AAP AI Question] Generated:', question);
    
    return question;
    
  } catch (error: any) {
    Logger.warn('[AAP AI Question] Generation failed, using template fallback:', error.message);
    // Fallback to template-based question
    return buildAAPQuestion(triad);
  }
}

/**
 * Map ParsedIntent to AAPTriad format
 * 
 * Converts the AI-parsed intent structure to the AAP format,
 * preserving existing context values.
 * 
 * @param intent - Parsed intent from AI
 * @param context - Existing AAP context to preserve
 * @returns AAP triad with completion status
 */
export function mapIntentToAAP(
  intent: { provider?: string; category?: string; childAge?: number },
  context?: Partial<AAPTriad>
): AAPTriad {
  console.log('[mapIntentToAAP] Input:', { 
    intent: {
      provider: intent.provider,
      category: intent.category,
      childAge: intent.childAge
    }, 
    context: {
      provider: context?.provider,
      activity: context?.activity,
      age: context?.age
    }
  });
  
  // PRIORITY: New extraction takes precedence, fallback to existing context
  const age = intent.childAge || context?.age;
  const activity = intent.category || context?.activity;
  const provider = intent.provider || context?.provider;
  
  console.log('[mapIntentToAAP] Merged result:', { age, activity, provider });
  
  const missing: Array<'age' | 'activity' | 'provider'> = [];
  if (!age) missing.push('age');
  if (!activity) missing.push('activity');
  if (!provider) missing.push('provider');
  
  const result = {
    age,
    activity,
    provider,
    complete: missing.length === 0,
    missing,
  };
  
  console.log('[mapIntentToAAP] Final AAP triad:', result);
  
  return result;
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
