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
