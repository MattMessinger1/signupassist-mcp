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

// ============ Typed Tool Calls ============

export const tools = {
  stripe: {
    /**
     * Create a Stripe checkout session for payment setup
     */
    createCheckoutSession: (args: { program_ref?: string; return_url?: string }) =>
      callMCPTool<StripeCheckoutResult>('stripe.create_checkout_session', args),
    
    /**
     * Check if user has a payment method on file
     */
    checkPaymentStatus: () =>
      callMCPTool<StripePaymentStatus>('stripe.check_payment_status', {}),
    
    /**
     * Charge the success fee after successful registration
     */
    chargeSuccessFee: (args: { mandate_id: string; amount_cents: number }) =>
      callMCPTool<{ charged: boolean; payment_intent?: string }>('stripe.charge_success_fee', args),
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
     * Prepare registration (validate data, check prerequisites)
     */
    prepare: (args: {
      program_ref: string;
      delegate_data: Record<string, any>;
      participant_data: Record<string, any>[];
    }) =>
      callMCPTool<{ ready: boolean; issues?: string[] }>('prepare_registration', args),
    
    /**
     * Submit the registration
     */
    submit: (args: {
      program_ref: string;
      delegate_data: Record<string, any>;
      participant_data: Record<string, any>[];
      mandate_id?: string;
    }) =>
      callMCPTool<RegistrationResult>('submit_registration', args),
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
  maxAttempts = 60,
  intervalMs = 3000
): Promise<ToolResult<StripePaymentStatus>> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await tools.stripe.checkPaymentStatus();
    
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
