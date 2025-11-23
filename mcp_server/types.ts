/**
 * Canonical Type Definitions - Single Source of Truth
 * All types are defined here and re-exported from mcp_server/index.ts
 * No duplicate definitions allowed across the codebase.
 */

// ============================================================================
// Core Domain Types
// ============================================================================

/**
 * Child entity for family registration
 */
export interface Child {
  id: string;
  name: string;
  birthdate?: string;
}

/**
 * Session location from ipapi or user input
 * Used for location-based provider search and AAP context
 */
export interface SessionLocation {
  city?: string;
  region?: string;   // state / province
  country?: string;
  lat?: number;
  lng?: number;
  source?: 'ipapi' | 'user' | 'manual' | 'unknown' | 'disabled_ipapi';
  mock?: boolean;    // true if using mock location (e.g., localhost)
  reason?: string;   // reason for mock (e.g., "no_api_key", "localhost")
}

/**
 * Session context for orchestration and tool calls
 * Tracks user state, credentials, and provider information
 */
export interface SessionContext {
  userLocation?: { lat: number; lng: number };
  location?: SessionLocation | null;  // ipapi-derived location for provider search
  user_jwt?: string;
  provider?: { name: string; orgRef: string; source?: string; city?: string; state?: string };
  providerSearchResults?: any[];
  credential_id?: string;
  provider_cookies?: any[];
  loginCompleted?: boolean;
  step?: number;
  session_token?: string;      // persisted session token for Browserbase
  discovery_retry_count?: number;
  mandate_jws?: string;
  mandate_id?: string;
  children?: Child[];
  
  // Quick Win #1: Intent capture fields
  category?: string;      // Activity category: "lessons", "camps", "races", "all"
  childAge?: number;      // Child's age for filtering programs
  partialIntent?: { provider?: string; category?: string; childAge?: number; hasIntent: boolean }; // Stores incomplete intent across turns
  
  /**
   * Unified intent object derived from AAP triad or user input.
   * Represents complete understanding of user's registration goal.
   * Used by orchestrator to skip redundant narrowing questions.
   */
  intent?: {
    childAge?: number;
    category?: string;
    provider?: string;
    hasIntent: boolean;
  } | null;
  
  aapTriad?: { age?: number; activity?: string; provider?: string; complete: boolean; missing: Array<'age' | 'activity' | 'provider'> }; // AAP Triad state for stateful parsing
  targetProgram?: { program_ref: string; confidence: number }; // HIGH INTENT: Likely target program for fast-path
  intentStrength?: "low" | "medium" | "high"; // Intent strength classification for optimization
  
  // Quick Win #5: Session reuse tracking
  org_ref?: string;       // Organization reference for session validation
  session_issued_at?: number;  // Timestamp when session was created
  session_ttl_ms?: number;     // Session time-to-live in milliseconds
  session_token_expires_at?: number; // Unix timestamp when session token expires
  login_status?: "pending" | "success" | "failed";  // Login status tracking (strict type)
  mandate_valid_until?: number; // Mandate expiration timestamp
  
  // Phase 3: Program caching for performance
  cache?: Record<string, any>; // Generic cache for programs and other data
  
  // TASK 2: Schedule filter preferences
  schedulePreference?: {
    dayOfWeek?: "weekday" | "weekend" | "any";
    timeOfDay?: "morning" | "afternoon" | "evening" | "any";
  };
  scheduleDeclined?: boolean; // User chose to skip schedule filter
  
  // Orchestrator-specific fields
  program?: { name: string; id: string };
  child?: { name: string; id?: string; birthdate?: string };
  prerequisites?: Record<string, "ok" | "required" | "missing">;
  formAnswers?: Record<string, any>;
  conversationHistory?: Array<{ role: string; content: string }>;
  confirmed?: boolean;
  credentials?: { [provider: string]: { id: string; credential_id: string } };
  pendingLogin?: { provider: string; orgRef: string };
  lastQuestionType?: 'age' | 'category' | 'provider';
  userType?: 'first_time_parent' | 'returning_user' | 'unknown';
  isNewUser?: boolean;
  availablePrograms?: any[];
  programs?: any[]; // Temporary storage for program filtering in browse mode
  awaitingInput?: 'age' | 'activity' | string; // Awaiting specific user input type
  displayedProgramIds?: string[];
  remainingProgramIds?: string[];
  programSummary?: {
    categories: Array<{
      name: string;
      count: number;
      examples: string[];
      programIds: string[];
    }>;
  };
  showingCategories?: boolean;
  currentCategory?: string;
  selectedProgram?: string;
  programIntent?: {
    category?: "lessons" | "membership" | "camp" | "race" | "private";
    day_pref?: "weekend" | "weekday" | null;
    time_pref?: "morning" | "afternoon" | "evening" | null;
    level?: "beginner" | "intermediate" | "advanced" | null;
    keywords?: string[];
  };
  
  // NEW AAP System (Phase 1+2)
  aap?: import("./types/aap.js").AAPTriad;
  aap_asked_flags?: import("./types/aap.js").AAPAskedFlags;
  aap_discovery_plan?: import("./types/aap.js").DiscoveryPlan;
  
  extractedFields?: {
    fields: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      options?: Array<{ value: string; label: string }>;
      group?: string;
      confidence: number;
    }>;
    target_url?: string;
    screenshot?: string;
    meta?: {
      discovered_at: string;
      strategy: string;
      readiness: string;
    };
  };
  field_probe_run_id?: string;
  provider_session_token?: string;
}

// ============================================================================
// Provider Response Types
// ============================================================================

/**
 * Metadata hints for AI tone and UX guidance
 */
export interface ToolMetadata {
  tone_hints?: string;        // e.g., "Emphasize age ranges and schedule flexibility"
  security_note?: string;     // e.g., "Login credentials are never stored by SignupAssist"
  next_actions?: string[];    // e.g., ["select_program", "view_details"]
  confidence?: 'high' | 'medium' | 'low';
  prompt_version?: string;    // e.g., "v1.0.0" - tracks which prompt version generated this response
}

/**
 * UI card specification for consistent rendering
 */
export interface UICard {
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: 'accent' | 'outline';
  }>;
}

/**
 * Parent-friendly error structure
 */
export interface ParentFriendlyError {
  display: string;      // What parent sees
  recovery: string;     // Clear next step
  severity: 'low' | 'medium' | 'high';
  code?: string;        // Internal reference
}

/**
 * Standard response format for all provider tools
 * This ensures consistent reporting across all providers
 * (SkiClubPro, Shopify, Jackrabbit, etc.)
 * 
 * Generic type T represents the specific data returned by each provider tool
 */
export interface ProviderResponse<T = any> extends Record<string, any> {
  /**
   * Status of the provider operation
   */
  success: boolean;
  
  /**
   * Legacy login status field (kept for compatibility)
   * "cached" indicates data was served from cache without login
   */
  login_status?: 'success' | 'failed' | 'cached';
  
  /**
   * Session token for reusing Browserbase sessions across tool calls
   */
  session_token?: string;
  
  /**
   * The actual data returned by the provider tool (if successful)
   */
  data?: T;
  
  /**
   * Programs discovered (for find_programs tools)
   */
  programs?: any[];
  
  /**
   * Programs grouped by theme/category
   */
  programs_by_theme?: Record<string, any[]>;
  
  /**
   * Metadata for AI tone and UX guidance
   */
  meta?: ToolMetadata;
  
  /**
   * UI elements to render
   */
  ui?: {
    cards?: UICard[];
    message?: string;
  };
  
  /**
   * Error details (if operation failed)
   */
  error?: ParentFriendlyError | string; // string for legacy compatibility
  
  /**
   * Additional response metadata
   */
  message?: string;
  timeout?: boolean;
  
  /**
   * Timestamp of the operation
   */
  timestamp?: string;
}
