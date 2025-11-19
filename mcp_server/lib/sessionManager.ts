/**
 * Session Manager for MCP Tools
 * Manages short-lived Browserbase sessions with optional reuse
 */

import { launchBrowserbaseSession, closeBrowserbaseSession, BrowserbaseSession } from './browserbase-skiclubpro.js';
import { isAuthenticated } from '../providers/blackhawk/login.js';
import { telemetry } from './telemetry.js';

type ManagedSession = {
  session: BrowserbaseSession;
  expiresAt: number;
  statePath?: string; // FIX 3: Store path to Playwright storageState for proper auth
};

const sessions = new Map<string, ManagedSession>();

// Environment configuration
const SESSION_CACHE_ENABLED = process.env.SESSION_CACHE_ENABLED === 'true';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '300000'); // 5 min default

console.log(`[SessionManager] Caching: ${SESSION_CACHE_ENABLED ? 'ENABLED' : 'DISABLED'}, TTL: ${SESSION_TTL_MS}ms`);

/**
 * Get a session - either reuse existing or create new
 * Returns session, token, and statePath for optional chaining, or null if caching disabled
 * Verifies authentication status before reusing cached sessions
 */
export async function getSession(token?: string): Promise<{ session: BrowserbaseSession; newToken: string; statePath?: string } | null> {
  if (!SESSION_CACHE_ENABLED) {
    console.log('[SessionManager] Session caching disabled, skipping reuse');
    telemetry.record('session_cache', { action: 'disabled' });
    return null;
  }
  
  if (!token) {
    console.log('[SessionManager] No token provided, cannot reuse');
    return null;
  }

  const managed = sessions.get(token);
  if (!managed || Date.now() > managed.expiresAt) {
    if (managed) {
      console.log('[SessionManager] Session expired, removing from cache');
      telemetry.record('session_cache', { action: 'expired', token });
    }
    sessions.delete(token);
    return null;
  }
  
  // Verify the cached session is still authenticated
  try {
    const authenticated = await isAuthenticated(managed.session.page);
    if (!authenticated) {
      console.log('[SessionManager] ❌ Cached session no longer authenticated, invalidating');
      telemetry.record('session_cache', { action: 'auth_failed', token });
      await releaseSession(token, managed.session);
      return null;
    }
  } catch (err: any) {
    console.error('[SessionManager] ⚠️ Error checking authentication, invalidating session:', err.message);
    telemetry.record('session_cache', { action: 'auth_check_error', error: err.message });
    await releaseSession(token, managed.session);
    return null;
  }
  
  console.log('[SessionManager] ✅ Reusing authenticated session:', token);
  telemetry.record('session_cache', { action: 'reused', token });
  return { session: managed.session, newToken: token, statePath: managed.statePath };
}

/**
 * Release a session and close browser
 */
export async function releaseSession(token: string, session: BrowserbaseSession) {
  try {
    await closeBrowserbaseSession(session);
  } catch (error) {
    console.error('[SessionManager] Error closing session:', error);
  }
  sessions.delete(token);
}

/**
 * Store session for potential reuse (uses configured TTL)
 * FIX 3: Support storing storageState path for auth preservation
 */
export function storeSession(token: string, session: BrowserbaseSession, ttlMs = SESSION_TTL_MS, statePath?: string): string {
  if (!SESSION_CACHE_ENABLED) {
    console.log('[SessionManager] Session caching disabled, not storing');
    telemetry.record('session_cache', { action: 'store_disabled' });
    return token;
  }
  
  sessions.set(token, { 
    session, 
    expiresAt: Date.now() + ttlMs,
    statePath
  });
  console.log('[SessionManager] 📦 Stored session:', token, 'expires in', ttlMs, 'ms');
  telemetry.record('session_cache', { action: 'stored', token, ttl_ms: ttlMs });
  return token;
}

/**
 * Generate random session token
 */
export function generateToken(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Refresh session TTL to keep active sessions alive
 */
export function refreshSession(token: string, additionalTtlMs = SESSION_TTL_MS): boolean {
  if (!SESSION_CACHE_ENABLED) {
    return false;
  }
  
  const managed = sessions.get(token);
  if (!managed) {
    console.log('[SessionManager] Cannot refresh - session not found:', token);
    return false;
  }
  
  managed.expiresAt = Date.now() + additionalTtlMs;
  console.log('[SessionManager] 🔄 Refreshed session:', token, 'new expiry in', additionalTtlMs, 'ms');
  return true;
}

/**
 * Clean up expired sessions periodically
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, managed] of sessions.entries()) {
    if (now > managed.expiresAt) {
      console.log('[SessionManager] 🗑️ Cleaning up expired session:', token);
      sessions.delete(token);
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupExpiredSessions, 30000);
