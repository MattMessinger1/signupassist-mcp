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
 * Back-compat action aliases (older clients / older ChatGPT button payloads).
 * IMPORTANT: HTTP auth gating happens *before* APIOrchestrator resolves aliases,
 * so we must resolve here too to avoid "ungated protected action via alias".
 */
export const ACTION_ALIASES: Record<string, string> = {
  // Old action names -> current OpenAPI enum actions
  confirm_booking: 'authorize_payment',
  cancel_booking: 'cancel_registration',
  answer_questions: 'submit_form',
  start_over: 'clear_context',
  show_more_programs: 'search_programs',
  back: 'clear_context',

  // Very old generic action names
  create_booking: 'confirm_payment',
  register: 'confirm_payment',
  pay: 'confirm_payment',
  confirm_auto_registration: 'confirm_scheduled_registration',
  save_payment_method: 'setup_payment_method',
};

export function resolveActionAlias(action: string): string {
  return ACTION_ALIASES[action] || action;
}

/**
 * Actions that require authentication (user must be logged in)
 * ChatGPT SDK will prompt OAuth consent before executing these
 */
export const PROTECTED_ACTIONS = [
  // Payment & Registration (current OpenAPI actions)
  'setup_payment_method',
  'setup_payment',
  'show_payment_authorization',
  'authorize_payment',
  'confirm_payment',
  'schedule_auto_registration',
  'confirm_scheduled_registration',
  
  // User Data Access
  'view_receipts',
  'view_audit_trail',
  'cancel_registration',
  'confirm_cancel_registration',
  
  // Profile Management
  'load_saved_children',
  'save_child',
  'load_delegate_profile',
  'save_delegate_profile',
  'check_payment_method',

  // Back-compat aliases (see ACTION_ALIASES)
  'confirm_booking',
  'cancel_booking',
  'create_booking',
  'register',
  'pay',
  'confirm_auto_registration',
  'save_payment_method',
] as const;

/**
 * Actions that are public and don't require authentication
 * Users can browse and explore without logging in
 */
export const PUBLIC_ACTIONS = [
  // Discovery & Browsing (current OpenAPI actions)
  'search_programs',
  'browse_all_programs',
  'clear_activity_filter',
  'show_out_of_area_programs',
  'select_program',
  
  // Provider Confirmation
  'confirm_provider',
  'deny_provider',
  
  // Form Interaction (data is local until submit)
  'submit_form',

  // Flow Control
  'cancel_flow',
  'clear_context',

  // Location confirmation can be used unauthenticated; it only persists if user is logged in.
  'save_location',

  // Back-compat aliases (see ACTION_ALIASES)
  'answer_questions',
  'start_over',
  'show_more_programs',
  'back',
] as const;

export type ProtectedAction = typeof PROTECTED_ACTIONS[number];
export type PublicAction = typeof PUBLIC_ACTIONS[number];

/**
 * Check if an action requires authentication
 * @param action - The action identifier to check
 * @returns true if the action requires authentication
 */
export function isProtectedAction(action: string): boolean {
  const resolved = resolveActionAlias(action);
  return (PROTECTED_ACTIONS as readonly string[]).includes(resolved) || (PROTECTED_ACTIONS as readonly string[]).includes(action);
}

/**
 * Check if an action is explicitly public
 * @param action - The action identifier to check
 * @returns true if the action is public
 */
export function isPublicAction(action: string): boolean {
  const resolved = resolveActionAlias(action);
  return (PUBLIC_ACTIONS as readonly string[]).includes(resolved) || (PUBLIC_ACTIONS as readonly string[]).includes(action);
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
