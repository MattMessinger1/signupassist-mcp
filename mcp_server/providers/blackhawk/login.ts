import type { Page, Browser } from 'playwright-core';
import { loginWithCredentials } from '../../lib/login.js';
import { skiClubProConfig } from '../../config/skiclubproConfig.js';
import type { SkiClubProCredentials } from '../../lib/credentials.js';

/**
 * Check if the current session is authenticated by detecting
 * a dashboard-only selector. SkiClubPro hides programs unless logged in.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    // This selector appears only when logged in
    await page.waitForSelector('nav a[href*="/dashboard"]', {
      timeout: 1500
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Perform login with credentials
 */
export async function performLogin(
  page: Page,
  browser: Browser,
  baseUrl: string,
  credentials: SkiClubProCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    await page.goto(`${baseUrl}/user/login`, { waitUntil: 'networkidle' });
    const loginResult = await loginWithCredentials(page, skiClubProConfig, credentials, browser);
    
    if (loginResult.login_status !== 'success') {
      return { success: false, error: 'Login failed for service credentials' };
    }
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
