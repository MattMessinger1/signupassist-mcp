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
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
  radiusKm: number;
  source: 'ip' | 'explicit' | 'profile';
  mock?: boolean;  // Track if using mock Madison location
  reason?: string; // Why mock is being used
}

export interface AAPProvider extends AAPField<{
  org_ref: string | null;
}> {
  normalized: { org_ref: string | null } | null;
  mode: 'named' | 'local';  // NEW: named provider vs local search
  locationHint?: LocationHint;  // NEW: local search center
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
  feed_query: {
    org_ref: string | null;
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
}
