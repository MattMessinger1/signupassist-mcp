/**
 * Production Audit Logger
 * Logs all user actions to mandate_audit table for compliance and transparency
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.SB_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[AuditLogger] Supabase credentials not configured - audit logging disabled');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface AuditLogEntry {
  user_id: string;
  action: string;
  provider?: string;
  org_ref?: string;
  program_ref?: string;
  credential_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an action to the mandate_audit table
 * Safe to call even if Supabase is not configured (logs to console only)
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  console.log('[AuditLogger]', entry);

  if (!supabase) {
    console.warn('[AuditLogger] Supabase not configured, skipping database insert');
    return;
  }

  try {
    const { error } = await supabase
      .from('mandate_audit')
      .insert({
        user_id: entry.user_id,
        action: entry.action,
        provider: entry.provider,
        org_ref: entry.org_ref,
        program_ref: entry.program_ref,
        credential_id: entry.credential_id,
        metadata: entry.metadata || {}
      });

    if (error) {
      console.error('[AuditLogger] Failed to insert audit log:', error);
    }
  } catch (err) {
    console.error('[AuditLogger] Unexpected error:', err);
  }
}

/**
 * Helper to extract user_id from JWT token
 */
export function extractUserIdFromJWT(jwt?: string): string | null {
  if (!jwt) return null;
  
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}
