import type { Page, Browser } from 'playwright-core';
import { loginWithCredentials } from '../../lib/login.js';
import { skiClubProConfig } from '../../config/skiclubproConfig.js';
import type { SkiClubProCredentials } from '../../lib/credentials.js';

/**
 * Check if the current session is authenticated by detecting
 * a dashboard-only selector. SkiClubPro hides programs unless logged in.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  console.log('[Auth Check] Starting authentication verification...');
  console.log('[Auth Check] Current URL:', page.url());
  
  // Try multiple authentication indicators
  const indicators = [
    'a:has-text("Logout")',
    'a:has-text("Log out")',
    'text=/Welcome,.*!/i',
    'nav a[href*="/dashboard"]',
    'nav:has-text("ACCOUNT")',
    'a[href*="/user/"][href*="logout"]'
  ];

  for (const selector of indicators) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      console.log(`[Auth Check] ✅ Found authentication indicator: ${selector}`);
      return true;
    } catch (_) {
      console.log(`[Auth Check] ⏭️ Indicator not found: ${selector}`);
    }
  }

  // Fallback: Check for authentication cookies WITH DETAILED LOGGING
  try {
    const cookies = await page.context().cookies();
    console.log(`[Auth Check] 🍪 Found ${cookies.length} total cookies`);
    
    // Log all cookie names for debugging
    if (cookies.length > 0) {
      const cookieNames = cookies.map(c => c.name).join(', ');
      console.log(`[Auth Check] 🍪 Cookie names: ${cookieNames}`);
    }
    
    const authCookie = cookies.find(c => 
      c.name.includes('SESS') || 
      c.name.includes('session') ||
      c.name.includes('auth')
    );
    
    if (authCookie) {
      console.log(`[Auth Check] ✅ Found authentication cookie: ${authCookie.name}=${authCookie.value.substring(0, 20)}...`);
      return true;
    } else {
      console.log(`[Auth Check] ❌ No authentication cookie found among ${cookies.length} cookies`);
    }
  } catch (cookieErr) {
    console.log('[Auth Check] ⚠️ Error checking cookies:', cookieErr);
  }

  console.log('[Auth Check] ❌ No authentication indicators found');
  return false;
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
    const loginResult = await loginWithCredentials(page, skiClubProConfig, credentials, browser, `${baseUrl}/registration`);
    
    if (loginResult.login_status !== 'success') {
      return { success: false, error: 'Login failed for service credentials' };
    }
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
