import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Structured error payload for execution_logs
 */
export interface StructuredErrorPayload {
  stage: string;
  error: string;
  plan_id?: string;
  child_id?: string;
  mandate_id?: string;
  credential_id?: string;
  [key: string]: any;
}

/**
 * Logs a structured error to Supabase execution_logs
 */
export async function logStructuredError(
  supabaseClient: SupabaseClient,
  payload: StructuredErrorPayload
): Promise<void> {
  try {
    const { error } = await supabaseClient
      .from('execution_logs')
      .insert({
        stage: payload.stage,
        error_message: payload.error,
        metadata: payload,
        created_at: new Date().toISOString()
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
