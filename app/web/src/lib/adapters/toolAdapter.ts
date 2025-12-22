/**
 * MCP Tool Adapter
 * Typed wrapper for window.openai.callTool with error handling
 */

export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Call an MCP tool with type safety and error handling
 */
export async function callMCPTool<T = any>(
  toolName: string,
  args: Record<string, any> = {}
): Promise<ToolResult<T>> {
  if (!window.openai?.callTool) {
    return { success: false, error: 'MCP not available - window.openai.callTool is undefined' };
  }
  
  try {
    const result = await window.openai.callTool(toolName, args);
    return { success: true, data: result as T };
  } catch (error: any) {
    console.error(`[toolAdapter] ${toolName} failed:`, error);
    return { success: false, error: error?.message || 'Tool call failed' };
  }
}

// ============ Typed Tool Interfaces ============

export interface StripeCheckoutResult {
  url: string;
  session_id: string;
  customer_id?: string;
}

export interface StripePaymentStatus {
  hasPaymentMethod: boolean;
  last4?: string;
  brand?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: {
    id: string;
    email?: string;
  };
}

export interface MandateResult {
  mandate_jws: string;
  mandate_id: string;
  expires_at: string;
}

export interface ProgramSearchResult {
  programs: any[];
  total: number;
}

export interface RegistrationResult {
  success: boolean;
  confirmation_number?: string;
  error?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface AuditTrailResult {
  events: AuditEvent[];
  count: number;
}

export type AuditEventType = 
  | 'form_started' 
  | 'delegate_submitted' 
  | 'participants_submitted' 
  | 'consent_given' 
  | 'payment_authorized' 
  | 'registration_completed'
  | 'registration_cancelled';

// ============ Typed Tool Calls ============

export const tools = {
  stripe: {
    /**
     * Create a Stripe checkout session for payment setup
     */
    createCheckoutSession: (args: { user_id: string; program_ref?: string; return_url?: string }) =>
      callMCPTool<StripeCheckoutResult>('stripe.create_checkout_session', args),
    
    /**
     * Check if user has a payment method on file
     */
    checkPaymentStatus: (args: { user_id: string }) =>
      callMCPTool<StripePaymentStatus>('stripe.check_payment_status', args),
    
    /**
     * Charge the success fee after successful registration
     */
    chargeSuccessFee: (args: { booking_number: string; mandate_id: string; amount_cents: number; user_id: string }) =>
      callMCPTool<{ charge_id: string; amount_cents: number }>('stripe.charge_success_fee', args),
    
    /**
     * Refund the success fee when registration is cancelled
     */
    refundSuccessFee: (args: { charge_id: string; reason?: string }) =>
      callMCPTool<{ refund_id: string; amount_refunded_cents: number }>('stripe.refund_success_fee', args),
  },
  
  auth: {
    /**
     * Check current authentication status
     */
    checkAuth: () =>
      callMCPTool<AuthStatus>('user.check_auth', {}),
    
    /**
     * Send OTP to email for authentication
     */
    sendOtp: (email: string) =>
      callMCPTool<{ sent: boolean }>('auth.send_otp', { email }),
    
    /**
     * Verify OTP code
     */
    verifyOtp: (email: string, code: string) =>
      callMCPTool<{ verified: boolean; user?: any }>('auth.verify_otp', { email, code }),
  },
  
  mandate: {
    /**
     * Issue a new mandate for scheduled registration
     */
    issue: (args: {
      program_ref: string;
      child_id: string;
      max_amount_cents: number;
      valid_until: string;
      scope: string[];
    }) =>
      callMCPTool<MandateResult>('mandate.issue', args),
    
    /**
     * Revoke an existing mandate
     */
    revoke: (mandateId: string) =>
      callMCPTool<{ revoked: boolean }>('mandate.revoke', { mandate_id: mandateId }),
    
    /**
     * Log an audit event at a form step
     */
    logAuditEvent: (args: {
      event_type: AuditEventType;
      mandate_id?: string;
      user_id?: string;
      metadata?: Record<string, any>;
    }) =>
      callMCPTool<{ event_type: string; logged: boolean }>('mandates.log_audit_event', args),
    
    /**
     * Get audit trail for a mandate or user
     */
    getAuditTrail: (args: { mandate_id?: string; user_id?: string; limit?: number }) =>
      callMCPTool<AuditTrailResult>('mandates.get_audit_trail', args),
    
    /**
     * Prepare registration (creates mandate, validates data)
     */
    prepareRegistration: (args: {
      user_id: string;
      delegate: Record<string, any>;
      participants: any[];
      program_ref: string;
      org_ref: string;
      provider?: string;
      total_amount_cents: number;
    }) =>
      callMCPTool<{ mandate_id: string; mandate_jws: string; ready_for_payment: boolean }>('mandates.prepare_registration', args),
    
    /**
     * Submit final registration after payment
     */
    submitRegistration: (args: {
      user_id: string;
      mandate_id: string;
      delegate: Record<string, any>;
      participants: any[];
      program_ref: string;
      org_ref: string;
      provider?: string;
    }) =>
      callMCPTool<{ confirmation_number: string; registration_id: string }>('mandates.submit_registration', args),
  },
  
  registration: {
    /**
     * Find available programs
     */
    findPrograms: (args: { org_ref?: string; category?: string; search?: string }) =>
      callMCPTool<ProgramSearchResult>('find_programs', args),
    
    /**
     * Discover required fields for a program
     */
    discoverFields: (programRef: string) =>
      callMCPTool<{ fields: any[]; schema: any }>('discover_required_fields', { program_ref: programRef }),
    
    /**
     * List user's registrations
     */
    list: (args: { user_id: string; category?: 'upcoming' | 'scheduled' | 'past' | 'all' }) =>
      callMCPTool<{ upcoming: any[]; scheduled: any[]; past: any[]; payment_method?: any }>('registrations.list', args),
    
    /**
     * Cancel a scheduled registration
     */
    cancel: (args: { registration_id: string; user_id: string }) =>
      callMCPTool<{ cancelled: boolean; registration_id: string }>('registrations.cancel', args),
    
    /**
     * Cancel confirmed registration with refund
     */
    cancelWithRefund: (args: { registration_id: string; user_id: string; reason?: string }) =>
      callMCPTool<{ cancelled: boolean; refunded: boolean; refund_id?: string }>('registrations.cancel_with_refund', args),
    
    /**
     * Modify a registration
     */
    modify: (args: { registration_id: string; user_id: string; new_program_ref: string; new_start_date?: string; new_participants?: string[] }) =>
      callMCPTool<{ modified: boolean; new_registration_id?: string; old_registration_id: string }>('registrations.modify', args),
  },
  
  provider: {
    /**
     * Check if user has credentials for a provider
     */
    checkCredentials: (provider: string) =>
      callMCPTool<{ hasCredentials: boolean; alias?: string }>('provider.check_credentials', { provider }),
    
    /**
     * Start provider login flow (opens browser)
     */
    startLogin: (provider: string) =>
      callMCPTool<{ session_id: string; login_url?: string }>('provider.start_login', { provider }),
    
    /**
     * Check login status
     */
    checkLoginStatus: (sessionId: string) =>
      callMCPTool<{ complete: boolean; success?: boolean }>('provider.check_login_status', { session_id: sessionId }),
  },
};

// ============ Convenience Functions ============

/**
 * Wait for payment method to be set up (with polling)
 */
export async function waitForPaymentMethod(
  userId: string,
  maxAttempts = 60,
  intervalMs = 3000
): Promise<ToolResult<StripePaymentStatus>> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await tools.stripe.checkPaymentStatus({ user_id: userId });
    
    if (result.success && result.data?.hasPaymentMethod) {
      return result;
    }
    
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  return { success: false, error: 'Payment method verification timed out' };
}

/**
 * Wait for provider login to complete
 */
export async function waitForProviderLogin(
  sessionId: string,
  maxAttempts = 60,
  intervalMs = 3000
): Promise<ToolResult<{ complete: boolean; success?: boolean }>> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await tools.provider.checkLoginStatus(sessionId);
    
    if (result.success && result.data?.complete) {
      return result;
    }
    
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  return { success: false, error: 'Provider login verification timed out' };
}
