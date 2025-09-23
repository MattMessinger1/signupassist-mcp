/**
 * Browserbase Session Management
 * Handles Playwright automation via Browserbase
 */

import { Browserbase } from 'browserbase';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

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
    const bb = new Browserbase({
      apiKey: browserbaseApiKey,
    });

    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID || 'default',
    });

    // Connect Playwright to Browserbase
    const browser = await chromium.connectOverCDT(`wss://connect.browserbase.com?apiKey=${browserbaseApiKey}&sessionId=${session.id}`);
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
 * Connect to an existing Browserbase session
 */
export async function connectToBrowserbaseSession(sessionId: string): Promise<BrowserbaseSession> {
  try {
    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }

    // Connect Playwright to existing Browserbase session
    const browser = await chromium.connectOverCDT(`wss://connect.browserbase.com?apiKey=${browserbaseApiKey}&sessionId=${sessionId}`);
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
 * Login to SkiClubPro using Playwright automation
 */
export async function performSkiClubProLogin(
  session: BrowserbaseSession,
  credentials: { email: string; password: string }
): Promise<void> {
  const { page } = session;

  try {
    // Navigate to SkiClubPro login page
    await page.goto('https://app.skiclubpro.com/login', { 
      waitUntil: 'networkidle' 
    });

    // Wait for login form
    await page.waitForSelector('input[type="email"], input[name="email"], #email', { 
      timeout: 10000 
    });

    // Fill in credentials
    const emailSelector = await page.$('input[type="email"], input[name="email"], #email');
    const passwordSelector = await page.$('input[type="password"], input[name="password"], #password');

    if (!emailSelector || !passwordSelector) {
      throw new Error('Could not find email or password input fields');
    }

    await emailSelector.fill(credentials.email);
    await passwordSelector.fill(credentials.password);

    // Click login button
    const loginButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    if (!loginButton) {
      throw new Error('Could not find login button');
    }

    await loginButton.click();

    // Wait for successful login (dashboard page)
    await page.waitForURL(/dashboard|home|main/, { 
      timeout: 15000 
    });

    // Verify we're logged in by checking for logout or profile elements
    const isLoggedIn = await page.$('.logout, .profile, .user-menu, [data-testid="user-menu"]');
    if (!isLoggedIn) {
      throw new Error('Login may have failed - could not find user menu or logout option');
    }

  } catch (error) {
    throw new Error(`SkiClubPro login failed: ${error.message}`);
  }
}

/**
 * Scrape available programs from SkiClubPro
 */
export async function scrapeSkiClubProPrograms(
  session: BrowserbaseSession,
  orgRef: string,
  query?: string
): Promise<SkiClubProProgram[]> {
  const { page } = session;

  try {
    // Navigate to programs/listings page for the organization
    const programsUrl = `https://app.skiclubpro.com/org/${orgRef}/programs`;
    await page.goto(programsUrl, { 
      waitUntil: 'networkidle' 
    });

    // Wait for programs to load
    await page.waitForSelector('.program-card, .program-item, tr[data-program], .program-listing', { 
      timeout: 10000 
    });

    // Scrape program data
    const programs = await page.evaluate(() => {
      const programElements = document.querySelectorAll('.program-card, .program-item, tr[data-program], .program-listing');
      const results: SkiClubProProgram[] = [];

      programElements.forEach((element, index) => {
        // Extract program data from different possible DOM structures
        let title = '';
        let programRef = '';
        let opensAt = '';

        // Try to find title
        const titleEl = element.querySelector('.title, .program-title, .name, h3, h4, td.title');
        if (titleEl) {
          title = titleEl.textContent?.trim() || '';
        }

        // Try to find program reference/ID
        const refEl = element.querySelector('[data-program-id], [data-ref]');
        if (refEl) {
          programRef = refEl.getAttribute('data-program-id') || refEl.getAttribute('data-ref') || '';
        } else {
          // Generate a reference based on title and index
          programRef = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + `-${index}`;
        }

        // Try to find opening date/time
        const dateEl = element.querySelector('.opens-at, .date, .start-date, td.date');
        if (dateEl) {
          opensAt = dateEl.textContent?.trim() || '';
        }

        // Convert opensAt to ISO format if possible
        if (opensAt && !opensAt.includes('T')) {
          try {
            const date = new Date(opensAt);
            if (!isNaN(date.getTime())) {
              opensAt = date.toISOString();
            }
          } catch (e) {
            // Keep original format if parsing fails
          }
        }

        if (title && programRef) {
          results.push({
            program_ref: programRef,
            title,
            opens_at: opensAt || new Date().toISOString(),
          });
        }
      });

      return results;
    });

    // Filter by query if provided
    if (query && programs.length > 0) {
      const filtered = programs.filter(p => 
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.program_ref.toLowerCase().includes(query.toLowerCase())
      );
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
 * Close Browserbase session
 */
export async function closeBrowserbaseSession(session: BrowserbaseSession): Promise<void> {
  try {
    await session.browser.close();
  } catch (error) {
    console.error('Error closing Browserbase session:', error);
  }
}
