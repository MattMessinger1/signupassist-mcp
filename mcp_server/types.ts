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
 * Session context for orchestration and tool calls
 * Tracks user state, credentials, and provider information
 */
export interface SessionContext {
  userLocation?: { lat: number; lng: number };
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
  
  // Quick Win #5: Session reuse tracking
  org_ref?: string;       // Organization reference for session validation
  session_issued_at?: number;  // Timestamp when session was created
  session_ttl_ms?: number;     // Session time-to-live in milliseconds
  login_status?: string;       // Login status tracking
  mandate_valid_until?: number; // Mandate expiration timestamp
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
   */
  login_status?: 'success' | 'failed';
  
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
