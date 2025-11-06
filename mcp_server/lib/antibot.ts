/**
 * Minimal Anti-Bot Stealth Context
 * Provides basic anti-detection measures when ANTIBOT_ENABLED=true
 */

import { Browser, BrowserContext } from 'playwright-core';

export interface StealthOptions {
  userAgent?: string;
  forceEnable?: boolean;
  storageState?: string | { cookies: any[]; origins: any[] };
}

/**
 * Create a stealth browser context with anti-bot measures
 * @param browser - Playwright browser instance
 * @param opts - Optional configuration
 * @returns BrowserContext with stealth measures applied
 */
export async function createStealthContext(
  browser: Browser,
  opts: StealthOptions = {}
): Promise<BrowserContext> {
  const antibotEnabled = process.env.ANTIBOT_ENABLED === 'true' || opts.forceEnable === true;
  
  if (!antibotEnabled) {
    console.log('[Antibot] ANTIBOT_ENABLED=false and forceEnable=false, using standard context');
    return browser.contexts()[0] || await browser.newContext();
  }
  
  console.log('[Antibot] ANTIBOT_ENABLED=true, creating stealth context');
  
  // Use realistic user agent
  const userAgent = opts.userAgent || 
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  // CRITICAL: Always create a NEW context when antibot is enabled
  // Do NOT reuse browser.contexts()[0] which is the default CDP context
  const contextOptions: any = {
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  };
  
  // Load storageState if provided for session reuse
  if (opts.storageState) {
    if (typeof opts.storageState === 'string') {
      contextOptions.storageState = opts.storageState;
      console.log('[Antibot] Loading storageState from path:', opts.storageState);
    } else {
      contextOptions.storageState = opts.storageState;
      console.log('[Antibot] Loading storageState from object');
    }
  }
  
  const context = await browser.newContext(contextOptions);
  
  // Hide webdriver flag via addInitScript
  await context.addInitScript(() => {
    // Remove navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Add chrome object
    (window as any).chrome = {
      runtime: {},
    };
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'denied' } as PermissionStatus);
      }
      return originalQuery(parameters);
    };
  });
  
  console.log('[Antibot] Stealth context configured');
  return context;
}
