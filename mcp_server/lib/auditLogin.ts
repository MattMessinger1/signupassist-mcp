/**
 * Audit logging for provider login attempts
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseKey);

export interface LoginAuditDetails {
  login_strategy?: 'restore' | 'fresh' | 'hard_reset';
  
  // Verification outcome
  verified?: boolean;
  
  // Verification signals
  verification?: {
    url?: string;
    dom_check?: string;
    session_cookie?: boolean;
    hadLogoutUi?: boolean;  // Found logout link/user menu
    hadSessCookie?: boolean;  // Found Drupal SESS cookie
  };
  
  // Precise timing
  timing?: {
    started_at: string;  // ISO timestamp
    ended_at: string;    // ISO timestamp
    ms: number;          // Duration in milliseconds
  };
  
  // Session token presence indicator (not the actual token)
  session_token?: string;
  
  // Evidence metadata
  evidence?: {
    screenshot_path?: string;
    body_snippet?: string;
  };
  
  error?: string;
  duration_ms?: number;  // Backward compatibility
}

export interface StartLoginAuditParams {
  provider: string;
  org_ref?: string;
  tool?: string;
  mandate_id?: string;
  user_id?: string;
  login_strategy?: 'restore' | 'fresh' | 'hard_reset';
}

export interface FinishLoginAuditParams {
  audit_id: string;
  result: 'success' | 'failure';
  details?: LoginAuditDetails;
}

/**
 * Start logging a provider login attempt
 */
export async function startLoginAudit(params: StartLoginAuditParams): Promise<string> {
  const { provider, org_ref, tool, mandate_id, user_id, login_strategy } = params;

  const { data, error } = await supabase
    .from('audit_events')
    .insert({
      event_type: 'provider_login',
      provider,
      org_ref,
      tool,
      mandate_id,
      user_id,
      details: { login_strategy }
    })
    .select('id')
    .single();

  if (error) {
    console.error('[auditLogin] Failed to start audit:', error);
    throw error;
  }

  return data.id;
}

/**
 * Finish logging a provider login attempt
 */
export async function finishLoginAudit(params: FinishLoginAuditParams): Promise<void> {
  const { audit_id, result, details } = params;

  const { error } = await supabase
    .from('audit_events')
    .update({
      finished_at: new Date().toISOString(),
      result,
      details
    })
    .eq('id', audit_id);

  if (error) {
    console.error('[auditLogin] Failed to finish audit:', error);
    throw error;
  }
}

/**
 * Log a complete login attempt (start and finish in one call)
 */
export async function logLoginAttempt(
  params: StartLoginAuditParams & { result: 'success' | 'failure'; details?: LoginAuditDetails }
): Promise<void> {
  const { result, details, ...startParams } = params;
  
  const auditId = await startLoginAudit(startParams);
  await finishLoginAudit({ audit_id: auditId, result, details });
}
