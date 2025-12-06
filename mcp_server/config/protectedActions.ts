/**
 * Protected Actions Configuration
 * 
 * Single source of truth for action authentication requirements.
 * Used by both server-side middleware and frontend fallback.
 * 
 * This supports ChatGPT App Store compliance where OAuth is triggered
 * lazily only when a user invokes a protected action.
 */

/**
 * Actions that require authentication (user must be logged in)
 * ChatGPT SDK will prompt OAuth consent before executing these
 */
export const PROTECTED_ACTIONS = [
  // Payment & Registration
  'confirm_registration',
  'confirm_payment',
  'setup_payment_method',
  'save_payment_method',
  'confirm_auto_registration',
  
  // User Data Access
  'view_receipts',
  'view_audit_trail',
  'cancel_registration',
  
  // Profile Management
  'load_saved_children',
  'save_child',
  'load_delegate_profile',
  'update_delegate_profile',
  'check_payment_method',
] as const;

/**
 * Actions that are public and don't require authentication
 * Users can browse and explore without logging in
 */
export const PUBLIC_ACTIONS = [
  // Discovery & Browsing
  'browse_programs',
  'search_programs',
  'select_program',
  'view_program_details',
  
  // Provider Confirmation
  'confirm_provider',
  'deny_provider',
  'show_alternatives',
  
  // Form Interaction (data is local until submit)
  'submit_form',
] as const;

export type ProtectedAction = typeof PROTECTED_ACTIONS[number];
export type PublicAction = typeof PUBLIC_ACTIONS[number];

/**
 * Check if an action requires authentication
 * @param action - The action identifier to check
 * @returns true if the action requires authentication
 */
export function isProtectedAction(action: string): boolean {
  return (PROTECTED_ACTIONS as readonly string[]).includes(action);
}

/**
 * Check if an action is explicitly public
 * @param action - The action identifier to check
 * @returns true if the action is public
 */
export function isPublicAction(action: string): boolean {
  return (PUBLIC_ACTIONS as readonly string[]).includes(action);
}

/**
 * Get authentication requirement for an action
 * @param action - The action identifier
 * @returns 'protected' | 'public' | 'unknown'
 */
export function getActionAuthRequirement(action: string): 'protected' | 'public' | 'unknown' {
  if (isProtectedAction(action)) return 'protected';
  if (isPublicAction(action)) return 'public';
  return 'unknown';
}
