import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Structured error payload for execution_logs
 */
export interface StructuredErrorPayload {
  correlationId?: string;
  stage: string;
  error: string;
  plan_id?: string;
  plan_execution_id?: string;
  child_id?: string;
  mandate_id?: string;
  credential_id?: string;
  attempt?: number;
  [key: string]: any;
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
 * Error code → parent-friendly message mapping
 * Maps technical errors to actionable, warm messages for parents
 */
const ERROR_MESSAGES: Record<string, ParentFriendlyError> = {
  'LOGIN_EXPIRED': {
    display: "Looks like your provider login expired.",
    recovery: "Let's reconnect securely. Click 'Reconnect Account' below.",
    severity: 'medium',
    code: 'LOGIN_EXPIRED'
  },
  'PAYMENT_DECLINED': {
    display: "The payment method was declined.",
    recovery: "Please check your card details or try a different payment method.",
    severity: 'high',
    code: 'PAYMENT_DECLINED'
  },
  'PROGRAM_FULL': {
    display: "This program is currently full.",
    recovery: "Would you like to join the waitlist or see similar programs?",
    severity: 'medium',
    code: 'PROGRAM_FULL'
  },
  'NETWORK_ERROR': {
    display: "Couldn't connect to the provider.",
    recovery: "Please check your internet connection and try again.",
    severity: 'low',
    code: 'NETWORK_ERROR'
  },
  'INVALID_CREDENTIALS': {
    display: "Those login credentials didn't work.",
    recovery: "Please double-check your username and password, then try again.",
    severity: 'medium',
    code: 'INVALID_CREDENTIALS'
  },
  'SESSION_TIMEOUT': {
    display: "Your session timed out.",
    recovery: "Let's start fresh. Click 'Retry' to continue.",
    severity: 'low',
    code: 'SESSION_TIMEOUT'
  },
  'MISSING_PREREQUISITES': {
    display: "A few prerequisites need to be completed first.",
    recovery: "I'll walk you through each one. Let's start now.",
    severity: 'medium',
    code: 'MISSING_PREREQUISITES'
  }
};

/**
 * Maps technical errors to parent-friendly messages
 * @param error - The error object or string
 * @param errorCode - Optional error code for specific mapping
 * @returns Parent-friendly error with actionable recovery steps
 */
export function mapToParentFriendlyError(error: unknown, errorCode?: string): ParentFriendlyError {
  // Try to match error code
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    return ERROR_MESSAGES[errorCode];
  }
  
  // Try to extract error code from error message
  if (error instanceof Error) {
    const message = error.message.toUpperCase();
    for (const [code, friendlyError] of Object.entries(ERROR_MESSAGES)) {
      if (message.includes(code)) {
        return friendlyError;
      }
    }
  }
  
  // Fall back to generic friendly error
  return {
    display: "Something unexpected happened.",
    recovery: "Let's try that again. If this keeps happening, please contact support.",
    severity: 'medium',
    code: 'UNKNOWN_ERROR'
  };
}

/**
 * Logs a structured error to Supabase execution_logs using RPC
 */
export async function logStructuredError(
  supabaseClient: SupabaseClient,
  payload: StructuredErrorPayload
): Promise<void> {
  try {
    // Use RPC function for better control
    const { error } = await supabaseClient.rpc('insert_execution_log', {
      p_correlation_id: payload.correlationId || crypto.randomUUID(),
      p_plan_id: payload.plan_id || null,
      p_plan_execution_id: payload.plan_execution_id || null,
      p_mandate_id: payload.mandate_id || null,
      p_stage: payload.stage,
      p_status: 'failed',
      p_attempt: payload.attempt || 1,
      p_error_message: payload.error,
      p_metadata: {
        ...payload,
        timestamp: new Date().toISOString()
      }
    });

    if (error) {
      console.error('Failed to log structured error:', error);
    }
  } catch (err) {
    // Don't throw - logging failures shouldn't break the main flow
    console.error('Exception while logging structured error:', err);
  }
}

/**
 * Sanitizes error messages to prevent stack trace leakage
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Return only the message, not the stack
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}
