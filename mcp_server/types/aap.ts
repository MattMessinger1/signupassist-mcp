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

export interface AAPProvider extends AAPField<{
  org_ref: string | null;
}> {
  normalized: { org_ref: string | null } | null;
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
  };
  fallback_strategy: string;
  notes_for_assistant: string;
}

export interface AAPAskedFlags {
  asked_age: boolean;
  asked_activity: boolean;
  asked_provider: boolean;
}
