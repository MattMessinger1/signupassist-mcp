/**
 * Shared types for all MCP providers
 */

/**
 * Standard response format for all provider tools
 * This ensures consistent login_status reporting across all providers
 * (SkiClubPro, Shopify, Jackrabbit, etc.)
 */
export interface ProviderResponse<T = any> {
  /**
   * Status of the provider login attempt
   * - 'success': Provider login succeeded
   * - 'failed': Provider login failed or could not be verified
   * 
   * NOTE: This is independent of the app's Supabase session state.
   * Always check login_status to know if the provider login succeeded.
   */
  login_status: 'success' | 'failed';
  
  /**
   * The actual data returned by the provider tool (if successful)
   */
  data?: T;
  
  /**
   * Error message (if login or operation failed)
   */
  error?: string;
  
  /**
   * Timestamp of the operation
   */
  timestamp?: string;
}
