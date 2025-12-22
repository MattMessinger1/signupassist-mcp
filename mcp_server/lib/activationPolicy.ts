/**
 * activationPolicy.ts
 * 
 * UNIFIED ACTIVATION GATE - Single source of truth for SignupAssist activation rules.
 * 
 * This module ensures consistent behavior across:
 * - ChatGPT app (via manifest)
 * - /mcp-chat-test UI
 * - Any other client
 * 
 * Activation Rules (A-A-P Triad):
 * 1. Activity: What type of program/class?
 * 2. Age: Child's age or age range?
 * 3. Provider: Which organization? (currently AIM Design only)
 * 
 * Plus: At least one matching program must exist.
 */

import Logger from "../utils/logger.js";

// =============================================================================
// TYPES
// =============================================================================

export interface ActivationTriad {
  activity?: string;    // e.g., "robotics", "coding", "STEM"
  age?: number;         // e.g., 8 (child's age)
  ageRange?: string;    // e.g., "6-12"
  provider?: string;    // e.g., "aim-design"
  location?: string;    // e.g., "Madison, WI"
}

export interface ActivationCheckResult {
  isActivated: boolean;
  missingFields: ('activity' | 'age' | 'provider' | 'location')[];
  nextQuestion?: string;  // One question at a time
  confidence: number;     // 0-1 score
  matchedPrograms?: number;
  reason?: string;
}

export interface FlowGatingResult {
  canRequestPII: boolean;
  canRequestPayment: boolean;
  requiresConsent: boolean;
  reason: string;
}

// =============================================================================
// SUPPORTED PROVIDERS (expand as we add more)
// =============================================================================

const SUPPORTED_PROVIDERS = [
  { id: 'aim-design', names: ['aim design', 'aim', 'aim robotics'], location: 'Madison, WI' },
];

// =============================================================================
// TRIAD VALIDATION
// =============================================================================

/**
 * Check if the A-A-P triad is complete.
 * Returns missing fields and generates the next question to ask.
 */
export function validateTriad(triad: ActivationTriad): ActivationCheckResult {
  const missingFields: ('activity' | 'age' | 'provider' | 'location')[] = [];
  
  // Check provider first (required for activation)
  if (!triad.provider) {
    missingFields.push('provider');
  }
  
  // Location is implied by provider for now, but could be separate
  if (!triad.location && !triad.provider) {
    missingFields.push('location');
  }
  
  // Activity is optional but helps with filtering
  if (!triad.activity) {
    missingFields.push('activity');
  }
  
  // Age is optional but helps with filtering  
  if (!triad.age && !triad.ageRange) {
    missingFields.push('age');
  }
  
  // Build next question (ONE AT A TIME)
  let nextQuestion: string | undefined;
  
  if (missingFields.includes('provider')) {
    nextQuestion = "Which organization are you looking to sign up with? (e.g., AIM Design in Madison, WI)";
  } else if (missingFields.includes('activity')) {
    nextQuestion = "What type of class or activity are you interested in? (e.g., robotics, coding, STEM)";
  } else if (missingFields.includes('age')) {
    nextQuestion = "How old is your child?";
  }
  
  // Calculate confidence score
  const filledCount = 4 - missingFields.length;
  const confidence = filledCount / 4;
  
  const isActivated = !missingFields.includes('provider');  // Provider is minimum requirement
  
  return {
    isActivated,
    missingFields,
    nextQuestion,
    confidence,
    reason: isActivated 
      ? 'Provider identified, ready for program discovery' 
      : `Missing required field: ${missingFields[0]}`
  };
}

/**
 * Parse provider from user message.
 */
export function parseProviderFromMessage(message: string): string | undefined {
  const normalized = message.toLowerCase();
  
  for (const provider of SUPPORTED_PROVIDERS) {
    for (const name of provider.names) {
      if (normalized.includes(name)) {
        return provider.id;
      }
    }
  }
  
  return undefined;
}

/**
 * Parse activity type from user message.
 */
export function parseActivityFromMessage(message: string): string | undefined {
  const normalized = message.toLowerCase();
  
  const activityPatterns: Record<string, string[]> = {
    'robotics': ['robotics', 'robot', 'robots'],
    'coding': ['coding', 'code', 'programming', 'computer'],
    'stem': ['stem', 'science', 'engineering'],
    'design': ['design', '3d', 'cad'],
    'classes': ['classes', 'class', 'courses', 'course', 'programs', 'program'],
  };
  
  for (const [activity, patterns] of Object.entries(activityPatterns)) {
    for (const pattern of patterns) {
      if (normalized.includes(pattern)) {
        return activity;
      }
    }
  }
  
  return undefined;
}

/**
 * Parse age from user message.
 */
export function parseAgeFromMessage(message: string): number | undefined {
  // Match patterns like "8 years old", "my 10 year old", "age 7", etc.
  const agePatterns = [
    /(\d{1,2})\s*(?:years?\s*old|y\.?o\.?)/i,
    /(?:age|aged)\s*(\d{1,2})/i,
    /(?:my|our)\s*(\d{1,2})/i,
    /child(?:ren)?\s*(?:is|are)\s*(\d{1,2})/i,
    /^(\d{1,2})$/,  // Just a number
  ];
  
  for (const pattern of agePatterns) {
    const match = message.match(pattern);
    if (match) {
      const age = parseInt(match[1], 10);
      if (age >= 3 && age <= 18) {  // Reasonable age range
        return age;
      }
    }
  }
  
  return undefined;
}

// =============================================================================
// FLOW GATING (PII / Payment protection)
// =============================================================================

/**
 * Check if the flow can proceed to PII/payment collection.
 * 
 * CRITICAL RULES:
 * 1. Do NOT request PII until a program is selected AND user opts in
 * 2. Do NOT request payment until registration is confirmed
 * 3. Always require explicit consent before sensitive operations
 */
export function checkFlowGating(context: {
  triadComplete: boolean;
  programSelected: boolean;
  userOptedIn: boolean;
  programConfirmed: boolean;
  paymentAuthorized: boolean;
}): FlowGatingResult {
  
  // Stage 1: Cannot request ANY info until triad is complete
  if (!context.triadComplete) {
    return {
      canRequestPII: false,
      canRequestPayment: false,
      requiresConsent: false,
      reason: 'Triad incomplete - still gathering activity/age/provider'
    };
  }
  
  // Stage 2: Can browse programs, but no PII yet
  if (!context.programSelected) {
    return {
      canRequestPII: false,
      canRequestPayment: false,
      requiresConsent: false,
      reason: 'No program selected - user still browsing'
    };
  }
  
  // Stage 3: Program selected, can request PII with consent
  if (!context.userOptedIn) {
    return {
      canRequestPII: false,
      canRequestPayment: false,
      requiresConsent: true,
      reason: 'Program selected - awaiting user opt-in to proceed'
    };
  }
  
  // Stage 4: User opted in, can request PII (delegate/participant info)
  if (!context.programConfirmed) {
    return {
      canRequestPII: true,
      canRequestPayment: false,
      requiresConsent: false,
      reason: 'Collecting registration details'
    };
  }
  
  // Stage 5: Registration confirmed, payment requires explicit authorization
  if (!context.paymentAuthorized) {
    return {
      canRequestPII: true,
      canRequestPayment: false,
      requiresConsent: true,
      reason: 'Registration ready - awaiting payment authorization'
    };
  }
  
  // Stage 6: Fully authorized
  return {
    canRequestPII: true,
    canRequestPayment: true,
    requiresConsent: false,
    reason: 'Fully authorized - payment processing allowed'
  };
}

// =============================================================================
// ACTIVATION CHECK (combines triad + program match)
// =============================================================================

/**
 * Full activation check - requires both triad satisfaction AND program match.
 * 
 * This is the main entry point for deciding whether to activate SignupAssist.
 */
export function checkActivation(
  triad: ActivationTriad,
  availablePrograms: number = 0
): ActivationCheckResult {
  
  const triadResult = validateTriad(triad);
  
  // If triad not satisfied, return early
  if (!triadResult.isActivated) {
    Logger.info('[ActivationPolicy] Triad not satisfied', { 
      missing: triadResult.missingFields,
      nextQuestion: triadResult.nextQuestion
    });
    return triadResult;
  }
  
  // Check if matching programs exist
  if (availablePrograms === 0) {
    return {
      ...triadResult,
      isActivated: false,
      matchedPrograms: 0,
      reason: 'Triad satisfied but no matching programs found'
    };
  }
  
  // Full activation!
  Logger.info('[ActivationPolicy] ✅ Fully activated', {
    triad,
    matchedPrograms: availablePrograms
  });
  
  return {
    ...triadResult,
    isActivated: true,
    matchedPrograms: availablePrograms,
    reason: `Activated with ${availablePrograms} matching programs`
  };
}

// =============================================================================
// QUESTION GENERATION (one at a time)
// =============================================================================

const TRIAD_QUESTIONS = {
  provider: "Which organization would you like to sign up with?",
  activity: "What type of class or activity are you looking for?",
  age: "How old is your child?",
  location: "What city are you in?"
} as const;

/**
 * Get the next question to ask (only ONE at a time).
 * Priority: provider > activity > age
 */
export function getNextTriadQuestion(triad: ActivationTriad): string | null {
  if (!triad.provider) {
    return TRIAD_QUESTIONS.provider;
  }
  if (!triad.activity) {
    return TRIAD_QUESTIONS.activity;
  }
  if (!triad.age && !triad.ageRange) {
    return TRIAD_QUESTIONS.age;
  }
  return null;  // Triad complete
}

// =============================================================================
// MANIFEST POLICY DESCRIPTION (for description_for_model)
// =============================================================================

/**
 * Returns the activation policy text to include in the ChatGPT manifest.
 * This ensures ChatGPT follows the same rules as the server-side policy.
 */
export function getManifestActivationPolicy(): string {
  return `
ACTIVATION POLICY (STRICT):
- Only surface SignupAssist when ALL of: (1) provider is identified, (2) at least one program match exists
- Ask ONLY ONE missing triad question at a time (provider → activity → age)
- Do NOT request PII (name, email, phone) until a program is selected AND user opts in
- Do NOT request payment details until registration is confirmed AND user explicitly authorizes
- Every sensitive action requires explicit consent

QUESTION ORDERING:
1. If provider unknown: "Which organization would you like to sign up with?"
2. If activity unknown: "What type of class are you looking for?"
3. If age unknown: "How old is your child?"
Never ask multiple triad questions in the same turn.

PII/PAYMENT GATES:
- BROWSING: No PII needed, just show programs
- REGISTRATION START: User must say "sign up for [program]" or similar
- FORM FILL: Only collect info needed for the specific program
- PAYMENT: Requires explicit "authorize" or "confirm payment" from user
`.trim();
}
