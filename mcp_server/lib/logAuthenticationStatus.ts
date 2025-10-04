/**
 * Helper to log authentication verification status to execution_logs
 */

export interface AuthStatusLogParams {
  planId: string;
  verified: boolean;
  message?: string;
  url?: string;
  attemptNumber?: number;
}

/**
 * Log authentication verification status
 * This creates execution logs that the frontend can subscribe to via Realtime
 */
export async function logAuthenticationStatus(
  supabase: any,
  params: AuthStatusLogParams
): Promise<void> {
  const { planId, verified, message, url, attemptNumber = 1 } = params;
  
  const logMessage = verified 
    ? 'Authenticated session verified ✅' 
    : message || 'Login verification failed ❌';
  
  const metadata = {
    verified,
    url,
    timestamp: new Date().toISOString(),
    ...(verified && { authentication_success: true })
  };

  try {
    const { error } = await supabase.rpc('insert_execution_log', {
      p_correlation_id: crypto.randomUUID(),
      p_plan_id: planId,
      p_stage: 'login',
      p_status: verified ? 'success' : 'failed',
      p_attempt: attemptNumber,
      p_error_message: logMessage,
      p_metadata: metadata
    });

    if (error) {
      console.error('[logAuthenticationStatus] Failed to log auth status:', error);
    } else {
      console.log(`[logAuthenticationStatus] Logged: ${logMessage}`);
    }
  } catch (err) {
    console.error('[logAuthenticationStatus] Error:', err);
  }
}
