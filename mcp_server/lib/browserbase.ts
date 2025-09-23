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
 * Discover required fields for a program with branching support
 */
export async function discoverProgramRequiredFields(session: BrowserbaseSession, programRef: string): Promise<any> {
  try {
    console.log(`Starting field discovery for program: ${programRef}`);
    
    // Navigate to the program registration page
    const registrationUrl = `https://app.skiclubpro.com/register/${programRef}`;
    await session.page.goto(registrationUrl, { waitUntil: 'networkidle' });
    
    // Wait for form to load
    await session.page.waitForSelector('form', { timeout: 10000 });
    
    // Discover form fields and branching logic
    const fieldSchema = await session.page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) {
        throw new Error('Registration form not found');
      }
      
      // Find all form fields
      const fields: any[] = [];
      const inputs = form.querySelectorAll('input, select, textarea');
      
      inputs.forEach((input: Element) => {
        const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const label = form.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() || 
                     element.getAttribute('placeholder') || 
                     element.getAttribute('name') || 
                     'Unknown Field';
        
        const field = {
          id: element.id || element.name || `field_${fields.length}`,
          label: label,
          type: element.type || element.tagName.toLowerCase(),
          required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
          options: []
        };
        
        // For select elements, capture options
        if (element.tagName.toLowerCase() === 'select') {
          const selectElement = element as HTMLSelectElement;
          field.options = Array.from(selectElement.options).map(option => option.text).filter(text => text.trim());
        }
        
        // For radio buttons, group by name
        if (element.type === 'radio') {
          const existingField = fields.find(f => f.id === element.name);
          if (existingField) {
            existingField.options.push(element.value || label);
            return;
          }
          field.id = element.name;
          field.options = [element.value || label];
        }
        
        fields.push(field);
      });
      
      return fields;
    });
    
    // Detect branching fields (fields that might affect other fields)
    const branchingFields = fieldSchema.filter((field: any) => 
      field.type === 'select' || field.type === 'radio'
    );
    
    const branches: any[] = [];
    
    if (branchingFields.length > 0) {
      // For each branching field, test different options
      for (const branchField of branchingFields.slice(0, 2)) { // Limit to first 2 branching fields
        if (branchField.options && branchField.options.length > 0) {
          for (const option of branchField.options.slice(0, 3)) { // Test first 3 options
            try {
              // Select the option
              await session.page.evaluate((fieldId: string, optionValue: string, fieldType: string) => {
                const field = document.getElementById(fieldId) || document.querySelector(`[name="${fieldId}"]`);
                if (!field) return;
                
                if (fieldType === 'select') {
                  const selectElement = field as HTMLSelectElement;
                  for (let i = 0; i < selectElement.options.length; i++) {
                    if (selectElement.options[i].text === optionValue || selectElement.options[i].value === optionValue) {
                      selectElement.selectedIndex = i;
                      selectElement.dispatchEvent(new Event('change', { bubbles: true }));
                      break;
                    }
                  }
                } else if (fieldType === 'radio') {
                  const radioElements = document.querySelectorAll(`input[name="${fieldId}"]`);
                  radioElements.forEach((radio: Element) => {
                    const radioElement = radio as HTMLInputElement;
                    if (radioElement.value === optionValue) {
                      radioElement.checked = true;
                      radioElement.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  });
                }
              }, branchField.id, option, branchField.type);
              
              // Wait for potential DOM changes
              await session.page.waitForTimeout(1000);
              
              // Re-scan for fields to see if new ones appeared
              const updatedFields = await session.page.evaluate(() => {
                const form = document.querySelector('form');
                if (!form) return [];
                
                const fields: any[] = [];
                const inputs = form.querySelectorAll('input, select, textarea');
                
                inputs.forEach((input: Element) => {
                  const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                  
                  // Skip hidden fields
                  if (element.type === 'hidden' || window.getComputedStyle(element).display === 'none') {
                    return;
                  }
                  
                  const label = form.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() || 
                               element.getAttribute('placeholder') || 
                               element.getAttribute('name') || 
                               'Unknown Field';
                  
                  fields.push({
                    id: element.id || element.name || `field_${fields.length}`,
                    label: label,
                    type: element.type || element.tagName.toLowerCase(),
                    required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true'
                  });
                });
                
                return fields;
              });
              
              branches.push({
                choice: `${branchField.label}: ${option}`,
                questions: updatedFields
              });
              
            } catch (optionError) {
              console.error(`Error testing option ${option}:`, optionError);
            }
          }
        }
      }
    }
    
    // If no branches were discovered, return the default form
    if (branches.length === 0) {
      branches.push({
        choice: 'default',
        questions: fieldSchema
      });
    }
    
    return {
      program_ref: programRef,
      branches: branches
    };
    
  } catch (error) {
    console.error('Error discovering program fields:', error);
    throw new Error(`Failed to discover fields for program ${programRef}: ${error.message}`);
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
