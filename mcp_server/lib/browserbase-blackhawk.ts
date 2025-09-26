/**
 * Blackhawk-Specific Browserbase Functions
 * Updated to target blackhawk.skiclubpro.team with precise selectors
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Browserbase } from 'browserbase';
import { captureScreenshotEvidence } from './evidence';

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
    const bb = new Browserbase({
      apiKey: browserbaseApiKey,
    });

    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID || 'default',
    });

    // Connect Playwright to Browserbase
    const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${browserbaseApiKey}&sessionId=${session.id}`);
    const context = browser.contexts()[0] || await browser.newContext();
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
 * Utility for safe typing of inputs
 */
async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  const element = await page.$(selector);
  if (element) {
    await element.fill(value);
  }
}

/**
 * Check if account exists on Blackhawk SkiClubPro
 */
export async function checkAccountExists(session: BrowserbaseSession, email: string): Promise<{ exists: boolean; verified?: boolean }> {
  const { page } = session;
  await page.goto("https://blackhawk.skiclubpro.team/user/login", { waitUntil: "networkidle" });
  await fillInput(page, 'input[name="email"]', email);
  
  // Click "Continue" or "Next" button (Blackhawk page may label differently)
  await Promise.all([
    page.locator('button[type="submit"], input[type="submit"]').click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);
  
  const content = await page.content();
  const exists = !/account not found|no record|user does not exist/i.test(content);
  const verified = exists && !/unverified|please verify|check your email/i.test(content);
  
  return { exists, verified };
}

/**
 * Create account on Blackhawk SkiClubPro
 */
export async function createSkiClubProAccount(
  session: BrowserbaseSession, 
  parent: { name: string; email: string; phone?: string; password: string }
): Promise<{ account_id: string }> {
  const { page } = session;
  await page.goto("https://blackhawk.skiclubpro.team/user/register", { waitUntil: "networkidle" });
  
  await fillInput(page, 'input[name="name"], input[name="full_name"]', parent.name);
  await fillInput(page, 'input[name="email"]', parent.email);
  if (parent.phone) {
    await fillInput(page, 'input[name="phone"]', parent.phone);
  }
  await fillInput(page, 'input[name="password"]', parent.password);
  // Sometimes "repeat password" field needed:
  await fillInput(page, 'input[name="password_confirm"]', parent.password);
  
  await Promise.all([
    page.locator('button[type="submit"], input[type="submit"]').click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);
  
  // Return an account_id (use email or page-detected ID)
  return { account_id: parent.email };
}

/**
 * Check membership status on Blackhawk SkiClubPro
 */
export async function checkMembershipStatus(session: BrowserbaseSession): Promise<{ active: boolean; expires_at?: string }> {
  const { page } = session;
  await page.goto("https://blackhawk.skiclubpro.team/list/memberships", { waitUntil: "networkidle" });
  
  // The membership listing page may show active memberships
  const text = await page.textContent("body");
  const active = /Active|Current Member|Expires/i.test(text || "");
  
  // Try to extract expiration date
  const expiryMatch = text?.match(/expires?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i);
  const expires_at = expiryMatch ? expiryMatch[1] : undefined;
  
  return { active, expires_at };
}

/**
 * Purchase membership on Blackhawk SkiClubPro
 */
export async function purchaseMembership(
  session: BrowserbaseSession, 
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
  await page.goto("https://blackhawk.skiclubpro.team/list/memberships", { waitUntil: "networkidle" });
  
  // Click the button or link for the desired plan (matching by visible text)
  await page.click(`text=${opts.plan}`);
  await page.waitForNavigation({ waitUntil: "networkidle" });
  
  // Payment section
  if (opts.payment_method.type === "vgs_alias") {
    await fillInput(page, 'input[name="vgs_alias"], input[data-vgs]', opts.payment_method.vgs_alias ?? "");
  } else if (opts.payment_method.type === "stored" && opts.payment_method.card_alias) {
    await page.click(`[data-card-alias="${opts.payment_method.card_alias}"], .stored-payment-method`);
  }
  
  await Promise.all([
    page.locator('button[type="submit"], input[type="submit"]').click(),
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