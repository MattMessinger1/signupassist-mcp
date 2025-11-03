/**
 * Session Persistence Layer
 * Syncs AIOrchestrator context to Supabase agentic_checkout_sessions table
 */

import { createClient } from '@supabase/supabase-js';
import type { SessionContext } from '../types.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.SB_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[SessionPersistence] Supabase credentials not configured - session persistence disabled');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

/**
 * Load session context from Supabase
 */
export async function loadSessionFromDB(sessionId: string, userId?: string): Promise<SessionContext | null> {
  if (!supabase) return null;

  try {
    const query = supabase
      .from('agentic_checkout_sessions')
      .select('state, user_id')
      .eq('id', sessionId);
    
    // If we have userId, filter by it
    if (userId) {
      query.eq('user_id', userId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('[SessionPersistence] Load error:', error);
      return null;
    }

    if (!data) {
      console.log('[SessionPersistence] No session found for', sessionId);
      return null;
    }

    console.log('[SessionPersistence] Loaded session from DB:', sessionId);
    return (data.state as SessionContext) || {};
  } catch (err) {
    console.error('[SessionPersistence] Unexpected load error:', err);
    return null;
  }
}

/**
 * Save session context to Supabase
 */
export async function saveSessionToDB(
  sessionId: string, 
  context: SessionContext, 
  userId?: string
): Promise<void> {
  if (!supabase) return;

  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour TTL

    const { error } = await supabase
      .from('agentic_checkout_sessions')
      .upsert({
        id: sessionId,
        provider_id: context.provider?.orgRef || 'unknown',
        user_id: userId || null,
        state: context,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('[SessionPersistence] Save error:', error);
    } else {
      console.log('[SessionPersistence] Saved session to DB:', sessionId);
    }
  } catch (err) {
    console.error('[SessionPersistence] Unexpected save error:', err);
  }
}

/**
 * Delete expired sessions (called by cron job or manually)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  if (!supabase) return 0;

  try {
    const { error } = await supabase.rpc('cleanup_expired_checkout_sessions');
    
    if (error) {
      console.error('[SessionPersistence] Cleanup error:', error);
      return 0;
    }

    console.log('[SessionPersistence] Cleaned up expired sessions');
    return 1;
  } catch (err) {
    console.error('[SessionPersistence] Unexpected cleanup error:', err);
    return 0;
  }
}
