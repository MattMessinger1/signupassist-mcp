import { Page } from 'playwright';

export interface ProviderLoginConfig {
  loginUrl: string;
  selectors: {
    username: string | string[];
    password: string | string[];
    submit: string | string[];
  };
  postLoginCheck: string | string[]; // CSS or text locator
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

// Random delay between min and max ms
function randomDelay(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

export async function loginWithCredentials(
  page: Page, 
  config: ProviderLoginConfig, 
  creds: { email: string; password: string }
) {
  console.log("DEBUG Navigating to login page:", config.loginUrl);
  
  // Patch C: Simulate viewport jitter (realistic window resize)
  const viewport = page.viewportSize();
  if (viewport) {
    await page.setViewportSize({ 
      width: viewport.width + randomDelay(-5, 5), 
      height: viewport.height + randomDelay(-5, 5) 
    });
  }

  // Wait for full page load including scripts (Antibot JS needs to load)
  await page.goto(config.loginUrl, { waitUntil: "networkidle" });

  // Monitor console errors for antibot issues
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && msg.text().toLowerCase().includes('antibot')) {
      consoleErrors.push(msg.text());
      console.log("DEBUG JS Console Error (Antibot):", msg.text());
    }
  });

  // Patch C: Simulate tab focus events
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Wait for form elements with progressive fallback
  console.log("DEBUG Waiting for login form to be ready...");
  
  const usernameSelectors = Array.isArray(config.selectors.username) 
    ? config.selectors.username 
    : [...DEFAULT_EMAIL_SELECTORS, config.selectors.username];
  const passwordSelectors = Array.isArray(config.selectors.password) 
    ? config.selectors.password 
    : [...DEFAULT_PASS_SELECTORS, config.selectors.password];
  const submitSelectors = Array.isArray(config.selectors.submit) 
    ? config.selectors.submit 
    : [...DEFAULT_SUBMIT_SELECTORS, config.selectors.submit];

  const usernameSelector = await findSelector(page, usernameSelectors, 15000);
  if (!usernameSelector) {
    throw new Error(`Login failed: no username/email field found. Tried: ${usernameSelectors.join(', ')}`);
  }

  const passwordSelector = await findSelector(page, passwordSelectors, 15000);
  if (!passwordSelector) {
    throw new Error(`Login failed: no password field found. Tried: ${passwordSelectors.join(', ')}`);
  }

  // Detect honeypot fields
  await detectHoneypots(page);

  // STEP 1: Do human-like interactions FIRST to trigger Antibot JavaScript
  console.log("DEBUG Simulating initial human behavior (scroll, mouse movement) to trigger Antibot...");
  await page.mouse.move(0, 0);
  await page.mouse.move(randomDelay(100, 200), randomDelay(100, 200), { steps: randomDelay(15, 25) });
  await page.waitForTimeout(randomDelay(500, 1000));
  
  // Scroll down then back up (mimics reading)
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(randomDelay(500, 1000));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(randomDelay(1000, 1500));

  // STEP 2: NOW wait for Antibot key to be populated (after human-like interaction)
  console.log("DEBUG Waiting for Antibot key to be populated (after interaction)...");
  let antibotPopulated = false;
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
        return el && el.getAttribute('value') && el.getAttribute('value').length > 0;
      },
      { timeout: 20000 } // Increased timeout to 20s
    );
    console.log("DEBUG ✓ Antibot key is now populated");
    antibotPopulated = true;
  } catch (e) {
    console.log("DEBUG ⚠ Antibot key NOT populated after 20s – will check again before submit");
  }

  // Additional reading delay
  const readingDelay = randomDelay(1500, 2500);
  console.log(`DEBUG Pausing ${readingDelay}ms to mimic human reading time...`);
  await page.waitForTimeout(readingDelay);

  // Focus and type username with realistic delay
  console.log("DEBUG Clicking and typing username...");
  await page.click(usernameSelector);
  
  // Clear field first (form field validation)
  await page.fill(usernameSelector, '');
  await page.waitForTimeout(randomDelay(100, 200));
  
  // Type with randomized per-keystroke delay
  await page.type(usernameSelector, creds.email, { delay: randomDelay(50, 100) });

  // Random pause between fields
  await page.waitForTimeout(randomDelay(300, 600));

  // Focus and type password with realistic delay
  console.log("DEBUG Clicking and typing password...");
  await page.click(passwordSelector);
  
  // Clear field first
  await page.fill(passwordSelector, '');
  await page.waitForTimeout(randomDelay(100, 200));
  
  // Type with randomized delay
  await page.type(passwordSelector, creds.password, { delay: randomDelay(50, 100) });

  // CRITICAL: Check Antibot key RIGHT BEFORE submit
  console.log("DEBUG Final Antibot key check before submit...");
  try {
    const antibotKey = await page.evaluate(() => {
      const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
      return el ? el.getAttribute('value') : null;
    });
    
    if (antibotKey && antibotKey.length > 0) {
      console.log(`DEBUG ✓ Antibot key confirmed populated: ${antibotKey.substring(0, 20)}...`);
    } else {
      console.log('DEBUG ⚠ WARNING: Antibot key is STILL EMPTY!');
      console.log('DEBUG Waiting additional 4s and checking one more time...');
      await page.waitForTimeout(4000);
      
      const retryKey = await page.evaluate(() => {
        const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
        return el ? el.getAttribute('value') : null;
      });
      
      if (retryKey && retryKey.length > 0) {
        console.log(`DEBUG ✓ Antibot key populated after retry: ${retryKey.substring(0, 20)}...`);
      } else {
        console.log('DEBUG ✗ Antibot key STILL empty – login will be BLOCKED by Antibot');
        // Dump page info for debugging
        const url = page.url();
        const title = await page.title();
        console.log(`DEBUG Current page: ${url} (title: ${title})`);
      }
    }
  } catch (e) {
    console.log('DEBUG Could not check Antibot key:', e);
  }

  // Randomized pause before submit (antibot timing analysis)
  const preSubmitDelay = randomDelay(800, 1500);
  console.log(`DEBUG Waiting ${preSubmitDelay}ms before submit...`);
  await page.waitForTimeout(preSubmitDelay);

  // Find and click submit button
  const submitSelector = await findSelector(page, submitSelectors, 5000);
  if (!submitSelector) {
    console.log("DEBUG No submit button found, trying keyboard Enter...");
    await page.keyboard.press('Enter');
  } else {
    console.log("DEBUG Clicking submit button...");
    await page.click(submitSelector);
  }

  // Track form submission timing
  const submitTime = Date.now();

  // Wait for login success indicators with progressive fallback
  const postLoginSelectors = Array.isArray(config.postLoginCheck) 
    ? config.postLoginCheck 
    : [config.postLoginCheck, 'a[href*="logout"]', 'a:has-text("Logout")'];

  let logoutFound = false;
  for (const sel of postLoginSelectors) {
    const found = await page.waitForSelector(sel, { timeout: 15000 }).catch(() => null);
    if (found) {
      logoutFound = true;
      console.log(`DEBUG Found post-login indicator: ${sel}`);
      break;
    }
  }
  
  const dashboardReached = await page.waitForURL('**/*dashboard*', { timeout: 15000 }).catch(() => null);

  // Calculate time from submit to success/failure
  const responseTime = Date.now() - submitTime;
  console.log(`DEBUG Form submission took ${responseTime}ms to respond`);

  if (logoutFound || dashboardReached) {
    const url = page.url();
    const title = await page.title();
    console.log("DEBUG: ✓ Login successful – Antibot bypass confirmed");
    console.log(`DEBUG Logged in to: ${url} (title: ${title})`);
    
    // Log any console errors that occurred
    if (consoleErrors.length > 0) {
      console.log("DEBUG Note: Antibot JS errors occurred but login succeeded:", consoleErrors);
    }
    
    return { url, title };
  } else {
    // Enhanced diagnostics on failure
    console.log("DEBUG: ✗ Login failed – gathering diagnostics...");
    
    // Check for Antibot-specific elements
    const antibotElements = await page.$$('[class*="antibot"], [id*="antibot"], [name*="antibot"]');
    if (antibotElements.length > 0) {
      console.log(`DEBUG Found ${antibotElements.length} Antibot-related elements on page`);
      for (const el of antibotElements.slice(0, 5)) {
        const tag = await el.evaluate(e => e.tagName);
        const id = await el.getAttribute('id');
        const className = await el.getAttribute('class');
        console.log(`  - ${tag}: id="${id}", class="${className}"`);
      }
    }

    // Check for Drupal error messages
    const errorElement = await page.$('.messages.error, .messages--error, div[role="alert"], .form-item--error-message');
    let errorMessage = '';
    if (errorElement) {
      errorMessage = await errorElement.textContent() || '';
      console.log("DEBUG Drupal error message:", errorMessage.trim());
    }

    // Log console errors
    if (consoleErrors.length > 0) {
      console.log("DEBUG JS Console Errors:", consoleErrors);
    }

    // Capture page HTML for debugging
    const html = await page.content();
    console.log("DEBUG Page HTML snippet (first 1000 chars):", html.slice(0, 1000));
    
    // Check if submit was too fast (antibot timing check)
    if (responseTime < 500) {
      console.log("DEBUG WARNING: Form responded very quickly (<500ms) – possible timing-based block");
    }

    // Determine failure reason
    if (errorMessage) {
      if (errorMessage.toLowerCase().includes('antibot')) {
        throw new Error(`Login failed: Antibot verification failed – ${errorMessage.trim()}`);
      } else {
        throw new Error(`Login failed: ${errorMessage.trim()}`);
      }
    } else if (antibotElements.length > 0) {
      throw new Error("Login failed: Antibot elements detected on page (likely blocked by Antibot protection)");
    } else {
      throw new Error("Login failed: no post-login element found, no error message displayed (likely blocked by Antibot)");
    }
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
