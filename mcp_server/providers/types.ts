/**
 * Shared types for all MCP providers
 */

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
 */
export interface ProviderResponse<T = any> {
  /**
   * Status of the provider operation
   * - 'success': Operation succeeded
   * - 'failed': Operation failed or could not be verified
   */
  login_status?: 'success' | 'failed'; // Legacy, kept for compatibility
  success: boolean;
  
  /**
   * The actual data returned by the provider tool (if successful)
   */
  data?: T;
  
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
   * Timestamp of the operation
   */
  timestamp?: string;
}
