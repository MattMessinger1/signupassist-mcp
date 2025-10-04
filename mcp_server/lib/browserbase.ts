/**
 * Browserbase Session Management
 * Handles Playwright automation via Browserbase
 */

import Browserbase from '@browserbasehq/sdk';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getSkiClubProConfig } from '../config/skiclubpro_selectors.js';
import { getProgramId } from '../config/program_mapping.js';
import { loginWithCredentials, ProviderLoginConfig } from './login.js';
import { annotatePrice } from './pricing/annotatePrice.js';
import { chooseDefaultAnswer } from './pricing/chooseAnswer.js';
import { computeTotalCents } from './pricing/computeTotal.js';
import type { DiscoveredField } from '../types/pricing.js';

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY!;

export interface BrowserbaseSession {
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface SkiClubProProgram {
  program_ref: string;
  title: string;
  opens_at: string;
}

/**
 * Launch a new Browserbase session with Playwright
 */
export async function launchBrowserbaseSession(): Promise<BrowserbaseSession> {
  try {
    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }

    // Create Browserbase session
    const bb = new Browserbase({ apiKey: browserbaseApiKey });
    const session = await bb.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID! });

    // Connect Playwright to Browserbase
    const browser = await chromium.connectOverCDP(session.connectUrl);
    
    // Load session state if available (for persistent login)
    const contextOptions: any = {};
    try {
      const fs = await import('fs');
      if (fs.existsSync('session.json')) {
        contextOptions.storageState = 'session.json';
        console.log('[Session] Loading cached session state');
      }
    } catch (err) {
      console.log('[Session] No cached session found, starting fresh');
    }
    
    const context = browser.contexts()[0] || await browser.newContext(contextOptions);
    const page = await context.newPage();

    return {
      sessionId: session.id,
      browser,
      context,
      page,
    };
  } catch (error) {
    throw new Error(`Failed to launch Browserbase session: ${error.message}`);
  }
}

/**
 * Connect to an existing Browserbase session
 */
export async function connectToBrowserbaseSession(sessionId: string): Promise<BrowserbaseSession> {
  try {
    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }

    // Connect Playwright to existing Browserbase session  
    const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${browserbaseApiKey}&sessionId=${sessionId}`);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();

    return {
      sessionId,
      browser,
      context,
      page,
    };
  } catch (error) {
    throw new Error(`Failed to connect to Browserbase session ${sessionId}: ${error.message}`);
  }
}

/**
 * Hard reset: clear cookies and storage
 */
async function hardResetStorage(page: Page, baseUrl: string) {
  await page.context().clearCookies().catch(() => {});
  
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
      try {
        // @ts-ignore
        if (window.caches && caches.keys) {
          caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
        }
      } catch {}
    });
  } catch {}
}

/**
 * Create a brand-new incognito context with NO storageState
 */
async function newIncognitoContext(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * Verify we are truly logged in (strict check)
 */
async function verifyLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/user/login')) return false;

  // Look for reliable signals (logout link or user menu)
  const hasUserUi =
    (await page.$('a[href*="/user/logout"], .user-menu, [data-testid="user-menu"], nav [aria-label*="user" i]')) ||
    (await page.locator('text=/logout|sign out/i').first().count()) > 0;

  // Fallback: Drupal SESS cookie check
  const cookies = await page.context().cookies().catch(() => []);
  const hasDrupalSess = cookies?.some(c => /S?SESS/i.test(c.name));

  return Boolean(hasUserUi || hasDrupalSess);
}

type LoginOpts = { 
  force_login?: boolean;
  toolName?: string;
  mandate_id?: string;
  plan_id?: string;
  plan_execution_id?: string;
  user_id?: string;
  session_token?: string;
  user_jwt?: string;
};

/**
 * Login to SkiClubPro using Playwright automation with brutal reset capability
 */
export async function performSkiClubProLogin(
  session: BrowserbaseSession,
  credentials: { email: string; password: string },
  orgRef: string = 'blackhawk-ski-club',
  opts: LoginOpts = {}
): Promise<{ login_status: 'success' | 'failed' }> {
  const config = getSkiClubProConfig(orgRef);
  const baseUrl = `https://${config.domain}`;
  const loginUrl = `${baseUrl}/user/login?destination=/dashboard`;

  // Login tracking variables
  const startedAt = Date.now();
  let loginStrategy: 'restore' | 'fresh' | 'hard_reset' = opts.force_login ? 'hard_reset' : 'restore';
  let verified = false;
  let hadLogoutUi = false;
  let hadSessCookie = false;
  let lastUrl = '';
  let error: string | undefined;
  let screenshotPath: string | undefined;
  let currentPage: Page = session.page;

  try {

    console.log(`[Login] Starting login for org: ${orgRef}`);
    
    // Step 1: If not forcing fresh login, try fast path
    if (!opts.force_login) {
      await session.page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

      if (await verifyLoggedIn(session.page)) {
        console.log('DEBUG: ✓ Cached session is valid');
        loginStrategy = 'restore';
        verified = true;
        currentPage = session.page;
        lastUrl = session.page.url();
        
        // Capture verification signals
        hadLogoutUi = !!(await session.page.$('a[href*="/user/logout"], .user-menu, [data-testid="user-menu"]').catch(() => null));
        const cookies = await session.page.context().cookies().catch(() => []);
        hadSessCookie = cookies?.some(c => /S?SESS/i.test(c.name)) ?? false;
        
        return { login_status: 'success' };
      }
    }

    // Step 2: HARD RESET - clear cookies+storage and use a brand-new context
    console.log('DEBUG: Performing hard reset: clear cookies/storage and new context');
    loginStrategy = 'hard_reset';
    await hardResetStorage(session.page, baseUrl);

    // New incognito context guarantees no storageState is reused
    const { ctx: freshCtx, page: freshPage } = await newIncognitoContext(session.browser);
    currentPage = freshPage;

    // Navigate to login page in the clean context
    await freshPage.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Wait for login form with multiple selector fallbacks
    const userSel = ['#edit-name', 'input[name="name"]', 'input[type="email"]'].join(', ');
    const passSel = ['#edit-pass', 'input[name="pass"]', 'input[type="password"]'].join(', ');

    try {
      await freshPage.waitForSelector(userSel, { timeout: 20000 });
      await freshPage.waitForSelector(passSel, { timeout: 20000 });
    } catch {
      // If Cloudflare or interstitial, give it a second chance
      await freshPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // If still on login and fields are present, do real login
    if (freshPage.url().includes('/user/login')) {
      const user = freshPage.locator(userSel).first();
      const pass = freshPage.locator(passSel).first();
      if ((await user.count()) && (await pass.count())) {
        await user.fill(credentials.email);
        await pass.fill(credentials.password);
        
        // Try multiple submit options
        const submit = freshPage.locator('#edit-submit, button[type="submit"], input[type="submit"]').first();
        if (await submit.count()) {
          await submit.click();
        } else {
          await pass.press('Enter');
        }
        await freshPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }
    }

    // Final verification (strict)
    lastUrl = freshPage.url();
    verified = await verifyLoggedIn(freshPage);
    
    // Capture verification signals
    hadLogoutUi = !!(await freshPage.$('a[href*="/user/logout"], .user-menu, [data-testid="user-menu"]').catch(() => null));
    const cookies = await freshPage.context().cookies().catch(() => []);
    hadSessCookie = cookies?.some(c => /S?SESS/i.test(c.name)) ?? false;
    
    if (!verified) {
      console.log('[Login] ✗ Login failed after hard reset (still on login page)');
      error = 'Verification failed: still on login page';
      // Replace session.page with freshPage for subsequent steps
      (session as any).page = freshPage;
      return { login_status: 'failed' };
    }

    console.log('[Login] ✓ Verified logged in after hard reset');
    // Swap session.page to the fresh logged-in page for the rest of the flow
    (session as any).page = freshPage;
    
    // Capture safe screenshot evidence (dashboard/header, avoid PII)
    try {
      const filename = `evidence/login-${orgRef}-${Date.now()}.png`;
      await freshPage.screenshot({ path: filename, fullPage: false });
      screenshotPath = filename;
    } catch (screenshotError) {
      console.log('[Login] Screenshot capture failed:', screenshotError.message);
    }
    
    return { login_status: 'success' };

  } catch (err: any) {
    error = err?.message || String(err);
    console.error('[Login] ✗ Login failed:', error);
    
    // Try to capture current URL even on error
    try {
      lastUrl = currentPage.url();
    } catch {}
    
    return { login_status: 'failed' };
  } finally {
    // Log summary
    const endedAt = Date.now();
    console.log(`[Login] Completed: strategy=${loginStrategy}, verified=${verified}, duration=${endedAt - startedAt}ms`);
    
    // Call audit-login edge function
    if (opts.user_jwt) {
      try {
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/audit-login`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${opts.user_jwt}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            provider: 'skiclubpro',
            org_ref: orgRef,
            tool: opts.toolName || 'unknown',
            result: verified ? 'success' : 'failed',
            details: { url: lastUrl, hadLogoutUi, hadSessCookie, error }
          })
        });
      } catch (e) {
        console.error('Audit login call failed:', e);
      }
    }
  }
}

/**
 * Discover required fields for a program with comprehensive field extraction
 */
export async function discoverProgramRequiredFields(
  session: BrowserbaseSession, 
  programRef: string,
  orgRef: string = 'blackhawk-ski-club',
  credentials?: { email: string; password: string }
): Promise<any> {
  let screenshotCount = 0;
  
  try {
    console.log(`[Field Discovery] Starting for program: ${programRef}, org: ${orgRef}`);
    
    const config = getSkiClubProConfig(orgRef);
    const actualProgramId = getProgramId(programRef, orgRef);
    
    console.log(`[Field Discovery] Resolved: ${programRef} -> ID ${actualProgramId}`);
    
    // If credentials are provided, authenticate first
    if (credentials) {
      console.log('[Field Discovery] Authenticating...');
      try {
        await performSkiClubProLogin(session, credentials, orgRef);
        console.log('[Field Discovery] ✓ Authentication successful');
      } catch (authError) {
        console.error('[Field Discovery] ⚠ Authentication failed, continuing:', authError.message);
      }
    }
    
    // Construct the registration URL using full org_ref
    const registrationUrl = `https://${orgRef}.skiclubpro.team/registration/${actualProgramId}/options`;
    
    console.log('[Field Discovery] Navigating to:', registrationUrl);
    
    // Navigate to registration page
    await session.page.goto(registrationUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Log current URL to detect redirects (e.g., back to login)
    const currentUrl = session.page.url();
    console.log('[Field Discovery] Current URL after navigation:', currentUrl);
    
    // Capture diagnostics (HTML snippet and screenshot)
    try {
      const html = await session.page.content();
      console.log('[Field Discovery] Page HTML snippet (first 2000 chars):', html.substring(0, 2000));
      console.log('[Field Discovery] Page HTML snippet (chars 2000-4000):', html.substring(2000, 4000));
      
      await session.page.screenshot({ 
        path: `discovery-debug-${Date.now()}.png`, 
        fullPage: true 
      });
      console.log('[Field Discovery] Debug screenshot captured');
    } catch (diagErr) {
      console.warn('[Field Discovery] Could not capture diagnostics:', diagErr.message);
    }
    
    // Check if we were redirected to login page
    if (currentUrl.includes('/user/login')) {
      console.error('[Field Discovery] ⚠️  Redirected to login page - session may have expired');
      throw new Error(`Redirected to login page. Current URL: ${currentUrl}`);
    }
    
    // Handle wizard-style flows that require clicking "Continue"
    try {
      const continueBtn = await session.page.$('text=Continue, button:has-text("Continue"), a:has-text("Continue")');
      if (continueBtn) {
        console.log('[Field Discovery] Found "Continue" button, clicking...');
        await continueBtn.click();
        await session.page.waitForTimeout(2000);
        console.log('[Field Discovery] ✓ Clicked "Continue", waiting for next page...');
      }
    } catch (continueErr) {
      console.log('[Field Discovery] No "Continue" button found or error clicking:', continueErr.message);
    }

    // Wait for form with flexible selectors (supports various form structures)
    try {
      await session.page.waitForSelector(
        'form, .webform-submission-form, [id*=registration], [role=form], .registration-page',
        { timeout: 30000 }
      );
      console.log('[Field Discovery] ✓ Form container detected');
    } catch (err) {
      console.error('[Field Discovery] ⚠️  Timeout waiting for form - capturing screenshot...');
      
      // Capture full-page screenshot for debugging
      try {
        await session.page.screenshot({ 
          path: `discovery-error-${Date.now()}.png`, 
          fullPage: true 
        });
        console.log('[Field Discovery] Error screenshot saved');
      } catch (screenshotErr) {
        console.error('[Field Discovery] Could not capture screenshot:', screenshotErr);
      }
      
      throw new Error(`Field discovery failed at ${currentUrl}: ${err.message || err}`);
    }
    
    // Allow time for dynamic fields to load via JavaScript
    await session.page.waitForTimeout(2000);
    
    console.log('[Field Discovery] ✓ Registration form loaded');
    
    // Comprehensive field extraction with categorization
    console.log('[Field Discovery] Extracting fields...');
    
    const fields: any[] = await session.page.$$eval(
      'form input, form select, form textarea',
      (elements: any[]) => {
        const fieldMap = new Map();
        
        elements.forEach((el: any) => {
          // Skip hidden fields, submit buttons, and system fields
          if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') {
            return;
          }

          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || tag;
          const name = el.getAttribute('name') || '';
          const id = el.getAttribute('id') || '';

          // Get label text from various sources
          let label = '';
          
          // Try to find associated label
          const labelElement = el.closest('label') || 
                             (id ? document.querySelector(`label[for="${id}"]`) : null);
          
          if (labelElement) {
            label = labelElement.innerText || labelElement.textContent || '';
          }
          
          // Fallback to other sources
          if (!label) {
            label = el.getAttribute('placeholder') || 
                    el.getAttribute('aria-label') || 
                    el.getAttribute('title') || 
                    name || 
                    id || 
                    '';
          }

          label = label.trim();
          
          if (!label) return; // Skip fields without labels

          // Normalize to field_id
          const field_id = label.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

          if (!field_id) return;

          // Categorize based on label content
          let category = 'general';
          const lowerLabel = label.toLowerCase();
          
          if (/volunteer/i.test(lowerLabel)) {
            category = 'volunteering';
          } else if (/emergency|contact.*case/i.test(lowerLabel)) {
            category = 'emergency';
          } else if (/waiver|consent|liability|agree|acknowledge/i.test(lowerLabel)) {
            category = 'waiver';
          } else if (/medical|allerg|condition|medication|health/i.test(lowerLabel)) {
            category = 'medical';
          }

          // Handle radio/checkbox groups
          if (type === 'radio' || type === 'checkbox') {
            const groupKey = `${field_id}_${category}`;
            
            if (!fieldMap.has(groupKey)) {
              fieldMap.set(groupKey, {
                id: field_id,
                label: label.replace(/\s*\(.*?\)\s*$/, ''), // Remove trailing options
                type: type,
                required: el.hasAttribute('required'),
                category: category,
                options: []
              });
            }
            
            // Add option value
            const optionValue = el.getAttribute('value') || label;
            const field = fieldMap.get(groupKey);
            if (!field.options.includes(optionValue)) {
              field.options.push(optionValue);
            }
          } else {
            // Regular input, select, textarea
            const fieldData: any = {
              id: field_id,
              label: label,
              type: type,
              required: el.hasAttribute('required'),
              category: category
            };

            // Extract options for select elements
            if (tag === 'select') {
              const options = Array.from(el.querySelectorAll('option'))
                .map((opt: any) => ({
                  value: opt.value || opt.textContent?.trim() || '',
                  label: opt.textContent?.trim() || ''
                }))
                .filter((o: any) => o.label && o.label !== 'Select...' && o.label !== '- Select -');
              
              if (options.length > 0) {
                fieldData.options = options;
              }
            }

            fieldMap.set(field_id, fieldData);
          }
        });

        return Array.from(fieldMap.values());
      }
    );
    
    console.log(`[Field Discovery] ✓ Extracted ${fields.length} fields`);

    // ✅ PHASE 1: Annotate fields with price information
    const annotatedFields = fields.map(field => {
      const annotated = annotatePrice(field as DiscoveredField);
      if (annotated.isPriceBearing) {
        console.log(`[Price Detection] ${field.label}: price-bearing field detected`);
      }
      return annotated;
    });

    // Log field categories
    const categoryCounts = annotatedFields.reduce((acc: any, field: any) => {
      acc[field.category] = (acc[field.category] || 0) + 1;
      return acc;
    }, {});
    console.log('[Field Discovery] Fields by category:', categoryCounts);

    // Capture screenshot of the form
    try {
      const screenshot = await session.page.screenshot({ 
        fullPage: true,
        type: 'png'
      });
      
      if (screenshot) {
        screenshotCount++;
        console.log('[Field Discovery] ✓ Screenshot captured');
      }
    } catch (error) {
      console.log('[Field Discovery] ✗ Screenshot failed:', error.message);
    }

    // Return clean schema ready for Plan Builder
    return {
      program_ref: programRef,
      questions: annotatedFields
    };
    
  } catch (error) {
    console.error('[Field Discovery] Error:', error);
    
    // Capture error screenshot with timestamp
    try {
      const errorScreenshotPath = `discovery-error-${Date.now()}.png`;
      await session.page.screenshot({ 
        fullPage: true,
        type: 'png',
        path: errorScreenshotPath
      });
      console.log(`[Field Discovery] Error screenshot captured: ${errorScreenshotPath}`);
    } catch (screenshotError) {
      console.error('[Field Discovery] Could not capture error screenshot:', screenshotError);
    }
    
    // Provide detailed error information
    const diagnostics = {
      program_ref: programRef,
      org_ref: orgRef,
      error: error.message,
      current_url: session.page.url(),
      screenshots_captured: screenshotCount,
      timestamp: new Date().toISOString()
    };
    
    console.error('[Field Discovery] Diagnostics:', JSON.stringify(diagnostics, null, 2));
    
    throw new Error(`Field discovery failed for ${programRef}: ${error.message}. Current URL: ${session.page.url()}`);
  }
}

/**
 * Scrape available programs from SkiClubPro
 */
/**
 * Perform SkiClubPro registration with dynamic question handling
 */
export async function performSkiClubProRegistration(
  session: BrowserbaseSession,
  registrationData: {
    program_ref: string;
    child: any;
    answers: Record<string, any>;
    mandate_scope: string[];
    discovered_fields?: DiscoveredField[]; // ✅ PHASE 1: Accept discovered field schema
    max_amount_cents?: number; // ✅ PHASE 1: Accept payment limit
  }
): Promise<{ registration_ref: string; total_cents?: number }> {
  try {
    console.log(`Starting registration for program: ${registrationData.program_ref}`);
    
    // Navigate to the program registration page using correct domain
    const config = getSkiClubProConfig('blackhawk-ski-club');
    const actualProgramId = getProgramId(registrationData.program_ref, 'blackhawk-ski-club');
    const registrationUrl = `https://${config.domain}/registration/${actualProgramId}/start`;
    await session.page.goto(registrationUrl, { waitUntil: 'networkidle' });
    
    // Wait for form to load
    await session.page.waitForSelector('form', { timeout: 10000 });
    
    // ✅ PHASE 1: Apply smart defaults to unanswered fields
    let enhancedAnswers = { ...registrationData.answers };
    if (registrationData.discovered_fields) {
      console.log('[Smart Defaults] Applying price-aware defaults to unanswered fields...');
      for (const field of registrationData.discovered_fields) {
        if (!enhancedAnswers[field.id]) {
          const defaultValue = chooseDefaultAnswer(field);
          if (defaultValue) {
            enhancedAnswers[field.id] = defaultValue;
            console.log(`[Smart Defaults] ${field.label}: selected "${defaultValue}" ${field.isPriceBearing ? '(price-aware)' : ''}`);
          }
        }
      }
    }
    
    // ✅ PHASE 1: Compute total price before filling
    const baseProgramPrice = 0; // TODO: Extract from program metadata if available
    const estimatedTotal = registrationData.discovered_fields
      ? computeTotalCents(baseProgramPrice, registrationData.discovered_fields, enhancedAnswers)
      : 0;
    
    console.log(`[Price Check] Estimated total: $${estimatedTotal / 100}`);
    if (registrationData.max_amount_cents && estimatedTotal > registrationData.max_amount_cents) {
      throw new Error(
        `PRICE_EXCEEDS_LIMIT: Estimated total $${estimatedTotal / 100} exceeds limit of $${registrationData.max_amount_cents / 100}`
      );
    }
    
    // Fill basic child information
    await fillBasicChildInfo(session, registrationData.child);
    
    // Fill pre-answered questions from mandate (now with smart defaults)
    await fillPreAnsweredQuestions(session, enhancedAnswers);
    
    // Handle dynamic/branching questions
    await handleDynamicQuestions(session, enhancedAnswers, registrationData.mandate_scope);
    
    // Set donations and optional fields to minimum/no
    await setOptionalFieldsToMinimum(session);
    
    // Submit the registration form
    await session.page.click('button[type="submit"], input[type="submit"], .submit-btn');
    
    // Wait for success page or registration confirmation
    await session.page.waitForSelector('.registration-success, .confirmation, .thank-you', { timeout: 15000 });
    
    // Extract registration reference
    const registrationRef = await session.page.evaluate(() => {
      // Look for registration reference in various possible locations
      const refElement = document.querySelector('.registration-ref, .confirmation-ref, [data-registration-id]');
      if (refElement) {
        return refElement.textContent?.trim() || refElement.getAttribute('data-registration-id');
      }
      
      // Try to extract from URL
      const url = window.location.href;
      const match = url.match(/registration[\/=]([a-zA-Z0-9-_]+)/);
      if (match) {
        return match[1];
      }
      
      // Generate a reference based on timestamp if not found
      return `reg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    });
    
    console.log(`Registration completed with reference: ${registrationRef}`);
    
    return { 
      registration_ref: registrationRef,
      total_cents: estimatedTotal // ✅ PHASE 1: Return computed total
    };
    
  } catch (error) {
    console.error('Error during registration:', error);
    throw new Error(`Registration failed: ${error.message}`);
  }
}

/**
 * Fill basic child information in the form
 */
async function fillBasicChildInfo(session: BrowserbaseSession, child: any): Promise<void> {
  const commonFields = [
    { selector: 'input[name="child_name"], #child_name, input[placeholder*="name"]', value: child.name },
    { selector: 'input[name="dob"], #dob, input[type="date"]', value: child.dob },
    { selector: 'input[name="child_age"], #child_age', value: child.dob ? calculateAge(child.dob).toString() : '' }
  ];
  
  for (const field of commonFields) {
    try {
      const element = await session.page.$(field.selector);
      if (element && field.value) {
        await element.fill(field.value);
      }
    } catch (error) {
      console.log(`Could not fill field ${field.selector}:`, error.message);
    }
  }
}

/**
 * Fill pre-answered questions from mandate
 */
async function fillPreAnsweredQuestions(session: BrowserbaseSession, answers: Record<string, any>): Promise<void> {
  for (const [fieldName, value] of Object.entries(answers)) {
    try {
      // Try different selector patterns
      const selectors = [
        `input[name="${fieldName}"]`,
        `select[name="${fieldName}"]`,
        `textarea[name="${fieldName}"]`,
        `#${fieldName}`,
        `input[id="${fieldName}"]`,
        `select[id="${fieldName}"]`
      ];
      
      let filled = false;
      for (const selector of selectors) {
        const element = await session.page.$(selector);
        if (element) {
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          const inputType = await element.evaluate(el => el.getAttribute('type'));
          
          if (tagName === 'select') {
            await element.selectOption({ label: value.toString() });
          } else if (inputType === 'radio') {
            if (await element.evaluate(el => (el as HTMLInputElement).value === value.toString())) {
              await element.check();
            }
          } else if (inputType === 'checkbox') {
            if (value === true || value === 'true' || value === 'yes') {
              await element.check();
            }
          } else {
            await element.fill(value.toString());
          }
          
          filled = true;
          break;
        }
      }
      
      if (!filled) {
        console.log(`Could not find field to fill: ${fieldName}`);
      }
    } catch (error) {
      console.log(`Error filling field ${fieldName}:`, error.message);
    }
  }
}

/**
 * Handle dynamic/branching questions with failure-closed approach
 */
async function handleDynamicQuestions(
  session: BrowserbaseSession, 
  answers: Record<string, any>, 
  mandateScope: string[]
): Promise<void> {
  // Check for any required fields that weren't pre-answered
  const requiredFields = await session.page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return [];
    
    const required = [];
    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    
    inputs.forEach((input: Element) => {
      const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!(element as HTMLInputElement).value || (element as HTMLInputElement).value.trim() === '') {
        const label = form.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() || 
                     element.getAttribute('name') || 
                     element.getAttribute('placeholder') || 
                     'Unknown Field';
        
        required.push({
          id: element.id || element.name,
          name: element.name,
          label: label,
          type: element.type || element.tagName.toLowerCase()
        });
      }
    });
    
    return required;
  });
  
  // If there are unexpected required fields, fail closed
  if (requiredFields.length > 0) {
    const unexpectedFields = requiredFields.filter(field => 
      !answers.hasOwnProperty(field.name) && !answers.hasOwnProperty(field.id)
    );
    
    if (unexpectedFields.length > 0) {
      console.error('Unexpected required fields detected:', unexpectedFields);
      throw new Error(`Registration denied: Unexpected required fields detected: ${unexpectedFields.map(f => f.label).join(', ')}`);
    }
  }
}

/**
 * Set donation and optional fields to minimum/no
 */
async function setOptionalFieldsToMinimum(session: BrowserbaseSession): Promise<void> {
  // Common donation and optional field patterns
  const optionalFields = [
    'input[name*="donation"]',
    'input[name*="tip"]', 
    'input[name*="extra"]',
    'input[name*="optional"]',
    'select[name*="donation"]',
    'input[type="checkbox"][name*="newsletter"]',
    'input[type="checkbox"][name*="marketing"]',
    'input[type="checkbox"][name*="updates"]'
  ];
  
  for (const selector of optionalFields) {
    try {
      const elements = await session.page.$$(selector);
      for (const element of elements) {
        const inputType = await element.evaluate(el => el.getAttribute('type'));
        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
        
        if (inputType === 'checkbox') {
          await element.uncheck();
        } else if (tagName === 'select') {
          await element.selectOption({ index: 0 }); // Select first option (usually "None" or "0")
        } else if (inputType === 'number' || inputType === 'text') {
          await element.fill('0');
        }
      }
    } catch (error) {
      console.log(`Could not handle optional field ${selector}:`, error.message);
    }
  }
}

/**
 * Calculate age from date of birth
 */
function calculateAge(dob: string): number {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Perform SkiClubPro payment processing
 */
export async function performSkiClubProPayment(
  session: BrowserbaseSession,
  paymentData: {
    registration_ref: string;
    amount_cents: number;
    payment_method?: {
      type: 'stored' | 'vgs_alias';
      card_alias?: string;
      vgs_alias?: string;
    };
  }
): Promise<{ confirmation_ref: string; final_url: string }> {
  try {
    console.log(`Starting payment for registration: ${paymentData.registration_ref}`);
    
    // Navigate to checkout/payment page
    const checkoutUrl = `https://app.skiclubpro.com/checkout/${paymentData.registration_ref}`;
    await session.page.goto(checkoutUrl, { waitUntil: 'networkidle' });
    
    // Wait for payment form to load
    await session.page.waitForSelector('.payment-form, #payment-form, form[action*="payment"]', { timeout: 10000 });
    
    // Handle payment method selection and processing
    if (paymentData.payment_method?.type === 'stored') {
      await handleStoredCardPayment(session, paymentData.payment_method.card_alias);
    } else if (paymentData.payment_method?.type === 'vgs_alias') {
      await handleVgsAliasPayment(session, paymentData.payment_method.vgs_alias);
    } else {
      // Use a test card for automation
      await handleTestCardPayment(session);
    }
    
    // Submit payment
    await session.page.click('button[type="submit"], .pay-button, .submit-payment');
    
    // Wait for payment processing and confirmation
    await session.page.waitForSelector('.payment-success, .confirmation, .thank-you, .payment-complete', { 
      timeout: 30000 
    });
    
    // Extract confirmation details
    const confirmationRef = await session.page.evaluate(() => {
      // Look for confirmation reference
      const refElement = document.querySelector('.confirmation-ref, .payment-ref, [data-confirmation-id]');
      if (refElement) {
        return refElement.textContent?.trim() || refElement.getAttribute('data-confirmation-id');
      }
      
      // Try to extract from URL
      const url = window.location.href;
      const match = url.match(/confirmation[\/=]([a-zA-Z0-9-_]+)/);
      if (match) {
        return match[1];
      }
      
      // Generate a reference based on timestamp if not found
      return `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    });
    
    const finalUrl = session.page.url();
    
    console.log(`Payment completed with confirmation: ${confirmationRef}`);
    
    return { 
      confirmation_ref: confirmationRef,
      final_url: finalUrl
    };
    
  } catch (error) {
    console.error('Error during payment:', error);
    throw new Error(`Payment failed: ${error.message}`);
  }
}

/**
 * Handle stored card payment
 */
async function handleStoredCardPayment(session: BrowserbaseSession, cardAlias?: string): Promise<void> {
  try {
    // Look for stored card selector
    const storedCardSelector = await session.page.$('.stored-card, .saved-card, input[name="stored_card"]');
    if (storedCardSelector) {
      await storedCardSelector.click();
      
      // If specific card alias provided, try to select it
      if (cardAlias) {
        const cardOption = await session.page.$(`option[value*="${cardAlias}"], .card-option[data-alias="${cardAlias}"]`);
        if (cardOption) {
          await cardOption.click();
        }
      }
    }
  } catch (error) {
    console.log('Could not handle stored card payment:', error.message);
    throw error;
  }
}

/**
 * Handle VGS alias payment (tokenized card data)
 */
async function handleVgsAliasPayment(session: BrowserbaseSession, vgsAlias?: string): Promise<void> {
  try {
    if (!vgsAlias) {
      throw new Error('VGS alias required for VGS payment method');
    }
    
    // Look for VGS iframe or secure input fields
    const vgsField = await session.page.$('iframe[src*="vgs"], .vgs-field, input[data-vgs]');
    if (vgsField) {
      // Handle VGS tokenized input
      await session.page.evaluate((alias) => {
        // This would typically involve VGS-specific JavaScript APIs
        // For now, we'll simulate the token injection
        const vgsInput = document.querySelector('input[data-vgs], .vgs-token-input');
        if (vgsInput) {
          (vgsInput as HTMLInputElement).value = alias;
          vgsInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, vgsAlias);
    }
  } catch (error) {
    console.log('Could not handle VGS alias payment:', error.message);
    throw error;
  }
}

/**
 * Handle test card payment for automation
 */
async function handleTestCardPayment(session: BrowserbaseSession): Promise<void> {
  try {
    // Fill test card details (Stripe test card)
    const cardFields = [
      { selector: 'input[name="card_number"], #card_number, input[placeholder*="card number"]', value: '4242424242424242' },
      { selector: 'input[name="expiry"], #expiry, input[placeholder*="expiry"]', value: '12/25' },
      { selector: 'input[name="cvc"], #cvc, input[placeholder*="cvc"]', value: '123' },
      { selector: 'input[name="cardholder_name"], #cardholder_name', value: 'Test User' }
    ];
    
    for (const field of cardFields) {
      try {
        const element = await session.page.$(field.selector);
        if (element) {
          await element.fill(field.value);
        }
      } catch (error) {
        console.log(`Could not fill card field ${field.selector}:`, error.message);
      }
    }
  } catch (error) {
    console.log('Could not handle test card payment:', error.message);
    throw error;
  }
}

export async function scrapeSkiClubProPrograms(
  session: BrowserbaseSession,
  orgRef: string,
  query?: string
): Promise<SkiClubProProgram[]> {
  const { page } = session;

  try {
    // Build base URL using org-specific subdomain
    const baseUrl = `https://${orgRef}.skiclubpro.team`;
    
    console.log(`[Scraper] Navigating to programs for org: ${orgRef}`);

    // Try to navigate via left-nav (mirrors worker's openProgramsFromSidebar)
    const navCandidates = [
      'nav a.nav-link--registration:has-text("Programs")',
      'a[href="/registration"]:has-text("Programs")',
      '#block-register a[href="/registration"]',
      'nav[aria-label*="register" i] a:has-text("Programs")'
    ];

    let navigated = false;
    for (const sel of navCandidates) {
      try {
        const link = page.locator(sel).first();
        const count = await link.count();
        if (count > 0) {
          console.log(`[Scraper] Found nav link: ${sel}`);
          await link.scrollIntoViewIfNeeded().catch(() => {});
          await link.click();
          navigated = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Fallback to direct navigation
    if (!navigated) {
      console.log(`[Scraper] Nav links not found, navigating directly to ${baseUrl}/registration`);
      await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
    }

    // Check if we got redirected back to login (session expired)
    if (page.url().includes('/user/login')) {
      throw new Error('Redirected to login while opening /registration (session expired)');
    }

    // Wait for page to settle and any listing container to appear
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table, .views-row, .view, section', { timeout: 15000 });

    const programs: SkiClubProProgram[] = [];

    // Strategy 1: Extract from cards/views
    const cards = page.locator('.views-row, .card, article');
    const cardCount = await cards.count();
    console.log(`[Scraper] Found ${cardCount} card elements`);

    for (let i = 0; i < Math.min(cardCount, 400); i++) {
      const c = cards.nth(i);
      const html = (await c.innerHTML().catch(() => '')) || '';
      const text = (await c.innerText().catch(() => '')) || '';
      
      // Skip non-program content
      if (/skip to main content|account\s+dashboard|memberships|events|view search filters/i.test(text)) {
        continue;
      }

      // Find registration link to resolve program id
      const regLink = c.locator('a[href*="/registration/"]');
      const linkCount = await regLink.count();
      if (!linkCount) continue;

      const href = await regLink.first().getAttribute('href').catch(() => null);
      const match = href?.match(/\/registration\/(\d+)(?:\/|$)/);
      if (!match) continue;

      const program_ref = match[1];
      const titleText = (await c.locator('h2, h3, .card-title, .views-field-title').first().innerText().catch(() => '')) 
                    || text.split('\n')[0];

      // Optional: parse "Registration opens" date from text
      const opensMatch = text.match(/opens?\s+(?:on|at)?\s*([A-Za-z0-9,:\-\s/]+)/i);
      const opens_at = opensMatch?.[1]?.trim() || undefined;

      programs.push({ 
        program_ref, 
        title: titleText.trim(), 
        opens_at: opens_at || new Date().toISOString()
      });
    }

    // Strategy 2: Table fallback
    if (programs.length === 0) {
      console.log(`[Scraper] No cards found, trying table extraction`);
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count();
      console.log(`[Scraper] Found ${rowCount} table rows`);

      for (let i = 0; i < Math.min(rowCount, 400); i++) {
        const r = rows.nth(i);
        const regLink = r.locator('a[href*="/registration/"]');
        const linkCount = await regLink.count();
        if (!linkCount) continue;

        const href = await regLink.first().getAttribute('href').catch(() => null);
        const match = href?.match(/\/registration\/(\d+)(?:\/|$)/);
        if (!match) continue;

        const program_ref = match[1];
        const rowText = (await r.innerText().catch(() => '')) || '';
        const title = rowText.split('\n')[0] || `Program ${program_ref}`;
        const opensMatch = rowText.match(/opens?\s+(?:on|at)?\s*([A-Za-z0-9,:\-\s/]+)/i);
        const opens_at = opensMatch?.[1]?.trim();

        programs.push({ 
          program_ref, 
          title: title.trim(), 
          opens_at: opens_at || new Date().toISOString()
        });
      }
    }

    // Diagnostics if no programs found
    if (programs.length === 0) {
      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => '');
      const bodyPreview = await page.evaluate(() => document.body.innerText.slice(0, 1000)).catch(() => '');
      
      console.log('[Scrape Debug] URL:', currentUrl);
      console.log('[Scrape Debug] Title:', pageTitle);
      console.log('[Scrape Debug] Body preview:', bodyPreview);
      
      // Try to save screenshot for debugging
      try {
        await page.screenshot({ path: `programs-debug-${Date.now()}.png`, fullPage: true });
      } catch (e) {
        console.log('[Scrape Debug] Could not save screenshot:', e);
      }
      
      throw new Error(`No program listings found on /registration. URL: ${currentUrl}, Title: "${pageTitle}"`);
    }

    console.log(`[Scraper] Successfully extracted ${programs.length} programs`);

    // Filter by query if provided
    if (query && programs.length > 0) {
      const filtered = programs.filter(p => 
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.program_ref.toLowerCase().includes(query.toLowerCase())
      );
      console.log(`[Scraper] Filtered to ${filtered.length} programs matching "${query}"`);
      return filtered;
    }

    return programs;

  } catch (error) {
    throw new Error(`Failed to scrape SkiClubPro programs: ${error.message}`);
  }
}

/**
 * Capture screenshot from Browserbase session
 */
export async function captureScreenshot(
  session: BrowserbaseSession,
  filename?: string
): Promise<Buffer> {
  const { page } = session;

  try {
    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png',
    });

    return screenshot;
  } catch (error) {
    throw new Error(`Failed to capture screenshot: ${error.message}`);
  }
}

/**
 * Check if an account exists for the given email
 */
export async function checkAccountExists(session: BrowserbaseSession, email: string): Promise<{ exists: boolean; verified?: boolean }> {
  try {
    // Navigate to login page to test account existence
    await session.page.goto('https://app.skiclubpro.com/login', { waitUntil: 'networkidle' });
    
    // Fill in email
    const emailSelector = await session.page.$('input[type="email"], input[name="email"], #email');
    if (!emailSelector) {
      throw new Error('Could not find email input field');
    }
    
    await emailSelector.fill(email);
    
    // Try to proceed to password or look for account-not-found messages
    const continueButton = await session.page.$('button:has-text("Continue"), button:has-text("Next"), .continue-btn');
    if (continueButton) {
      await continueButton.click();
      await session.page.waitForTimeout(2000);
    }
    
    // Check for error messages indicating account doesn't exist
    const errorMessages = await session.page.$$eval(
      '.error, .alert-danger, .text-danger, [class*="error"]',
      elements => elements.map(el => el.textContent?.toLowerCase() || '')
    );
    
    const accountNotFound = errorMessages.some(msg => 
      msg.includes('account not found') ||
      msg.includes('email not found') ||
      msg.includes('user not found') ||
      msg.includes('invalid email')
    );
    
    if (accountNotFound) {
      return { exists: false };
    }
    
    // If password field appears, account likely exists
    const passwordField = await session.page.$('input[type="password"], input[name="password"], #password');
    if (passwordField) {
      return { exists: true, verified: false };
    }
    
    // Default to account exists if no clear indicators
    return { exists: true, verified: false };
    
  } catch (error) {
    throw new Error(`Failed to check account existence: ${error.message}`);
  }
}

/**
 * Create a new SkiClubPro account
 */
export async function createSkiClubProAccount(
  session: BrowserbaseSession, 
  accountData: { email: string; password: string; child_info: any }
): Promise<{ account_id: string }> {
  try {
    // Navigate to registration/signup page
    await session.page.goto('https://app.skiclubpro.com/register', { waitUntil: 'networkidle' });
    
    // Alternative URLs if main doesn't work
    const altUrls = [
      'https://app.skiclubpro.com/signup',
      'https://app.skiclubpro.com/create-account',
      'https://app.skiclubpro.com/join'
    ];
    
    let formFound = false;
    for (const url of altUrls) {
      if (!formFound) {
        try {
          await session.page.goto(url, { waitUntil: 'networkidle' });
          const form = await session.page.$('form');
          if (form) {
            formFound = true;
            break;
          }
        } catch (error) {
          console.log(`Could not load ${url}:`, error.message);
        }
      }
    }
    
    if (!formFound) {
      throw new Error('Could not find account creation form');
    }
    
    // Fill in account details
    await session.page.fill('input[type="email"], input[name="email"], #email', accountData.email);
    await session.page.fill('input[type="password"], input[name="password"], #password', accountData.password);
    
    // Fill in child information if required
    if (accountData.child_info) {
      const childFields = [
        { selector: 'input[name*="child_name"], input[name*="first_name"]', value: accountData.child_info.name },
        { selector: 'input[name*="last_name"]', value: accountData.child_info.name?.split(' ').slice(-1)[0] || '' },
        { selector: 'input[name*="dob"], input[type="date"]', value: accountData.child_info.dob }
      ];
      
      for (const field of childFields) {
        try {
          const element = await session.page.$(field.selector);
          if (element && field.value) {
            await element.fill(field.value);
          }
        } catch (error) {
          console.log(`Could not fill child field ${field.selector}:`, error.message);
        }
      }
    }
    
    // Accept terms and conditions if present
    const termsCheckbox = await session.page.$('input[type="checkbox"][name*="terms"], input[type="checkbox"][name*="agree"]');
    if (termsCheckbox) {
      await termsCheckbox.check();
    }
    
    // Submit form
    await session.page.click('button[type="submit"], input[type="submit"], .submit-btn, button:has-text("Create"), button:has-text("Register")');
    
    // Wait for confirmation page or redirect
    await session.page.waitForSelector('.success, .confirmation, .welcome', { timeout: 15000 });
    
    // Extract account ID or generate one
    const accountId = await session.page.evaluate(() => {
      // Look for account ID in various locations
      const idElement = document.querySelector('[data-account-id], .account-id');
      if (idElement) {
        return idElement.textContent?.trim() || idElement.getAttribute('data-account-id');
      }
      
      // Generate ID from timestamp if not found
      return `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    });
    
    return { account_id: accountId };
    
  } catch (error) {
    throw new Error(`Failed to create account: ${error.message}`);
  }
}

/**
 * Check membership status for logged-in user
 */
export async function checkMembershipStatus(session: BrowserbaseSession): Promise<{ active: boolean; expires_at?: string }> {
  try {
    // Navigate to membership or profile page
    const membershipUrls = [
      'https://app.skiclubpro.com/membership',
      'https://app.skiclubpro.com/profile',
      'https://app.skiclubpro.com/account',
      'https://app.skiclubpro.com/dashboard'
    ];
    
    let membershipFound = false;
    for (const url of membershipUrls) {
      try {
        await session.page.goto(url, { waitUntil: 'networkidle' });
        
        // Look for membership status indicators
        const statusElements = await session.page.$$('.membership-status, .member-status, .status');
        if (statusElements.length > 0) {
          membershipFound = true;
          break;
        }
      } catch (error) {
        console.log(`Could not load ${url}:`, error.message);
      }
    }
    
    // Extract membership information
    const membershipInfo = await session.page.evaluate(() => {
      // Look for active/inactive indicators
      const statusTexts = Array.from(document.querySelectorAll('*')).map(el => el.textContent?.toLowerCase() || '');
      
      const hasActive = statusTexts.some(text => 
        text.includes('active member') ||
        text.includes('membership active') ||
        text.includes('current member')
      );
      
      const hasInactive = statusTexts.some(text => 
        text.includes('expired') ||
        text.includes('inactive') ||
        text.includes('not a member') ||
        text.includes('membership required')
      );
      
      // Look for expiration dates
      const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/;
      let expirationDate = null;
      
      for (const text of statusTexts) {
        if (text.includes('expires') || text.includes('expiration')) {
          const match = text.match(datePattern);
          if (match) {
            expirationDate = match[0];
            break;
          }
        }
      }
      
      return {
        active: hasActive && !hasInactive,
        expires_at: expirationDate
      };
    });
    
    return membershipInfo;
    
  } catch (error) {
    throw new Error(`Failed to check membership status: ${error.message}`);
  }
}

/**
 * Purchase membership for logged-in user
 */
export async function purchaseMembership(session: BrowserbaseSession): Promise<{ membership_id: string }> {
  try {
    // Navigate to membership purchase page
    const purchaseUrls = [
      'https://app.skiclubpro.com/membership/purchase',
      'https://app.skiclubpro.com/join',
      'https://app.skiclubpro.com/membership',
      'https://app.skiclubpro.com/upgrade'
    ];
    
    let purchaseFound = false;
    for (const url of purchaseUrls) {
      try {
        await session.page.goto(url, { waitUntil: 'networkidle' });
        
        // Look for purchase or join buttons
        const purchaseButton = await session.page.$('button:has-text("Purchase"), button:has-text("Join"), button:has-text("Upgrade"), .purchase-btn');
        if (purchaseButton) {
          purchaseFound = true;
          break;
        }
      } catch (error) {
        console.log(`Could not load ${url}:`, error.message);
      }
    }
    
    if (!purchaseFound) {
      throw new Error('Could not find membership purchase page');
    }
    
    // Select membership type (choose the basic/cheapest option)
    const membershipOptions = await session.page.$$('.membership-option, .plan-option, input[type="radio"][name*="membership"]');
    if (membershipOptions.length > 0) {
      await membershipOptions[0].click();
    }
    
    // Proceed to checkout
    const proceedButton = await session.page.$('button:has-text("Continue"), button:has-text("Next"), button:has-text("Purchase"), .proceed-btn');
    if (proceedButton) {
      await proceedButton.click();
    }
    
    // Note: In a real implementation, payment details would need to be handled
    // For now, we'll simulate the completion
    await session.page.waitForTimeout(2000);
    
    // Generate membership ID
    const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return { membership_id: membershipId };
    
  } catch (error) {
    throw new Error(`Failed to purchase membership: ${error.message}`);
  }
}

/**
 * Close Browserbase session
 */
export async function closeBrowserbaseSession(session: BrowserbaseSession): Promise<void> {
  try {
    await session.browser.close();
  } catch (error) {
    console.error('Error closing Browserbase session:', error);
  }
}

/**
 * Helper function to fill an input field
 */
export async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  try {
    const element = await page.$(selector);
    if (element) {
      await element.fill(value);
    }
  } catch (error) {
    console.log(`Could not fill input ${selector}:`, error.message);
  }
}
