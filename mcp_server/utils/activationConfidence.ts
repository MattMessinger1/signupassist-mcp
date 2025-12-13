/**
 * Activation Confidence Calculator
 * Determines if SignupAssist should activate based on contextual signals
 * 
 * Strategy: Conservative activation to avoid false positives
 * - HIGH: Activate immediately
 * - MEDIUM: Ask for clarification (unauthenticated) or check stored location (authenticated)
 * - LOW: Don't activate
 */

import Logger from './logger.js';
import { extractActivityFromMessage, findProvidersForActivity, getActivityDisplayName } from './activityMatcher.js';

// Known provider configurations
export interface ProviderConfig {
  name: string;
  aliases: string[];
  city?: string;
  state?: string;
  urlPatterns: string[];
}

// Known providers for matching
export const KNOWN_PROVIDERS: ProviderConfig[] = [
  {
    name: 'AIM Design',
    aliases: ['aim design', 'aim', 'aimdesign'],
    city: 'Madison',
    state: 'WI',
    urlPatterns: ['bookeo.com/aimdesign', 'aimdesign.']
  }
  // Add more providers here as we onboard them
];

// Signal detection patterns
const ENROLLMENT_INTENT_PATTERNS = [
  'sign up', 'signup', 'register', 'enroll', 'book', 'reserve',
  'looking to sign', 'want to register', 'need to enroll'
];

const FAMILY_CONTEXT_PATTERNS = [
  'kid', 'kids', 'child', 'children', 'son', 'daughter',
  'my \\d+ year old', 'my \\d+-year-old', 'for my'
];

const PROGRAM_TYPE_PATTERNS = [
  'class', 'classes', 'camp', 'camps', 'lesson', 'lessons',
  'workshop', 'session', 'program', 'course', 'activity'
];

// Location patterns
const CITY_PATTERNS = [
  'in (\\w+)',
  'near (\\w+)',
  'at (\\w+)',
  '(\\w+), (\\w{2})'
];

export interface ActivationSignals {
  providerMatch: { name: string; confidence: number; city?: string; state?: string } | null;
  locationDetected: { city?: string; state?: string } | null;
  enrollmentIntent: string[];
  familyContext: string[];
  programType: string[];
  urlMatch: string | null;
}

export interface ActivationResult {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  signals: ActivationSignals;
  matchedProvider: ProviderConfig | null;
  shouldActivate: boolean;
  clarificationNeeded: boolean;
  reason: string;
}

/**
 * Detect enrollment intent keywords
 */
function detectEnrollmentIntent(message: string): string[] {
  const lower = message.toLowerCase();
  return ENROLLMENT_INTENT_PATTERNS.filter(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(lower);
  });
}

/**
 * Detect family context keywords
 */
function detectFamilyContext(message: string): string[] {
  const lower = message.toLowerCase();
  return FAMILY_CONTEXT_PATTERNS.filter(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(lower);
  });
}

/**
 * Detect program type keywords
 */
function detectProgramType(message: string): string[] {
  const lower = message.toLowerCase();
  return PROGRAM_TYPE_PATTERNS.filter(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(lower);
  });
}

/**
 * Detect provider URL in message
 */
function detectProviderURL(message: string): { url: string; provider: ProviderConfig } | null {
  const lower = message.toLowerCase();
  
  for (const provider of KNOWN_PROVIDERS) {
    for (const urlPattern of provider.urlPatterns) {
      if (lower.includes(urlPattern)) {
        return { url: urlPattern, provider };
      }
    }
  }
  
  return null;
}

/**
 * Detect provider name mention
 */
function detectProviderMention(message: string): ProviderConfig | null {
  const lower = message.toLowerCase();
  
  for (const provider of KNOWN_PROVIDERS) {
    // Check exact name
    if (lower.includes(provider.name.toLowerCase())) {
      return provider;
    }
    
    // Check aliases
    for (const alias of provider.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        return provider;
      }
    }
  }
  
  return null;
}

/**
 * Detect city/location mention in message
 */
function detectLocation(message: string): { city?: string; state?: string } | null {
  const lower = message.toLowerCase();
  
  // Check for "in [City]" pattern
  const inCityMatch = lower.match(/\bin\s+([a-z]+)/i);
  if (inCityMatch) {
    return { city: inCityMatch[1].charAt(0).toUpperCase() + inCityMatch[1].slice(1) };
  }
  
  // Check for "City, ST" pattern
  const cityStateMatch = message.match(/([A-Z][a-z]+),?\s*([A-Z]{2})/);
  if (cityStateMatch) {
    return { 
      city: cityStateMatch[1], 
      state: cityStateMatch[2] 
    };
  }
  
  // Check for known provider cities explicitly
  for (const provider of KNOWN_PROVIDERS) {
    if (provider.city && lower.includes(provider.city.toLowerCase())) {
      return { city: provider.city, state: provider.state };
    }
  }
  
  return null;
}

/**
 * Check if detected location matches provider location
 */
function locationMatchesProvider(
  detectedLocation: { city?: string; state?: string } | null,
  provider: ProviderConfig
): boolean {
  if (!detectedLocation || !provider.city) return false;
  
  if (detectedLocation.city && provider.city) {
    return detectedLocation.city.toLowerCase() === provider.city.toLowerCase();
  }
  
  return false;
}

/**
 * Check if stored user location matches provider location
 */
export function storedLocationMatchesProvider(
  storedCity: string | undefined,
  storedState: string | undefined,
  provider: ProviderConfig
): boolean {
  if (!storedCity || !provider.city) return false;
  return storedCity.toLowerCase() === provider.city.toLowerCase();
}

/**
 * Calculate activation confidence based on message signals
 */
export function calculateActivationConfidence(
  message: string,
  options?: {
    isAuthenticated?: boolean;
    storedCity?: string;
    storedState?: string;
  }
): ActivationResult {
  const { isAuthenticated = false, storedCity, storedState } = options || {};
  
  // Detect all signals
  const urlMatch = detectProviderURL(message);
  const providerMention = detectProviderMention(message);
  const locationDetected = detectLocation(message);
  const enrollmentIntent = detectEnrollmentIntent(message);
  const familyContext = detectFamilyContext(message);
  const programType = detectProgramType(message);
  
  const signals: ActivationSignals = {
    providerMatch: providerMention ? {
      name: providerMention.name,
      confidence: 1,
      city: providerMention.city,
      state: providerMention.state
    } : null,
    locationDetected,
    enrollmentIntent,
    familyContext,
    programType,
    urlMatch: urlMatch?.url || null
  };
  
  Logger.info('[ActivationConfidence] Detected signals:', {
    provider: signals.providerMatch?.name,
    location: signals.locationDetected,
    enrollmentIntent: signals.enrollmentIntent,
    familyContext: signals.familyContext,
    programType: signals.programType,
    urlMatch: signals.urlMatch
  });
  
  // HIGH CONFIDENCE RULES (activate immediately)
  
  // Rule 1: URL match is instant HIGH
  if (urlMatch) {
    Logger.info('[ActivationConfidence] HIGH - URL match detected');
    return {
      level: 'HIGH',
      signals,
      matchedProvider: urlMatch.provider,
      shouldActivate: true,
      clarificationNeeded: false,
      reason: `URL match: ${urlMatch.url}`
    };
  }
  
  // Rule 2: Provider + City match
  if (providerMention && locationDetected && locationMatchesProvider(locationDetected, providerMention)) {
    Logger.info('[ActivationConfidence] HIGH - Provider + City match');
    return {
      level: 'HIGH',
      signals,
      matchedProvider: providerMention,
      shouldActivate: true,
      clarificationNeeded: false,
      reason: `Provider "${providerMention.name}" + location "${locationDetected.city}" match`
    };
  }
  
  // Rule 3: Provider + Enrollment Intent + Family Context
  if (providerMention && enrollmentIntent.length > 0 && familyContext.length > 0) {
    Logger.info('[ActivationConfidence] HIGH - Provider + Enrollment + Family');
    return {
      level: 'HIGH',
      signals,
      matchedProvider: providerMention,
      shouldActivate: true,
      clarificationNeeded: false,
      reason: `Provider "${providerMention.name}" + enrollment intent + family context`
    };
  }
  
  // Rule 4: Authenticated with stored location matching provider
  if (isAuthenticated && providerMention && storedCity) {
    if (storedLocationMatchesProvider(storedCity, storedState, providerMention)) {
      Logger.info('[ActivationConfidence] HIGH - Authenticated + Stored location matches');
      return {
        level: 'HIGH',
        signals,
        matchedProvider: providerMention,
        shouldActivate: true,
        clarificationNeeded: false,
        reason: `Provider "${providerMention.name}" + stored location "${storedCity}" match`
      };
    }
  }
  
  // MEDIUM CONFIDENCE RULES (ask for clarification or location)
  
  // Rule 5: Provider + any single context signal
  if (providerMention && (enrollmentIntent.length > 0 || familyContext.length > 0 || programType.length > 0)) {
    Logger.info('[ActivationConfidence] MEDIUM - Provider + single context signal');
    return {
      level: 'MEDIUM',
      signals,
      matchedProvider: providerMention,
      shouldActivate: false,
      clarificationNeeded: true,
      reason: `Provider "${providerMention.name}" with context but no location confirmation`
    };
  }
  
  // Rule 6: Provider name alone (might be unrelated company)
  if (providerMention) {
    Logger.info('[ActivationConfidence] MEDIUM - Provider name alone');
    return {
      level: 'MEDIUM',
      signals,
      matchedProvider: providerMention,
      shouldActivate: false,
      clarificationNeeded: true,
      reason: `Provider name "${providerMention.name}" without context`
    };
  }
  
  // Rule 7: Activity matches a provider's offerings (AAP triad CAN align)
  const detectedActivity = extractActivityFromMessage(message);
  if (detectedActivity) {
    const matchingProviders = findProvidersForActivity(detectedActivity);
    if (matchingProviders.length > 0) {
      // We have providers for this activity - ask for city to narrow down
      Logger.info('[ActivationConfidence] MEDIUM - Activity has provider(s)', { 
        activity: detectedActivity, 
        providers: matchingProviders.map(p => p.displayName) 
      });
      return {
        level: 'MEDIUM',
        signals,
        matchedProvider: null,  // No specific provider yet
        shouldActivate: false,
        clarificationNeeded: true,
        reason: `Activity "${detectedActivity}" has ${matchingProviders.length} provider(s) - need location`
      };
    }
    // Activity detected but NO providers → silent pass (fall through to LOW)
    Logger.info('[ActivationConfidence] LOW - No providers for activity', { activity: detectedActivity });
  }
  
  // LOW CONFIDENCE (don't activate)
  Logger.info('[ActivationConfidence] LOW - No provider match');
  return {
    level: 'LOW',
    signals,
    matchedProvider: null,
    shouldActivate: false,
    clarificationNeeded: false,
    reason: 'No provider match detected'
  };
}

/**
 * Get provider by org_ref
 */
export function getProviderByOrgRef(orgRef: string): ProviderConfig | undefined {
  return KNOWN_PROVIDERS.find(p => 
    p.name.toLowerCase().replace(/\s+/g, '-') === orgRef.toLowerCase() ||
    p.aliases.some(a => a.toLowerCase().replace(/\s+/g, '-') === orgRef.toLowerCase())
  );
}
