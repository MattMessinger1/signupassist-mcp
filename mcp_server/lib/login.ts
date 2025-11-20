import { Browser, Page } from 'playwright-core';
import { sleep, humanPause, jitter } from './humanize.js';
import { createStealthContext } from './antibot.js';

export interface ProviderLoginConfig {
  loginUrl: string;
  selectors: {
    username: string | string[];
    password: string | string[];
    submit: string | string[];
  };
  postLoginCheck: string | string[]; // CSS or text locator
  timeout?: number; // Optional timeout in ms (default: 30000)
  storageState?: string | { cookies: any[]; origins: any[] }; // Phase 3: For session reuse
}

// Fallback selector arrays for progressive detection
const DEFAULT_EMAIL_SELECTORS = [
  '#edit-name',
  'input[name="name"]',
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="user"]'
];

const DEFAULT_PASS_SELECTORS = [
  '#edit-pass',
  'input[name="pass"]',
  'input[type="password"]',
  'input[name="password"]'
];

const DEFAULT_SUBMIT_SELECTORS = [
  '#edit-submit',
  'button#edit-submit',
  'input[type="submit"]',
  'button[type="submit"]',
  'input.form-submit'
];

// Honeypot field patterns to avoid
const HONEYPOT_PATTERNS = [
  'input[name*="antibot"]',
  'input[class*="antibot"]',
  'input[style*="display: none"]',
  'input[type="hidden"][name*="bot"]'
];

// Helper to find first available selector from array or string
async function findSelector(page: Page, selectors: string | string[], timeout = 3000): Promise<string | null> {
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  
  for (const sel of selectorArray) {
    try {
      await page.waitForSelector(sel, { timeout });
      console.log(`DEBUG Found selector: ${sel}`);
      return sel;
    } catch (e) {
      // Try next selector
    }
  }
  return null;
}

// Detect and log honeypot fields (only in debug mode for performance)
async function detectHoneypots(page: Page): Promise<void> {
  // Skip honeypot detection in production for ~200-300ms performance gain
  if (process.env.DEBUG_HONEYPOTS !== 'true') {
    return;
  }
  
  console.log("DEBUG Checking for Antibot honeypot fields...");
  for (const pattern of HONEYPOT_PATTERNS) {
    const honeypots = await page.$$(pattern);
    if (honeypots.length > 0) {
      console.log(`DEBUG Found ${honeypots.length} potential honeypot field(s) matching: ${pattern}`);
      for (const hp of honeypots) {
        const name = await hp.getAttribute('name');
        const type = await hp.getAttribute('type');
        const value = await hp.getAttribute('value');
        console.log(`  - Honeypot: name="${name}", type="${type}", value="${value}"`);
      }
    }
  }
}

// Check if user is logged in via multiple signals
async function hasDrupalSessCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  // Broaden cookie detection to include common session cookies
  return cookies.some(c => /S?SESS|session|PHPSESSID/i.test(c.name));
}

async function pageHasLogoutOrDashboard(page: Page): Promise<boolean> {
  const url = page.url();
  
  // ✅ Exclude login/register pages explicitly
  if (/\/user\/(login|register|password)/i.test(url)) {
    return false;
  }
  
  // ✅ Accept dashboard, home, or my-account pages as logged in indicators
  if (/\/(dashboard|home|my-account|profile)/i.test(url)) return true;
  
  const body = await page.locator('body').innerText().catch(() => '');
  
  // Check for multiple success indicators:
  // - Logout/sign out links
  // - Welcome messages (e.g., "Welcome to Blackhawk Ski Club")
  // - User profile/dashboard text
  return /logout|sign out|welcome to (blackhawk|[\w\s]+) ski club|my account|my profile/i.test(body);
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // FIX 2: Require real Drupal auth cookie (SSESS*), not just any session cookie
  const context = page.context();
  const cookies = await context.cookies();
  
  // Look for Drupal session cookie (SSESS* or similar)
  const hasDrupalAuth = cookies.some(c => /^SSESS/i.test(c.name));
  
  // Check for logout link (indicates authenticated UI)
  const hasLogoutLink = await page.locator('a[href*="/user/logout"]').count() > 0;
  
  // Check we're not stuck on login page
  const offLoginPage = !page.url().includes('/user/login');
  
  console.log(`DEBUG Login detection: auth_cookie=${hasDrupalAuth}, logout_link=${hasLogoutLink}, off_login=${offLoginPage}`);
  
  return hasDrupalAuth || (hasLogoutLink && offLoginPage);
}

export async function loginWithCredentials(
  page: Page, 
  config: ProviderLoginConfig, 
  creds: { email: string; password: string },
  browser?: Browser,
  postLoginUrl?: string  // Optional: Force navigation after login
): Promise<{
  url?: string;
  title?: string;
  verified?: boolean;
  email?: string;
  login_status: 'success' | 'failed';
  cookies?: any[];
  session_closed?: boolean;
}> {
  const startTime = Date.now();
  const timeout = config.timeout || 30000;
  
  console.log(`DEBUG Using timeout: ${timeout}ms for login selectors`);

  // Log antibot status (stealth already applied at page creation in launchBrowserbaseSession)
  const antibotEnabled = process.env.ANTIBOT_ENABLED === 'true';
  console.log(`[Antibot] ${antibotEnabled ? 'Enabled' : 'Disabled'} - stealth context applied at page creation`);

  console.log("DEBUG Navigating to login page:", config.loginUrl);
  
  // Navigate to login page with adaptive anti-bot timeout
  // Phase 3: Dynamic tuning - faster timeout when reusing sessions (storageState present)
  const hasStorageState = config.storageState !== undefined;
  const ANTIBOT_MAX_WAIT_MS = hasStorageState ? 1500 : 6500;
  console.log(`[Login] Antibot timeout: ${ANTIBOT_MAX_WAIT_MS}ms (session reuse: ${hasStorageState})`);
  
  try {
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: ANTIBOT_MAX_WAIT_MS });
  } catch (timeoutError: any) {
    // Anti-bot fast-path: If initial load times out, proceed anyway
    console.log('[Login] Fast-path: Anti-bot timeout on initial load, proceeding...');
  }
  
  console.log(`DEBUG Page load state: ${page.url()}`);
  
  // Only wait if form not immediately visible - with timeout cap
  const formReady = await page.locator('#edit-name, input[name="name"]').isVisible().catch(() => false);
  if (!formReady) {
    console.log("DEBUG Form not ready, waiting for JS initialization (capped at 3s)...");
    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 });
    } catch {
      console.log('[Login] Fast-path: Networkidle timeout, proceeding with form submission...');
    }
  }

    // Quick check if already logged in - but verify by checking the current URL
    // Don't trust cookie existence alone, as cookies can be expired
    const currentUrl = page.url();
    if (await isLoggedIn(page) && !currentUrl.includes('/user/login')) {
      console.log("DEBUG Already logged in and verified (not on login page), skipping login flow");
      const cookies = await page.context().cookies();
      return { 
        url: page.url(), 
        title: await page.title(),
        email: creds.email,
        login_status: 'success',
        cookies: cookies,
        session_closed: true
      };
    }
  
  // If we have a cookie but are still on login page, the session is expired
  if (await isLoggedIn(page) && currentUrl.includes('/user/login')) {
    console.log("DEBUG Found expired session cookie on login page - will perform fresh login");
  }

  // Quick human pause + tiny mouse wiggle (Antibot micro-behavior)
  await humanPause(200, 500);
  try {
    const box = page.locator('body');
    await box.hover({ position: { x: jitter(10, 200), y: jitter(10, 200) } }).catch(() => {});
  } catch (e) {
    // Hover might fail, that's ok
  }

  console.log("DEBUG Waiting for login form elements...");

  // Build comprehensive selector lists with fallbacks
  const emailSelectors = [
    '#edit-name',
    'input[name="name"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[name="username"]',
    'input[name="user"]'
  ];
  const passSelectors = [
    '#edit-pass',
    'input[type="password"]',
    'input[name*="pass" i]',
    'input[name="password"]'
  ];
  const submitSelectors = [
    '#edit-submit',
    'input[type="submit"]',
    'button[type="submit"]',
    'input[value*="log" i]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")'
  ];

  // Combined selector strings for Playwright
  const emailSel = emailSelectors.join(', ');
  const passSel = passSelectors.join(', ');
  const submitSel = submitSelectors.join(', ');

  // Wait for form fields with config timeout and one-time reload retry
  console.log(`DEBUG Waiting for email selector with timeout: ${timeout}ms`);
  try {
    await page.waitForSelector(emailSel, { timeout });
    console.log(`DEBUG Waiting for password selector with timeout: ${timeout}ms`);
    await page.waitForSelector(passSel, { timeout });
    console.log("DEBUG Form fields detected");
  } catch (selectorError) {
    console.log("DEBUG Form fields not found, attempting one-time reload retry...");
    
    // One-time reload retry
    await page.reload({ waitUntil: 'networkidle', timeout });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    
    console.log(`DEBUG Retry: Waiting for email selector with timeout: ${timeout}ms`);
    await page.waitForSelector(emailSel, { timeout });
    console.log(`DEBUG Retry: Waiting for password selector with timeout: ${timeout}ms`);
    await page.waitForSelector(passSel, { timeout });
    console.log("DEBUG Form fields detected after reload");
  }

  // Detect honeypot fields (but don't interact)
  await detectHoneypots(page);

  // Antibot micro-behavior: pause before interacting (JS needs time to set up)
  console.log("DEBUG Pausing for Antibot JS initialization...");
  await humanPause(300, 800);

  // Small scroll to trigger visibility events
  try {
    await page.evaluate(() => window.scrollTo(0, 100));
    await humanPause(200, 400);
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (e) {
    // Scroll might fail, that's ok
  }

  // Type credentials with human-like delays
  console.log("DEBUG Typing email...");
  await page.click(emailSel, { timeout: 5000 }).catch(() => {});
  await page.type(emailSel, creds.email, { delay: jitter(25, 60) });
  
  await humanPause(100, 300);
  
  console.log("DEBUG Typing password...");
  await page.click(passSel, { timeout: 5000 }).catch(() => {});
  await page.type(passSel, creds.password, { delay: jitter(25, 60) });
  
  await humanPause(150, 400);

  // Check "Remember me" checkbox if present (required for persistent session cookies)
  console.log("DEBUG Checking for 'Remember me' checkbox...");
  try {
    const rememberMeSelectors = [
      'input[name="persistent_login"]',
      'input[type="checkbox"][name="remember_me"]',
      'input#edit-remember-me',
      'label:has-text("Remember me") input[type="checkbox"]',
      'input[type="checkbox"][id*="remember"]'
    ];
    
    let rememberMeChecked = false;
    for (const rememberSel of rememberMeSelectors) {
      const rememberEl = page.locator(rememberSel).first();
      const count = await rememberEl.count();
      if (count > 0) {
        const isChecked = await rememberEl.isChecked();
        if (!isChecked) {
          await rememberEl.check();
          console.log(`DEBUG ✓ Checked 'Remember me' checkbox using selector: ${rememberSel}`);
        } else {
          console.log(`DEBUG ✓ 'Remember me' already checked using selector: ${rememberSel}`);
        }
        rememberMeChecked = true;
        break;
      }
    }
    
    if (!rememberMeChecked) {
      console.log("DEBUG ⚠ No 'Remember me' checkbox found - session may not persist");
    }
  } catch (e) {
    console.log("DEBUG ⚠ Error checking 'Remember me' checkbox:", e);
  }

  await humanPause(100, 200);

  // FIX 1: Override Drupal's destination field to force post-login redirect
  const currentPageUrl = new URL(page.url());
  if (currentPageUrl.pathname.includes('/user/login')) {
    const destInput = page.locator('input[name="destination"]');
    const destCount = await destInput.count();
    if (destCount > 0) {
      const desiredDest = currentPageUrl.searchParams.get('destination') || '/registration';
      await destInput.fill(desiredDest);
      console.log(`DEBUG ✓ Overrode destination field to: ${desiredDest}`);
    }
  }

  // Check if Antibot key is populated before submit
  console.log("DEBUG Checking Antibot key before submit...");
  try {
    const antibotKey = await page.evaluate(() => {
      const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
      return el ? el.value : null;
    });
    
    if (antibotKey && antibotKey.length > 0) {
      console.log(`DEBUG ✓ Antibot key populated: ${antibotKey.substring(0, 20)}...`);
    } else {
      console.log('DEBUG ⚠ Antibot key empty - waiting 2s more...');
      await humanPause(1500, 2500);
      
      const retryKey = await page.evaluate(() => {
        const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
        return el ? el.value : null;
      });
      
      if (retryKey && retryKey.length > 0) {
        console.log(`DEBUG ✓ Antibot key populated after wait: ${retryKey.substring(0, 20)}...`);
      } else {
        console.log('DEBUG ⚠ Antibot key still empty - proceeding anyway');
      }
    }
  } catch (e) {
    console.log('DEBUG Could not check Antibot key:', e);
  }

  // Submit the form
  console.log("DEBUG Submitting form...");
  const submitBtn = page.locator(submitSel).first();
  const submitExists = await submitBtn.count();
  
  if (submitExists > 0) {
    await submitBtn.click({ trial: false }).catch(() => {});
  } else {
    console.log("DEBUG No submit button found, pressing Enter in password field");
    await page.press(passSel, 'Enter').catch(() => {});
  }

  // Check for success indicators first, then error messages
  console.log("DEBUG Waiting for login result...");
  const submitTime = Date.now();
  
  try {
    // Check for SUCCESS indicators with multiple signals (optimized timeouts)
    const loginResult = await Promise.race([
      // Success signal 1: Session cookie appears (faster polling for quicker detection)
      page.waitForFunction(() => {
        return document.cookie.includes('SESS') || document.cookie.includes('SSESS');
      }, { timeout: 5000, polling: 50 }).then(() => 'cookie'),
      
      // Success signal 2: URL changes away from login page
      page.waitForFunction(() => !window.location.href.includes('/user/login'), { timeout: 5000, polling: 50 })
        .then(() => 'url'),
      
      // Success signal 3: Logout link appears
      page.waitForSelector('a:has-text("Log out"), a:has-text("Sign out")', { timeout: 5000 })
        .then(() => 'logout'),
      
      // Failure signal: Error message appears
      page.waitForSelector('.messages--error, .messages--warning, div[role="alert"]', { timeout: 5000 })
        .then(async () => {
          const msg = await page.locator('.messages--error, .messages--warning, div[role="alert"]').first().innerText().catch(() => '');
          console.log(`DEBUG ✗ Error message detected: ${msg.trim()}`);
          throw new Error(`Login failed: ${msg.trim() || 'Unknown error message appeared'}`);
        })
    ]).catch((error: any) => {
      // If all promises timeout, check if we're actually logged in anyway
      if (error.name === 'TimeoutError') {
        console.log('DEBUG Timeout waiting for explicit signals - checking login status directly...');
        return 'timeout';
      }
      throw error;
    });
    
    console.log(`DEBUG Login detection result: ${loginResult}`);
    
    // If we got a success signal, verify it
    if (loginResult !== 'timeout') {
      const success = await isLoggedIn(page);
      if (!success) {
        console.log('DEBUG ⚠ Success signal detected but verification failed - checking page state...');
        // Fall through to comprehensive check below
      } else {
        console.log(`DEBUG ✓ Login verified via ${loginResult} signal`);
      }
    }
    
    // Verify login state with comprehensive check
    const success = await isLoggedIn(page);

    const responseTime = Date.now() - submitTime;
    console.log(`DEBUG Form response took ${responseTime}ms`);

    if (success) {
      let url = page.url();
      const hasCookie = await hasDrupalSessCookie(page);
      
      // If still on login page with valid session, that's okay - the extractor will handle navigation
      if (url.includes('/user/login')) {
        console.log(`DEBUG Still on login page but session cookie present - proceeding`);
      }
      
      const title = await page.title();
      const duration_ms = Date.now() - startTime;
      
      console.log("DEBUG ✓ Login successful - authenticated session verified");
      console.log(`DEBUG - URL: ${url}`);
      console.log(`DEBUG - Title: ${title}`);
      console.log(`DEBUG - Session cookie: ${hasCookie ? 'present' : 'absent'}`);
      console.log(`DEBUG - Login duration: ${duration_ms}ms`);
      
      // Extract cookies for Session B reuse
      const cookies = await page.context().cookies();
      console.log(`DEBUG Extracted ${cookies.length} cookies for Session B reuse`);
      
      // 🔍 Log ALL cookies with full details
      cookies.forEach(c => {
        console.log(`DEBUG Cookie: ${c.name}=${c.value.substring(0, 20)}... | domain=${c.domain} | path=${c.path} | secure=${c.secure} | httpOnly=${c.httpOnly}`);
      });
      
      // ✅ Log session cookie specifically
      const sessionCookie = cookies.find(c => /S?SESS|PHPSESSID/i.test(c.name));
      if (sessionCookie) {
        console.log(`DEBUG ✅ Session cookie: ${sessionCookie.name}=${sessionCookie.value.substring(0, 20)}...`);
      } else {
        console.log('DEBUG ⚠️ No session cookie found in extracted cookies');
      }
      
      // Force navigation to desired page if specified (don't trust ?destination=)
      if (postLoginUrl) {
        console.log(`[Login] Forcing navigation to: ${postLoginUrl}`);
        await page.goto(postLoginUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Wait for page to be ready (import dynamically to avoid circular dependency)
        const { waitForSkiClubProReady } = await import('../providers/utils/skiclubproReadiness.js');
        await waitForSkiClubProReady(page);
        
        url = page.url();
        console.log(`[Login] ✅ Navigation complete: ${url}`);
      }
      
      console.log('DEBUG ✓ Session A complete - ready to close');
      
      return { 
        url, 
        title, 
        verified: true, 
        email: creds.email,
        login_status: 'success',
        cookies: cookies,
        session_closed: true
      };
    } else {
      // No success signal detected - gather comprehensive diagnostics
      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => 'unknown');
      const hasCookie = await hasDrupalSessCookie(page);
      const hasLogout = await pageHasLogoutOrDashboard(page);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      
      // Enhanced verification - check if page looks logged in
      const looksLoggedIn =
        hasCookie ||
        /logout|sign out/i.test(bodyText) ||
        /welcome to (blackhawk|[\w\s]+) ski club/i.test(bodyText) ||
        /dashboard|my-account|profile/i.test(currentUrl);
      
      if (looksLoggedIn) {
        // Looks logged in despite no explicit success signal
        console.log('DEBUG ✓ Login appears successful based on page indicators - authenticated session verified');
        const cookies = await page.context().cookies();
        console.log(`DEBUG Extracted ${cookies.length} cookies for Session B reuse`);
        
        // 🔍 Log ALL cookies with full details
        cookies.forEach(c => {
          console.log(`DEBUG Cookie: ${c.name}=${c.value.substring(0, 20)}... | domain=${c.domain} | path=${c.path} | secure=${c.secure} | httpOnly=${c.httpOnly}`);
        });
        
        // ✅ Log session cookie specifically
        const sessionCookie = cookies.find(c => /S?SESS|PHPSESSID/i.test(c.name));
        if (sessionCookie) {
          console.log(`DEBUG ✅ Session cookie found: ${sessionCookie.name}=${sessionCookie.value.substring(0, 20)}...`);
        } else {
          console.log('DEBUG ⚠️ No session cookie found in extracted cookies');
        }
        
        // Force navigation to desired page if specified (don't trust ?destination=)
        if (postLoginUrl) {
          console.log(`[Login] Forcing navigation to: ${postLoginUrl}`);
          await page.goto(postLoginUrl, { waitUntil: 'networkidle', timeout: 30000 });
          
          // Wait for page to be ready
          const { waitForSkiClubProReady } = await import('../providers/utils/skiclubproReadiness.js');
          await waitForSkiClubProReady(page);
          
          console.log(`[Login] ✅ Navigation complete: ${page.url()}`);
        }
        
        return {
          url: currentUrl, 
          title: pageTitle, 
          verified: true,
          email: creds.email,
          login_status: 'success',
          cookies: cookies,
          session_closed: true
        };
      }
      
      // Get page snippets for debugging
      const titleText = await page.locator('title').innerText().catch(() => '');
      const h1Text = await page.locator('h1').first().innerText().catch(() => '');
      const messagesText = await page.locator('.messages, .messages--error, .messages--warning, .messages--status')
        .allInnerTexts()
        .catch(() => []);
      const bodySnippet = bodyText.substring(0, 600);
      
      const diagnostics = {
        url: currentUrl,
        title: pageTitle,
        hasCookie,
        hasLogout,
        pageSnippet: `Title: ${titleText}\nH1: ${h1Text}\nMessages: ${messagesText.join(', ')}\nBody (first 600): ${bodySnippet}`
      };
      
      console.log('DEBUG ✗ Login failed – diagnostics:', JSON.stringify(diagnostics, null, 2));
      
      const failureReason = !hasCookie 
        ? 'no session cookie found'
        : !hasLogout
        ? 'no logout link or dashboard URL detected'
        : 'unknown reason';
      
      throw new Error(JSON.stringify({
        message: `Login failed: ${failureReason}`,
        diagnostics
      }));
    }
  } catch (error) {
    // Enhanced diagnostics on failure with screenshot
    console.log("DEBUG ✗ Login failed - gathering diagnostics...");
    
    const url = page.url();
    const title = await page.title();
    const hasCookie = await hasDrupalSessCookie(page);
    
    console.log(`DEBUG - Current URL: ${url}`);
    console.log(`DEBUG - Page title: ${title}`);
    console.log(`DEBUG - Session cookie: ${hasCookie ? 'present' : 'absent'}`);
    
    // Check for Antibot elements
    const antibotElements = await page.$$('[class*="antibot"], [id*="antibot"], [name*="antibot"]');
    if (antibotElements.length > 0) {
      console.log(`DEBUG Found ${antibotElements.length} Antibot-related elements`);
    }
    
    // Capture debug screenshot
    try {
      await page.screenshot({ path: 'debug_login.png', fullPage: false });
      console.log("DEBUG Screenshot saved to debug_login.png");
    } catch (screenshotError) {
      console.log("DEBUG Could not capture screenshot:", screenshotError);
    }
    
    // Capture HTML snippet (first 1200 chars)
    const html = await page.content();
    console.log("DEBUG Page HTML (first 1200 chars):", html.slice(0, 1200));
    console.log(`DEBUG Login failed after ${Date.now() - startTime}ms`);
    
    throw error;
  }
}

export async function logoutIfLoggedIn(page: Page, logoutSelector: string = 'text=Logout') {
  if (await page.$(logoutSelector)) {
    console.log("DEBUG Found logout link — logging out...");
    await Promise.all([
      page.click(logoutSelector),
      page.waitForNavigation({ waitUntil: "networkidle" })
    ]);
    console.log("DEBUG Logout successful");
  } else {
    console.log("DEBUG No logout link found — already logged out");
  }
}
