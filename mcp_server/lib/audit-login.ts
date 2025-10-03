/**
 * Lightweight login audit helper
 * Records every login attempt to audit_events table
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function recordLoginAudit({
  user_id,
  provider,
  org_ref,
  tool,
  result,
  verification,
  error
}: {
  user_id?: string;
  provider: string;
  org_ref: string;
  tool: string;
  result: 'success' | 'failed';
  verification?: { url?: string; hadLogoutUi?: boolean; hadSessCookie?: boolean };
  error?: string;
}) {
  try {
    await supabaseAdmin.from('audit_events').insert([{
      event_type: 'provider_login',
      provider,
      org_ref,
      tool,
      user_id: user_id ?? null,
      result,
      details: { verification, error }
    }]);
  } catch (err) {
    console.error('[audit-login] Failed to record login audit:', err);
    // Don't throw - audit failure shouldn't break the flow
  }
}
