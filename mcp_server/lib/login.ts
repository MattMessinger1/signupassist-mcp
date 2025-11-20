import { Browser, Page } from 'playwright-core';
import { sleep, humanPause, jitter } from './humanize.js';
import { createStealthContext } from './antibot.js';
import { saveSessionState, generateSessionKey } from './session.js';

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

// Actively prevent interaction with honeypot fields
async function preventHoneypotInteraction(page: Page): Promise<void> {
  console.log('[Honeypot] Scanning for and neutralizing honeypot fields...');
  
  const honeypotInfo = await page.evaluate(() => {
    const honeypots: Array<{name: string, type: string, visible: boolean}> = [];
    
    // Find all hidden/invisible inputs
    const allInputs = document.querySelectorAll('input');
    for (const input of allInputs) {
      const computed = window.getComputedStyle(input);
      const isHidden = 
        input.type === 'hidden' ||
        computed.display === 'none' ||
        computed.visibility === 'hidden' ||
        computed.opacity === '0' ||
        input.offsetParent === null;
      
      // Flag suspicious fields (common honeypot names)
      const name = input.name || input.id || '';
      const isHoneypotName = /honeypot|bot|trap|fake|url|website|homepage/i.test(name);
      
      if (isHidden && isHoneypotName && name !== 'antibot_key') {
        honeypots.push({
          name: name,
          type: input.type,
          visible: !isHidden
        });
        
        // Clear any value that might have been set
        if (input.value) {
          input.value = '';
        }
      }
    }
    
    return honeypots;
  });
  
  if (honeypotInfo.length > 0) {
    console.log(`[Honeypot] Found and neutralized ${honeypotInfo.length} honeypot fields:`, honeypotInfo);
  } else {
    console.log('[Honeypot] No honeypot fields detected');
  }
}

// Check if user is logged in via multiple signals
async function hasDrupalSessCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  // Match ONLY real Drupal session cookies, not analytics cookies like _hjSession
  return cookies.some(c => /^S?SESS[a-f0-9]+$|^PHPSESSID$/i.test(c.name));
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
  const hasDrupalAuth = cookies.some(c => /^S?SESS[a-f0-9]+$|^PHPSESSID$/i.test(c.name));
  
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
  postLoginUrl?: string,  // Optional: Force navigation after login
  sessionCacheParams?: { userId: string; credentialId: string; orgRef: string }  // Optional: For session caching
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
  
  console.log("DEBUG Navigating to login URL (preserving query parameters):", config.loginUrl);
  
  try {
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: ANTIBOT_MAX_WAIT_MS });
  } catch (timeoutError: any) {
    // Anti-bot fast-path: If initial load times out, proceed anyway
    console.log('[Login] Fast-path: Anti-bot timeout on initial load, proceeding...');
  }
  
  console.log(`DEBUG Page load state: ${page.url()}`);
  
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

  // ============= WAIT FOR DRUPAL FORM TO BE FULLY RENDERED =============
  console.log('[Form Init] Waiting for Drupal form elements to be present...');
  
  // Wait for basic form fields
  try {
    await page.waitForSelector(emailSel, { timeout: 10000, state: 'attached' });
    await page.waitForSelector(passSel, { timeout: 10000, state: 'attached' });
    console.log('[Form Init] ✓ Form fields detected');
  } catch (e) {
    throw new Error('Login form fields not found after 10s');
  }
  
  // Wait for Drupal form structure (CRITICAL)
  console.log('[Form Init] Checking for Drupal form tokens...');
  const formTokensPresent = await page.evaluate(() => {
    const formBuildId = document.querySelector('input[name="form_build_id"]');
    const formToken = document.querySelector('input[name="form_token"]');
    return {
      hasFormBuildId: !!formBuildId,
      hasFormToken: !!formToken,
      formBuildIdValue: (formBuildId as HTMLInputElement)?.value || '',
      formTokenValue: (formToken as HTMLInputElement)?.value || ''
    };
  });
  
  console.log('[Form Init] Token check result:', {
    hasFormBuildId: formTokensPresent.hasFormBuildId,
    hasFormToken: formTokensPresent.hasFormToken,
    buildIdPreview: formTokensPresent.formBuildIdValue.substring(0, 15) + '...',
    tokenPreview: formTokensPresent.formTokenValue.substring(0, 15) + '...'
  });
  
  // Only require form_build_id (form_token is optional for some Drupal forms)
  if (!formTokensPresent.hasFormBuildId) {
    console.log('[Form Init] ⚠️ form_build_id missing, waiting 3s and reloading...');
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    
    // Verify after reload
    const tokensAfterReload = await page.evaluate(() => {
      const fb = document.querySelector('input[name="form_build_id"]') as HTMLInputElement;
      const ft = document.querySelector('input[name="form_token"]') as HTMLInputElement;
      return {
        hasFormBuildId: !!fb,
        hasFormToken: !!ft,
        formBuildIdValue: fb?.value || '',
        formTokenValue: ft?.value || ''
      };
    });
    
    if (!tokensAfterReload.hasFormBuildId) {
      throw new Error('Drupal form_build_id still not present after reload');
    }
    
    if (!tokensAfterReload.hasFormToken) {
      console.log('[Form Init] ℹ️ form_token not present, but proceeding (may be optional for this form)');
    }
    
    console.log('[Form Init] ✓ form_build_id present after reload');
  }
  
  if (!formTokensPresent.hasFormToken) {
    console.log('[Form Init] ℹ️ form_token not present, but proceeding (may be optional for this form)');
  }
  
  console.log('[Form Init] ✓ Drupal form ready (form_build_id present)');
  
  // Check if form is wrapped in antibot container that needs to be revealed
  console.log('[Form Init] Checking antibot wrapper state...');
  const antibotWrapper = await page.evaluate(() => {
    const wrapper = document.querySelector('.antibot-message, [data-antibot]');
    if (wrapper) {
      const computed = window.getComputedStyle(wrapper);
      return {
        found: true,
        hidden: computed.display === 'none' || computed.visibility === 'hidden'
      };
    }
    return { found: false, hidden: false };
  });

  if (antibotWrapper.found && antibotWrapper.hidden) {
    console.log('[Form Init] ⚠️ Antibot wrapper still hidden, waiting for JavaScript...');
    await page.waitForTimeout(3000);
  }

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

  // Actively prevent interaction with honeypot fields
  await preventHoneypotInteraction(page);

  // ============= PRE-LOGIN WARM-UP (CRITICAL FOR ANTIBOT) =============
  console.log('[Antibot] Starting pre-login warm-up sequence...');
  
  // Import enhanced humanization functions
  const { humanReadPage, humanMouseMove, humanTypeText } = await import('./humanize.js');
  
  // 1. Simulate page arrival and initial scan (3-5 seconds)
  await humanReadPage(page);
  await humanPause(1000, 2000);
  
  // 2. Move mouse to form area (simulate locating the login form)
  try {
    const formBox = await page.locator('form').first().boundingBox();
    if (formBox) {
      // Move mouse near form but not on fields yet
      await page.mouse.move(
        formBox.x + jitter(20, formBox.width - 20),
        formBox.y + jitter(20, 100),
        { steps: jitter(10, 20) }
      );
      await humanPause(500, 1000);
    }
  } catch (e) {
    console.log('[Antibot] Could not locate form for mouse movement');
  }
  
  // 3. Wait for antibot JS to fully initialize (CRITICAL)
  console.log('[Antibot] Waiting for antibot initialization (5-7 seconds)...');
  await humanPause(5000, 7000);
  
  // 4. Verify antibot key is ready AND form action is restored
  console.log('[Antibot] Verifying form is fully activated...');
  const antibotStatus = await page.evaluate(() => {
    const form = document.querySelector('form.antibot, form[data-action]') as HTMLFormElement;
    const keyInput = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
    
    return {
      keyPopulated: keyInput?.value?.length > 10,
      keyValue: keyInput?.value?.substring(0, 20) || 'MISSING',
      formAction: form?.action || 'NO_FORM',
      formDataAction: form?.getAttribute('data-action') || 'NO_DATA_ACTION',
      actionRestored: form?.action && !form.action.includes('/antibot')
    };
  });

  console.log('[Antibot] Status check:', antibotStatus);

  if (!antibotStatus.actionRestored) {
    console.log('[Antibot] ⚠️ Form action not restored yet, waiting additional 3 seconds...');
    await humanPause(3000, 4000);
    
    // Re-check
    const retryStatus = await page.evaluate(() => {
      const form = document.querySelector('form.antibot, form[data-action]') as HTMLFormElement;
      return {
        formAction: form?.action || 'NO_FORM',
        actionRestored: form?.action && !form.action.includes('/antibot')
      };
    });
    
    if (!retryStatus.actionRestored) {
      throw new Error(`Antibot form not ready: action=${retryStatus.formAction}`);
    }
  }

  if (!antibotStatus.keyPopulated) {
    console.log('[Antibot] Key not ready, waiting additional 3 seconds...');
    await humanPause(3000, 4000);
  }
  
  // 5. Wait minimum duration after key appears (proves JS has been running)
  console.log('[Antibot] Waiting minimum 3 seconds after key populated...');
  await humanPause(3000, 4000);

  // 6. CRITICAL: Actively interact with antibot_key field to trigger validation
  console.log('[Antibot] Actively triggering antibot_key field events...');
  await page.evaluate(() => {
    const keyInput = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
    if (keyInput && keyInput.value) {
      // Focus the field
      keyInput.focus();
      
      // Trigger input/change events to signal the value is "user-entered"
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
      keyInput.dispatchEvent(new Event('blur', { bubbles: true }));
      
      console.log('[Antibot] ✓ Triggered events on antibot_key:', keyInput.value.substring(0, 20));
    }
  });
  await humanPause(500, 1000);

  console.log('[Antibot] Warm-up complete, proceeding with form interaction');
  
  // ============= NOW TYPE CREDENTIALS WITH ENHANCED HUMANIZATION =============
  console.log("DEBUG Typing email with realistic human behavior...");
  await humanTypeText(page, emailSel, creds.email, false);
  
  // Pause between fields (user thinking/looking at password manager)
  await humanPause(800, 1500);
  
  console.log("DEBUG Typing password with realistic human behavior...");
  await humanTypeText(page, passSel, creds.password, false);
  
  // Longer pause after typing password (user reviewing what they typed)
  await humanPause(1000, 2000);

  // ============= WAIT FOR DRUPAL FORM TOKENS TO STABILIZE =============
  console.log('[Drupal Tokens] Waiting for form_build_id and form_token to stabilize...');
  
  const getToken = async (selector: string) => {
    try {
      return await page.$eval(selector, (el: any) => el.value || "").catch(() => "");
    } catch {
      return "";
    }
  };
  
  let lastTokens = { 
    form_build_id: await getToken('input[name="form_build_id"]'), 
    form_token: await getToken('input[name="form_token"]') 
  };
  
  console.log(`[Drupal Tokens] Initial values - build_id: ${lastTokens.form_build_id ? `${lastTokens.form_build_id.substring(0, 15)}...` : 'MISSING'}, token: ${lastTokens.form_token ? `${lastTokens.form_token.substring(0, 15)}...` : 'MISSING'}`);
  
  if (!lastTokens.form_build_id) {
    throw new Error('CRITICAL: form_build_id missing at stability check - form initialization failed');
  }
  
  if (!lastTokens.form_token) {
    console.log('[Drupal Tokens] ℹ️ form_token not present, proceeding with form_build_id only');
  }
  let lastChangeTime = Date.now();
  const tokenWaitStart = Date.now();
  const maxTokenWait = 10000; // 10 seconds
  const stableTime = 500; // Tokens must be stable for 500ms
  
  while (Date.now() - tokenWaitStart < maxTokenWait) {
    await page.waitForTimeout(200);
    
    const currentTokens = { 
      form_build_id: await getToken('input[name="form_build_id"]'), 
      form_token: await getToken('input[name="form_token"]') 
    };
    
    // If tokens changed, reset the stability timer
    if (currentTokens.form_build_id !== lastTokens.form_build_id || 
        currentTokens.form_token !== lastTokens.form_token) {
      lastTokens = currentTokens;
      lastChangeTime = Date.now();
      console.log('[Drupal Tokens] Changed, waiting for stability...');
    }
    
    // Check if tokens have been stable long enough
    if (Date.now() - lastChangeTime >= stableTime && 
        currentTokens.form_build_id) {
      const tokenInfo = currentTokens.form_token 
        ? `token=${currentTokens.form_token.substring(0, 10)}...`
        : 'token=NONE';
      console.log(`[Drupal Tokens] ✓ Stable (build_id=${currentTokens.form_build_id.substring(0, 10)}..., ${tokenInfo})`);
      break;
    }
  }
  
  // Verify tokens are present before proceeding
  const finalTokens = {
    form_build_id: await getToken('input[name="form_build_id"]'),
    form_token: await getToken('input[name="form_token"]')
  };
  
  if (!finalTokens.form_build_id) {
    console.warn('[Drupal Tokens] ⚠️ form_build_id not found - form will likely be rejected by Drupal');
  } else if (!finalTokens.form_token) {
    console.log('[Drupal Tokens] ℹ️ form_token not present (may be optional for this form)');
  } else {
    console.log('[Drupal Tokens] ✓ Verified both tokens present before submission');
  }

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

  // Final comprehensive antibot check before submit
  console.log('[Antibot] Final pre-submit verification...');
  const finalCheck = await page.evaluate(() => {
    const form = document.querySelector('form.antibot, form[data-action]') as HTMLFormElement;
    const keyInput = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
    
    // Check for honeypot fields with values (should be empty)
    const honeypotFilled = Array.from(document.querySelectorAll('input'))
      .filter(input => {
        const name = input.name || input.id || '';
        const isHoneypotName = /honeypot|bot|trap|fake|url|website|homepage/i.test(name);
        const isHidden = input.type === 'hidden' || 
                        window.getComputedStyle(input).display === 'none';
        return isHoneypotName && isHidden && name !== 'antibot_key' && input.value;
      });
    
    return {
      formAction: form?.action || 'NO_FORM',
      actionIsValid: form?.action && !form.action.includes('/antibot'),
      keyPresent: !!keyInput?.value,
      keyLength: keyInput?.value?.length || 0,
      keyPreview: keyInput?.value?.substring(0, 20) || 'MISSING',
      honeypotFieldsFilled: honeypotFilled.length,
      allGood: form?.action && 
               !form.action.includes('/antibot') && 
               keyInput?.value?.length > 10 &&
               honeypotFilled.length === 0
    };
  });

  console.log('[Antibot] Final status:', finalCheck);

  if (!finalCheck.allGood) {
    const issues = [];
    if (!finalCheck.actionIsValid) issues.push(`action=${finalCheck.formAction}`);
    if (!finalCheck.keyPresent) issues.push('key missing');
    if (finalCheck.keyLength < 10) issues.push(`key too short (${finalCheck.keyLength})`);
    if (finalCheck.honeypotFieldsFilled > 0) issues.push(`${finalCheck.honeypotFieldsFilled} honeypots filled`);
    
    throw new Error(`Antibot verification failed: ${issues.join(', ')}`);
  }

  console.log('[Antibot] ✓ All checks passed, safe to submit');
  
  // Debug: Capture form state before submission (only in debug mode)
  if (process.env.DEBUG_ANTIBOT === 'true') {
    try {
      await page.screenshot({ path: 'debug_before_submit.png', fullPage: false });
      const formHTML = await page.evaluate(() => {
        const form = document.querySelector('form');
        return form?.outerHTML.substring(0, 2000);
      });
      console.log('[Debug] Form HTML before submit:', formHTML);
    } catch (e) {
      // Screenshot failed, continue
    }
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
    // Wait for redirect AWAY from /user/login (key change)
    const loginResult = await Promise.race([
      // Success signal: URL changes away from login page
      page.waitForFunction(() => {
        const path = window.location.pathname;
        return !path.includes('/user/login') && !path.includes('/user/password');
      }, { timeout: 8000, polling: 100 }).then(() => 'redirected'),
      
      // Success signal: Session cookie appears
      page.waitForFunction(() => {
        return document.cookie.includes('SESS') || document.cookie.includes('SSESS');
      }, { timeout: 8000, polling: 100 }).then(() => 'cookie'),
      
      // Failure signal: Error message appears
      page.waitForSelector('.messages--error, .messages--warning, div[role="alert"], .form-item--error-message', { timeout: 8000 })
        .then(async () => {
          const msg = await page.locator('.messages--error, .messages--warning, div[role="alert"], .form-item--error-message').first().innerText().catch(() => '');
          console.log(`DEBUG ✗ Error message detected: ${msg.trim()}`);
          throw new Error(`Login failed: ${msg.trim() || 'Unknown error message appeared'}`);
        }),
      
      // Timeout fallback
      page.waitForTimeout(8000).then(() => 'timeout')
    ]).catch((error: any) => {
      if (error.message?.includes('Login failed:')) {
        throw error;
      }
      return 'timeout';
    });
    
    console.log(`DEBUG Login detection result: ${loginResult}`);
    
    // Check if still on login page
    const currentUrl = page.url();
    const stillOnLoginPage = currentUrl.includes('/user/login');
    
    console.log(`DEBUG Current URL after submission: ${currentUrl}`);
    console.log(`DEBUG Still on login page: ${stillOnLoginPage}`);
    
    if (stillOnLoginPage) {
      // Check for Drupal error messages
      const drupalError = await page.evaluate(() => {
        const errorMessages = document.querySelectorAll('.messages--error, .form-item--error-message, div.error');
        for (const el of errorMessages) {
          if (el.textContent?.trim()) {
            return el.textContent.trim();
          }
        }
        return null;
      });
      
      if (drupalError) {
        throw new Error(`Login failed: ${drupalError}`);
      } else {
        throw new Error('Login failed: Still on login page after form submission (no redirect occurred)');
      }
    }
    
    // If timeout occurred, do comprehensive error check first
    if (loginResult === 'timeout') {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      
      // Check for Drupal error messages (including hidden ones)
      const drupalErrors = await page.evaluate(() => {
        const selectors = [
          '.messages--error',
          '.messages--warning',
          '.form-item--error-message',
          'div[role="alert"]',
          '.alert-danger',
          '.error-message',
          '.form-error'
        ];
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) {
            return {
              found: true,
              message: el.textContent.trim(),
              selector: sel
            };
          }
        }
        
        // Check if still on login page with error indicators
        if (window.location.href.includes('/user/login')) {
          const bodyText = document.body.textContent || '';
          if (bodyText.includes('Unrecognized') || 
              bodyText.includes('invalid') || 
              bodyText.includes('incorrect') ||
              bodyText.includes('try again')) {
            return {
              found: true,
              message: 'Login page showing error indicators in body text',
              selector: 'body-text'
            };
          }
        }
        
        return { found: false };
      });
      
      if (drupalErrors.found) {
        console.log(`DEBUG ✗ Login failed (error detected): ${drupalErrors.message}`);
        throw new Error(`Login failed: ${drupalErrors.message}`);
      }
    }
    
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
      
      // ✅ Log session cookie specifically (using strict regex)
      const sessionCookie = cookies.find(c => /^S?SESS[a-f0-9]+$|^PHPSESSID$/i.test(c.name));
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
        // Removed "welcome" check - it appears in footer even when not logged in
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
        const sessionCookie = cookies.find(c => /^S?SESS[a-f0-9]+$|^PHPSESSID$/i.test(c.name));
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
        
        // Save session state for reuse if caching parameters provided
        if (sessionCacheParams) {
          const { userId, credentialId, orgRef } = sessionCacheParams;
          const sessionKey = generateSessionKey(userId, credentialId, orgRef);
          console.log(`[Session Cache] Saving session for key: ${sessionKey}`);
          await saveSessionState(page, sessionKey);
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
