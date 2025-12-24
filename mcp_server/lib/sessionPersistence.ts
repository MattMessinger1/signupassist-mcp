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
    console.log(`[sessionPersistence] Loading session ${sessionId}...`);
    
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

    console.log('[SessionPersistence] Loaded session from DB:', sessionId, 'Context:', JSON.stringify(data.state, null, 2));
    return (data.state as SessionContext) || {};
  } catch (err) {
    console.error('[SessionPersistence] Unexpected load error:', err);
    return null;
  }
}

/**
 * V1 Guardrail: Never revert step after FORM_FILL (single source of truth)
 * FIX 2: Enforce invariant at persistence boundary
 */
function guardStep(prevStep?: string | number, nextStep?: string | number): string | number | undefined {
  const prev = String(prevStep);
  const next = String(nextStep);
  if (prev === "FORM_FILL" && next === "BROWSE") return "FORM_FILL";
  if (prev === "PAYMENT" && next === "BROWSE") return "PAYMENT";
  return nextStep;
}

/**
 * Save session context to Supabase
 * FIX 2: Enforces step invariant at persistence boundary
 */
export async function saveSessionToDB(
  sessionId: string, 
  context: SessionContext, 
  userId?: string,
  prevContext?: SessionContext
): Promise<void> {
  if (!supabase) return;

  try {
    console.log(`[sessionPersistence] Saving session ${sessionId}`);
    
    // FIX 2: Enforce invariant at persistence boundary
    if (prevContext?.step && context?.step) {
      const guardedStep = guardStep(prevContext.step, context.step);
      if (String(guardedStep) !== String(context.step)) {
        console.log(`[sessionPersistence] ⛔ FIX 2: Blocked step reversion from ${prevContext.step} to ${context.step}`);
        (context as any).step = guardedStep;
      }
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[sessionPersistence] Context snapshot (non-prod only) ${sessionId}:`, JSON.stringify(context, null, 2));
    }
    
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
      console.log(`[SessionPersistence] Saved session to DB: ${sessionId}`);
      
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[SessionPersistence] Saved context (non-prod only) ${sessionId}:`, JSON.stringify(context, null, 2));
      }
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
