/**
 * Session Manager for MCP Tools
 * Manages short-lived Browserbase sessions with optional reuse
 */

import { launchBrowserbaseSession, closeBrowserbaseSession, BrowserbaseSession } from './browserbase-skiclubpro.js';

type ManagedSession = {
  session: BrowserbaseSession;
  expiresAt: number;
};

const sessions = new Map<string, ManagedSession>();

/**
 * Get a session - either reuse existing or create new
 * Returns session and token for optional chaining
 */
export async function getSession(token?: string): Promise<{ session: BrowserbaseSession; newToken: string }> {
  if (!token) {
    const session = await launchBrowserbaseSession();
    const newToken = generateToken();
    return { session, newToken };
  }

  const managed = sessions.get(token);
  if (!managed || Date.now() > managed.expiresAt) {
    sessions.delete(token);
    const session = await launchBrowserbaseSession();
    const newToken = generateToken();
    return { session, newToken };
  }
  
  return { session: managed.session, newToken: token };
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
 * Store session for potential reuse (default 60s TTL)
 */
export function storeSession(token: string, session: BrowserbaseSession, ttlMs = 60000): string {
  sessions.set(token, { 
    session, 
    expiresAt: Date.now() + ttlMs 
  });
  return token;
}

/**
 * Generate random session token
 */
export function generateToken(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Clean up expired sessions periodically
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, managed] of sessions.entries()) {
    if (now > managed.expiresAt) {
      sessions.delete(token);
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupExpiredSessions, 30000);
