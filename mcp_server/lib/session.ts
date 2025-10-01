/**
 * Session state management for browser automation
 * Feature-flagged via SESSION_CACHE_ENABLED environment variable
 */

import type { Page } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SESSION_CACHE_ENABLED = process.env.SESSION_CACHE_ENABLED === 'true';

interface SessionState {
  cookies: any[];
  localStorage?: Record<string, string>;
  timestamp: string;
}

/**
 * Save session state (cookies and localStorage) to database
 */
export async function saveSessionState(page: Page, sessionKey: string): Promise<void> {
  if (!SESSION_CACHE_ENABLED) {
    console.log('DEBUG: Session caching disabled, skipping save');
    return;
  }

  try {
    console.log(`DEBUG: Saving session state for key: ${sessionKey}`);
    
    // Get cookies from browser context
    const cookies = await page.context().cookies();
    
    // Get localStorage (optional - may not be available in all contexts)
    let localStorage: Record<string, string> = {};
    try {
      localStorage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            items[key] = window.localStorage.getItem(key) || '';
          }
        }
        return items;
      });
    } catch (e) {
      console.log('DEBUG: Could not access localStorage:', e);
    }

    const sessionState: SessionState = {
      cookies,
      localStorage,
      timestamp: new Date().toISOString()
    };

    // Store in database with 24hr expiry
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await supabase
      .from('browser_sessions')
      .upsert({
        session_key: sessionKey,
        session_data: sessionState,
        expires_at: expiresAt.toISOString()
      });

    console.log(`DEBUG: ✓ Session state saved (${cookies.length} cookies)`);
  } catch (error) {
    console.error('DEBUG: Failed to save session state:', error);
    // Non-fatal - continue without caching
  }
}

/**
 * Restore session state (cookies and localStorage) from database
 * Returns true if session was restored, false otherwise
 */
export async function restoreSessionState(page: Page, sessionKey: string): Promise<boolean> {
  if (!SESSION_CACHE_ENABLED) {
    console.log('DEBUG: Session caching disabled, skipping restore');
    return false;
  }

  try {
    console.log(`DEBUG: Attempting to restore session for key: ${sessionKey}`);
    
    // Fetch from database
    const { data, error } = await supabase
      .from('browser_sessions')
      .select('session_data, expires_at')
      .eq('session_key', sessionKey)
      .single();

    if (error || !data) {
      console.log('DEBUG: No cached session found');
      return false;
    }

    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      console.log('DEBUG: Cached session expired, cleaning up');
      await supabase
        .from('browser_sessions')
        .delete()
        .eq('session_key', sessionKey);
      return false;
    }

    const sessionState = data.session_data as SessionState;
    
    // Restore cookies
    if (sessionState.cookies && sessionState.cookies.length > 0) {
      await page.context().addCookies(sessionState.cookies);
      console.log(`DEBUG: ✓ Restored ${sessionState.cookies.length} cookies`);
    }

    // Restore localStorage (optional)
    if (sessionState.localStorage) {
      try {
        await page.evaluate((items) => {
          Object.entries(items).forEach(([key, value]) => {
            window.localStorage.setItem(key, value);
          });
        }, sessionState.localStorage);
        console.log(`DEBUG: ✓ Restored ${Object.keys(sessionState.localStorage).length} localStorage items`);
      } catch (e) {
        console.log('DEBUG: Could not restore localStorage:', e);
      }
    }

    console.log(`DEBUG: ✓ Session restored (cached at ${sessionState.timestamp})`);
    return true;
  } catch (error) {
    console.error('DEBUG: Failed to restore session state:', error);
    return false;
  }
}

/**
 * Clear cached session for a given key
 */
export async function clearSessionState(sessionKey: string): Promise<void> {
  if (!SESSION_CACHE_ENABLED) {
    return;
  }

  try {
    await supabase
      .from('browser_sessions')
      .delete()
      .eq('session_key', sessionKey);
    console.log(`DEBUG: ✓ Cleared cached session for key: ${sessionKey}`);
  } catch (error) {
    console.error('DEBUG: Failed to clear session state:', error);
  }
}

/**
 * Generate a session key based on user/credential/org
 */
export function generateSessionKey(userId: string, credentialId: string, orgRef: string): string {
  return `session:${userId}:${credentialId}:${orgRef}`;
}
