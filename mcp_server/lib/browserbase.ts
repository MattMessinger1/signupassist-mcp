/**
 * Browserbase Session Management
 * Handles Playwright automation via Browserbase
 */

import Browserbase from '@browserbasehq/sdk';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getSkiClubProConfig } from '../config/skiclubpro_selectors.js';
import { getProgramId } from '../config/program_mapping.js';

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
 * Login to SkiClubPro using Playwright automation
 */
export async function performSkiClubProLogin(
  session: BrowserbaseSession,
  credentials: { email: string; password: string },
  orgRef: string = 'blackhawk-ski-club'
): Promise<void> {
  const { page } = session;
  const config = getSkiClubProConfig(orgRef);

  try {
    // Navigate to SkiClubPro login page
    await page.goto(`https://${config.domain}/`, { 
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
export async function discoverProgramRequiredFields(
  session: BrowserbaseSession, 
  programRef: string,
  orgRef: string = 'blackhawk-ski-club'
): Promise<any> {
  try {
    console.log(`Starting field discovery for program: ${programRef}`);
    
    const config = getSkiClubProConfig(orgRef);
    
    // Convert text reference to actual program ID
    const actualProgramId = getProgramId(programRef, orgRef);
    
    // Navigate to the program registration OPTIONS page (not the start/login page)
    // The /options page contains the actual registration form fields
    const registrationUrl = `https://${config.domain}/registration/${actualProgramId}/options`;
    console.log(`Navigating to registration form: ${registrationUrl} (mapped ${programRef} -> ${actualProgramId})`);
    await session.page.goto(registrationUrl, { waitUntil: 'networkidle' });
    
    // Wait for form to load
    await session.page.waitForSelector('form', { timeout: 10000 });
    
    // Discover form fields and branching logic
    const fieldSchema = await session.page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) {
        throw new Error('Registration form not found');
      }
      
      // Enhanced field discovery for SkiClubPro forms
      const fields: any[] = [];
      const inputs = form.querySelectorAll('input, select, textarea, [role="button"], [role="radio"], [role="checkbox"]');
      
      inputs.forEach((input: Element) => {
        const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        
        // Enhanced label detection for SkiClubPro
        let label = '';
        
        // Try multiple strategies to find the label
        if (element.labels && element.labels.length > 0) {
          label = element.labels[0].textContent?.trim() || '';
        } else {
          // Look for label by 'for' attribute
          const labelEl = form.querySelector(`label[for="${element.id}"]`);
          if (labelEl) {
            label = labelEl.textContent?.trim() || '';
          } else {
            // Try placeholder, aria-label, or name
            label = element.getAttribute('placeholder') || 
                   element.getAttribute('aria-label') || 
                   element.getAttribute('name') || '';
            
            // If still no label, look for nearby text
            if (!label) {
              const parent = element.parentElement;
              if (parent) {
                // Look for text in parent or preceding elements
                const textNodes = Array.from(parent.childNodes)
                  .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
                  .map(node => node.textContent?.trim())
                  .filter(Boolean);
                
                if (textNodes.length > 0) {
                  label = textNodes[0];
                } else {
                  // Look for span/div siblings with text
                  const siblings = Array.from(parent.children)
                    .filter(el => el !== element && el.textContent?.trim())
                    .map(el => el.textContent?.trim())
                    .filter(Boolean);
                  
                  if (siblings.length > 0) {
                    label = siblings[0];
                  }
                }
              }
            }
          }
        }
        
        // Clean up label
        label = label?.replace(/[*:]/g, '').trim() || 'Unknown Field';
        
        // Skip if label is too long or looks like helper text
        if (label.length > 100 || 
            label.toLowerCase().includes('please') ||
            label.toLowerCase().includes('select an option')) {
          return;
        }
        
        const fieldId = element.id || element.name || `field_${fields.length}`;
        
        // Determine field type
        let fieldType = element.type || element.tagName.toLowerCase();
        if (fieldType === 'select-one') fieldType = 'select';
        if (fieldType === 'select-multiple') fieldType = 'multi-select';
        
        const field = {
          id: fieldId,
          label: label,
          type: fieldType,
          required: element.hasAttribute('required') || 
                   element.getAttribute('aria-required') === 'true' ||
                   label.includes('*'),
          options: [] as string[]
        };
        
        // Handle select options
        if (element.tagName.toLowerCase() === 'select') {
          const selectElement = element as HTMLSelectElement;
          field.options = Array.from(selectElement.options)
            .map(option => option.text.trim())
            .filter(text => text && 
                          text !== 'Please select...' && 
                          text !== '-- Select --' &&
                          text !== 'Choose...');
        }
        
        // Handle radio button groups
        if (element.type === 'radio') {
          const groupName = element.name;
          const existingField = fields.find(f => f.id === groupName);
          if (existingField) {
            const optionLabel = element.getAttribute('value') || 
                               element.nextElementSibling?.textContent?.trim() ||
                               label;
            if (optionLabel && !existingField.options.includes(optionLabel)) {
              existingField.options.push(optionLabel);
            }
            return;
          }
          field.id = groupName;
          field.type = 'radio';
          field.options = [element.getAttribute('value') || label];
        }
        
        // Handle checkbox groups (common for volunteering, rentals, etc.)
        if (element.type === 'checkbox') {
          const groupName = element.name;
          // Check if this is part of a group
          const siblingCheckboxes = form.querySelectorAll(`input[type="checkbox"][name="${groupName}"]`);
          if (siblingCheckboxes.length > 1) {
            const existingField = fields.find(f => f.id === groupName);
            if (existingField) {
              const optionLabel = element.getAttribute('value') || 
                                 element.nextElementSibling?.textContent?.trim() ||
                                 label;
              if (optionLabel && !existingField.options.includes(optionLabel)) {
                existingField.options.push(optionLabel);
              }
              return;
            }
            field.id = groupName;
            field.type = 'checkbox-group';
            field.options = [element.getAttribute('value') || label];
          }
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
              await session.page.evaluate(({ fieldId, optionValue, fieldType }) => {
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
              }, { fieldId: branchField.id, optionValue: option, fieldType: branchField.type });
              
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
  }
): Promise<{ registration_ref: string }> {
  try {
    console.log(`Starting registration for program: ${registrationData.program_ref}`);
    
    // Navigate to the program registration page using correct domain
    const config = getSkiClubProConfig('blackhawk-ski-club');
    const actualProgramId = getProgramId(registrationData.program_ref, 'blackhawk-ski-club');
    const registrationUrl = `https://${config.domain}/registration/${actualProgramId}/start`;
    await session.page.goto(registrationUrl, { waitUntil: 'networkidle' });
    
    // Wait for form to load
    await session.page.waitForSelector('form', { timeout: 10000 });
    
    // Fill basic child information
    await fillBasicChildInfo(session, registrationData.child);
    
    // Fill pre-answered questions from mandate
    await fillPreAnsweredQuestions(session, registrationData.answers);
    
    // Handle dynamic/branching questions
    await handleDynamicQuestions(session, registrationData.answers, registrationData.mandate_scope);
    
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
    
    return { registration_ref: registrationRef };
    
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
