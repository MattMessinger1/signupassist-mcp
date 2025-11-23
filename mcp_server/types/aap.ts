/**
 * Unified AAP Type System
 * Single source of truth for Age-Activity-Provider triad
 */

export interface AAPField<T = any> {
  status: 'known' | 'unknown';
  raw: string | null;
  normalized: T | null;
  source: 'explicit' | 'implicit' | 'profile' | 'assumed';
}

export interface AAPAge extends AAPField<{
  years: number | null;
  grade_band: string | null;
  range: [number, number] | null;
}> {}

export interface AAPActivity extends AAPField<{
  category: string | null;
}> {
  normalized: { category: string | null } | null;
}

export interface LocationHint {
  city?: string;         // "Madison" - explicit from user
  state?: string;        // "WI" (optional)
  source: 'user_explicit' | 'inferred' | 'asked';
  asked?: boolean;       // Did we ask "What city?"
  
  // Legacy fields (deprecated but kept for backward compatibility)
  lat?: number | null;
  lng?: number | null;
  region?: string | null;
  country?: string | null;
  radiusKm?: number;
  mock?: boolean;
  reason?: string;
}

export interface AAPProvider extends AAPField<{
  org_ref: string | null;
  backend: 'bookeo' | 'skiclubpro' | 'campminder' | null;
  display_name: string | null;
}> {
  search_query?: string;              // "ABC Swim School"
  location_hint?: LocationHint;       // City from user OR asked
  search_results?: any[];             // OrgSearchResult[] from provider search
  disambiguation_required?: boolean;  // Multiple matches?
  
  normalized: {
    org_ref: string | null;
    backend: 'bookeo' | 'skiclubpro' | 'campminder' | null;
    display_name: string | null;
  } | null;
  mode?: 'named' | 'local';          // named provider vs local search
  locationHint?: LocationHint;        // Legacy - use location_hint instead
}

export interface AAPTriad {
  age: AAPAge;
  activity: AAPActivity;
  provider: AAPProvider;
}

export interface AAPTriageResult {
  aap: AAPTriad;
  followup_questions: string[];
  assumptions: string[];
  ready_for_discovery: boolean;
}

export interface DiscoveryPlan {
  feed?: 'programs' | string;  // Feed source identifier
  query?: {                    // Query parameters for filtering (normalized by planner)
    provider?: string | null;  // MUST be populated if feed_query.org_ref exists (normalized by planner)
    category?: string | null;
    age?: number | null;
  };
  feed_query: {
    org_ref: string | null;    // Primary source - will be copied to query.provider by normalizer
    category: string | null;
    age_hint: {
      years: number | null;
      range: [number, number] | null;
    };
    location?: {  // NEW: for local search
      lat: number;
      lng: number;
      radiusKm: number;
    };
  };
  fallback_strategy: string;
  notes_for_assistant: string;
}

export interface AAPAskedFlags {
  asked_age: boolean;
  asked_activity: boolean;
  asked_provider: boolean;
  asked_location: boolean;
}

/**
 * Factory Functions - Single source of truth for AAP defaults
 * Prevents missing required fields and centralizes default values
 */

export const createAAPProvider = (
  overrides: Partial<AAPProvider> = {}
): AAPProvider => {
  return {
    status: 'unknown',
    raw: null,
    normalized: null,
    source: 'assumed',
    mode: 'local',  // Default to local search if no provider specified
    ...overrides,
  };
};

export const createAAPAge = (
  overrides: Partial<AAPAge> = {}
): AAPAge => {
  return {
    status: 'unknown',
    raw: null,
    normalized: null,
    source: 'assumed',
    ...overrides,
  };
};

export const createAAPActivity = (
  overrides: Partial<AAPActivity> = {}
): AAPActivity => {
  return {
    status: 'unknown',
    raw: null,
    normalized: null,
    source: 'assumed',
    ...overrides,
  };
};

export const createEmptyAAP = (): AAPTriad => {
  return {
    age: createAAPAge(),
    activity: createAAPActivity(),
    provider: createAAPProvider(),
  };
};
