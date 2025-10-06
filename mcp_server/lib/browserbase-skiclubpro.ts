/**
 * SkiClubPro Configurable Browserbase Functions
 * Supports multiple organizations via selector configuration
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import Browserbase from '@browserbasehq/sdk';
import { captureScreenshotEvidence } from './evidence.js';
import { SKICLUBPRO_CONFIGS } from '../config/skiclubpro_selectors.js';
import { fillInput } from './browserbase.js';
import { createStealthContext } from './antibot.js';

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY!;

export interface BrowserbaseSession {
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
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
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!
    });

    // Connect Playwright to Browserbase
    const browser = await chromium.connectOverCDP(session.connectUrl);
    
    // Create stealth context (handles ANTIBOT_ENABLED internally)
    const context = await createStealthContext(browser);
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
 * Check if account exists on SkiClubPro for given organization
 */
export async function checkAccountExists(
  session: BrowserbaseSession, 
  org_ref: string, 
  email: string
): Promise<{ exists: boolean; verified?: boolean }> {
  const { page } = session;
  const cfg = SKICLUBPRO_CONFIGS[org_ref];
  if (!cfg) throw new Error(`No SkiClubPro config found for org_ref: ${org_ref}`);
  
  await page.goto(`https://${cfg.domain}/user/login`, { waitUntil: "networkidle" });
  await fillInput(page, cfg.selectors.loginEmail, email);
  
  // Click submit button
  await Promise.all([
    page.locator(cfg.selectors.loginSubmit).click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);
  
  const content = await page.content();
  const exists = !/account not found|no record|user does not exist/i.test(content);
  const verified = exists && !/unverified|please verify|check your email/i.test(content);
  
  return { exists, verified };
}

/**
 * Create account on SkiClubPro for given organization
 */
export async function createSkiClubProAccount(
  session: BrowserbaseSession,
  org_ref: string,
  parent: { name: string; email: string; phone?: string; password: string }
): Promise<{ account_id: string }> {
  const { page } = session;
  const cfg = SKICLUBPRO_CONFIGS[org_ref];
  if (!cfg) throw new Error(`No SkiClubPro config found for org_ref: ${org_ref}`);
  
  await page.goto(`https://${cfg.domain}/user/register`, { waitUntil: "networkidle" });
  
  await fillInput(page, cfg.selectors.createName, parent.name);
  await fillInput(page, cfg.selectors.createEmail, parent.email);
  if (parent.phone) {
    await fillInput(page, cfg.selectors.createPhone, parent.phone);
  }
  await fillInput(page, cfg.selectors.createPassword, parent.password);
  
  // Fill password confirmation if selector exists
  if (cfg.selectors.createPasswordConfirm) {
    await fillInput(page, cfg.selectors.createPasswordConfirm, parent.password);
  }
  
  await Promise.all([
    page.locator(cfg.selectors.createSubmit).click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);
  
  return { account_id: parent.email };
}

/**
 * Check membership status on SkiClubPro for given organization
 */
export async function checkMembershipStatus(
  session: BrowserbaseSession,
  org_ref: string
): Promise<{ active: boolean; expires_at?: string }> {
  const { page } = session;
  const cfg = SKICLUBPRO_CONFIGS[org_ref];
  if (!cfg) throw new Error(`No SkiClubPro config found for org_ref: ${org_ref}`);
  
  await page.goto(`https://${cfg.domain}${cfg.selectors.membershipPage}`, { waitUntil: "networkidle" });
  
  const text = await page.textContent("body");
  const active = /Active|Current Member|Expires/i.test(text || "");
  
  // Try to extract expiration date
  const expiryMatch = text?.match(/expires?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i);
  const expires_at = expiryMatch ? expiryMatch[1] : undefined;
  
  return { active, expires_at };
}

/**
 * Purchase membership on SkiClubPro for given organization
 */
export async function purchaseMembership(
  session: BrowserbaseSession,
  org_ref: string,
  opts: { 
    plan: string; 
    payment_method: { 
      type: "stored" | "vgs_alias"; 
      vgs_alias?: string;
      card_alias?: string;
    } 
  }
): Promise<{ membership_id: string; final_url: string }> {
  const { page } = session;
  const cfg = SKICLUBPRO_CONFIGS[org_ref];
  if (!cfg) throw new Error(`No SkiClubPro config found for org_ref: ${org_ref}`);
  
  await page.goto(`https://${cfg.domain}${cfg.selectors.membershipPage}`, { waitUntil: "networkidle" });
  
  // Click the button or link for the desired plan (matching by visible text)
  await page.click(`text=${opts.plan}`);
  await page.waitForNavigation({ waitUntil: "networkidle" });
  
  // Payment section
  if (opts.payment_method.type === "vgs_alias") {
    await fillInput(page, 'input[name="vgs_alias"], input[data-vgs]', opts.payment_method.vgs_alias ?? "");
  } else if (opts.payment_method.type === "stored" && opts.payment_method.card_alias) {
    await page.click(`[data-card-alias="${opts.payment_method.card_alias}"], .stored-payment-method`);
  }
  
  // Use org-specific buy button selector or fallback to generic
  const buySelector = cfg.selectors.membershipBuyButton || 'button[type="submit"], input[type="submit"]';
  await Promise.all([
    page.locator(buySelector).click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);
  
  const membership_id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const final_url = page.url();
  
  return { membership_id, final_url };
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
 * Close Browserbase session
 */
export async function closeBrowserbaseSession(session: BrowserbaseSession): Promise<void> {
  try {
    await session.browser.close();
  } catch (error) {
    console.error('Error closing Browserbase session:', error);
  }
}