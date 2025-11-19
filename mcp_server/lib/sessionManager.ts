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
 * Clean up expired sessions periodically and close them via Browserbase API
 */
export async function cleanupExpiredSessions() {
  const now = Date.now();
  const expiredSessions: Array<{ token: string; session: BrowserbaseSession }> = [];
  
  for (const [token, managed] of sessions.entries()) {
    if (now > managed.expiresAt) {
      console.log('[SessionManager] 🗑️ Cleaning up expired session:', token);
      expiredSessions.push({ token, session: managed.session });
    }
  }
  
  // Close expired sessions via Browserbase API
  for (const { token, session } of expiredSessions) {
    try {
      await closeBrowserbaseSession(session);
      telemetry.record('session_cleanup', { action: 'closed_expired', token });
      console.log('[SessionManager] ✅ Closed expired session via Browserbase API:', token);
    } catch (error) {
      console.error('[SessionManager] ⚠️ Error closing expired session:', token, error);
      telemetry.record('session_cleanup', { action: 'close_error', token, error: error instanceof Error ? error.message : 'Unknown' });
    }
    sessions.delete(token);
  }
}

/**
 * Log session inventory for debugging
 */
export function logSessionInventory() {
  const now = Date.now();
  const activeSessions = Array.from(sessions.entries()).map(([token, managed]) => ({
    token,
    expiresIn: Math.max(0, managed.expiresAt - now),
    hasStatePath: !!managed.statePath,
  }));
  
  console.log('[SessionManager] 📊 Session Inventory:', {
    count: activeSessions.length,
    sessions: activeSessions,
  });
  telemetry.record('session_inventory', { count: activeSessions.length });
}

/**
 * Close all cached sessions (for graceful shutdown)
 */
export async function closeAllSessions() {
  console.log('[SessionManager] 🛑 Closing all cached sessions for shutdown...');
  const allSessions = Array.from(sessions.entries());
  
  for (const [token, managed] of allSessions) {
    try {
      await closeBrowserbaseSession(managed.session);
      console.log('[SessionManager] ✅ Closed session on shutdown:', token);
    } catch (error) {
      console.error('[SessionManager] ⚠️ Error closing session on shutdown:', token, error);
    }
  }
  
  sessions.clear();
  console.log('[SessionManager] ✅ All sessions closed');
}

// Run cleanup every 30 seconds (async version)
setInterval(() => {
  cleanupExpiredSessions().catch(err => {
    console.error('[SessionManager] Error in periodic cleanup:', err);
  });
}, 30000);

// Log session inventory every 5 minutes
setInterval(logSessionInventory, 300000);
