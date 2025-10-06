import { Browser, Page } from 'playwright';
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
async function findSelector(page: Page, selectors: string | string[], timeout = 5000): Promise<string | null> {
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

// Detect and log honeypot fields
async function detectHoneypots(page: Page): Promise<void> {
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
  const hasCookie = await hasDrupalSessCookie(page);
  const hasLoggedInIndicators = await pageHasLogoutOrDashboard(page);
  
  // Log verification details for debugging
  if (hasCookie || hasLoggedInIndicators) {
    console.log(`DEBUG ✓ Login verified - Cookie: ${hasCookie}, Page indicators: ${hasLoggedInIndicators}`);
  }
  
  return hasCookie || hasLoggedInIndicators;
}

export async function loginWithCredentials(
  page: Page, 
  config: ProviderLoginConfig, 
  creds: { email: string; password: string },
  browser?: Browser
) {
  const startTime = Date.now();
  const timeout = config.timeout || 30000;
  
  console.log(`DEBUG Using timeout: ${timeout}ms for login selectors`);

  // Log antibot status (stealth already applied at page creation in launchBrowserbaseSession)
  const antibotEnabled = process.env.ANTIBOT_ENABLED === 'true';
  console.log(`[Antibot] ${antibotEnabled ? 'Enabled' : 'Disabled'} - stealth context applied at page creation`);

  console.log("DEBUG Navigating to login page:", config.loginUrl);
  
  // Navigate explicitly to Drupal login with destination - wait for network idle for JS-heavy pages
  await page.goto(config.loginUrl, { waitUntil: 'networkidle', timeout });
  await page.waitForLoadState('networkidle');
  
  console.log(`DEBUG Page load state: ${page.url()}`);
  
  // Extra wait for JS initialization - wait 1200ms after networkidle
  await page.waitForTimeout(1200);

  // Quick check if already logged in - but verify by checking the current URL
  // Don't trust cookie existence alone, as cookies can be expired
  const currentUrl = page.url();
  if (await isLoggedIn(page) && !currentUrl.includes('/user/login')) {
    console.log("DEBUG Already logged in and verified (not on login page), skipping login flow");
    return { url: page.url(), title: await page.title() };
  }
  
  // If we have a cookie but are still on login page, the session is expired
  if (await isLoggedIn(page) && currentUrl.includes('/user/login')) {
    console.log("DEBUG Found expired session cookie on login page - will perform fresh login");
  }

  // Quick human pause + tiny mouse wiggle (Antibot micro-behavior)
  await humanPause(350, 900);
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
  await humanPause(500, 1400);

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
  await page.type(emailSel, creds.email, { delay: jitter(35, 95) });
  
  await humanPause(200, 500);
  
  console.log("DEBUG Typing password...");
  await page.click(passSel, { timeout: 5000 }).catch(() => {});
  await page.type(passSel, creds.password, { delay: jitter(35, 95) });
  
  await humanPause(300, 700);

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

  // Race between success signals and error messages
  console.log("DEBUG Waiting for login result...");
  const submitTime = Date.now();
  
  try {
    const success = await Promise.race([
      // Success detection: poll for cookie/URL/text
      (async () => {
        for (let i = 0; i < 12; i++) {
          if (await isLoggedIn(page)) {
            console.log(`DEBUG ✓ Login success detected (iteration ${i + 1})`);
            return true;
          }
          await humanPause(300, 900);
        }
        return false;
      })(),
      
      // Error detection: wait for Drupal error messages
      (async () => {
        await page.waitForSelector('.messages--error, .messages--warning, div[role="alert"]', { 
          timeout: 12000 
        }).catch(() => {});
        
        const errorMsg = await page.locator('.messages--error, .messages--warning, div[role="alert"]')
          .innerText()
          .catch(() => '');
        
        if (errorMsg) {
          console.log(`DEBUG ✗ Drupal error message: ${errorMsg.trim()}`);
          throw new Error(`Login failed: ${errorMsg.trim()}`);
        }
        return false;
      })()
    ]);

    const responseTime = Date.now() - submitTime;
    console.log(`DEBUG Form response took ${responseTime}ms`);

    if (success) {
      let url = page.url();
      const hasCookie = await hasDrupalSessCookie(page);
      
      // CRITICAL: Verify that we've actually navigated away from the login page
      // Don't trust cookie existence alone - ensure navigation has occurred
      if (url.includes('/user/login')) {
        console.log('DEBUG ⚠ Login accepted but still on login page - waiting for navigation...');
        
        try {
          // Wait for navigation away from login page (max 10 seconds)
          await page.waitForURL(pageUrl => !pageUrl.includes('/user/login'), { 
            timeout: 10000 
          });
          url = page.url();
          console.log('DEBUG ✓ Navigation completed to:', url);
        } catch (e) {
          console.log('DEBUG ✗ No navigation after 10s - login likely failed');
          throw new Error('Login form accepted credentials but did not redirect to dashboard');
        }
      }
      
      const title = await page.title();
      const duration_ms = Date.now() - startTime;
      
      console.log("DEBUG ✓ Login successful - authenticated session verified");
      console.log(`DEBUG - URL: ${url}`);
      console.log(`DEBUG - Title: ${title}`);
      console.log(`DEBUG - Session cookie: ${hasCookie ? 'present' : 'absent'}`);
      console.log(`DEBUG - Login duration: ${duration_ms}ms`);
      
      return { url, title, verified: true };
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
      
      if (!looksLoggedIn) {
        console.log('DEBUG ⚠ Login verification uncertain, retrying once...');
        
        // Retry once - navigate to home/dashboard to confirm
        await humanPause(1000, 2000);
        try {
          const baseUrl = new URL(currentUrl).origin;
          await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => 
            page.goto(`${baseUrl}/user`, { waitUntil: 'networkidle', timeout: 10000 })
          );
          
          // Re-evaluate after navigation
          const retryLoggedIn = await isLoggedIn(page);
          if (retryLoggedIn) {
            console.log('DEBUG ✓ Login verified after retry - authenticated session verified');
            return { url: page.url(), title: await page.title(), verified: true };
          }
        } catch (e) {
          console.log('DEBUG Retry navigation failed:', e);
        }
      } else {
        // Looks logged in despite no explicit success signal
        console.log('DEBUG ✓ Login appears successful based on page indicators - authenticated session verified');
        return { url: currentUrl, title: pageTitle, verified: true };
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
