/**
 * Phase 1: Shared Scraping Helpers (Extracted from MCP Server)
 * Pure Playwright-based scraping functions with no MCP dependencies
 * These functions can be used by edge functions for scheduled cache refreshes
 */

// Type alias for Playwright Page (Playwright is imported dynamically in edge functions)
type Page = any;

// ============================================================================
// TYPE DEFINITIONS (copied from mcp_server types)
// ============================================================================

export interface DiscoveredField {
  id: string;
  label?: string;
  type: string;
  required?: boolean;
  message?: string;
  selector?: string;
  category?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface SerialDiscoveryResult {
  fields: DiscoveredField[];
  confidence: number;
  loopCount: number;
  metadata: {
    maxLoopsReached: boolean;
    successDetected: boolean;
    errorsFound: number;
  };
}

export interface PrerequisiteCheckResult {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown';
  message: string;
  fields: DiscoveredField[];
}

export interface ProgramData {
  program_ref: string;
  title: string;
  description?: string;
  price?: string;
  schedule?: string;
  age_range?: string;
  skill_level?: string;
  status?: string;
  category?: string;
  url?: string;
}

// ============================================================================
// PROGRAM LIST SCRAPING (extracted from threePassExtractor.programs.ts)
// ============================================================================

/**
 * Scrape program list from a page using Playwright
 * Returns raw program data without MCP dependencies
 */
export async function scrapeProgramList(
  page: Page,
  orgRef: string,
  selectors: {
    container: string[];
    title: string[];
    price?: string[];
    schedule?: string[];
  }
): Promise<ProgramData[]> {
  console.log('[Scraping] Extracting program list...');
  
  const programs: ProgramData[] = [];
  
  // Try each container selector until we find programs
  for (const containerSelector of selectors.container) {
    try {
      const programElements = await page.locator(containerSelector).all();
      
      if (programElements.length === 0) continue;
      
      console.log(`[Scraping] Found ${programElements.length} programs with selector: ${containerSelector}`);
      
      for (const element of programElements) {
        try {
          // Extract title
          let title = '';
          for (const titleSelector of selectors.title) {
            const titleText = await element.locator(titleSelector).first().textContent();
            if (titleText?.trim()) {
              title = titleText.trim();
              break;
            }
          }
          
          if (!title) continue;
          
          // Extract price
          let price = '';
          if (selectors.price) {
            for (const priceSelector of selectors.price) {
              const priceText = await element.locator(priceSelector).first().textContent();
              if (priceText?.trim()) {
                price = priceText.trim();
                break;
              }
            }
          }
          
          // Extract schedule
          let schedule = '';
          if (selectors.schedule) {
            for (const scheduleSelector of selectors.schedule) {
              const scheduleText = await element.locator(scheduleSelector).first().textContent();
              if (scheduleText?.trim()) {
                schedule = scheduleText.trim();
                break;
              }
            }
          }
          
          // Generate program_ref from title
          const program_ref = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          
          programs.push({
            program_ref,
            title,
            price: price || 'TBD',
            schedule: schedule || 'TBD',
            status: 'open',
          });
          
        } catch (error) {
          console.warn('[Scraping] Failed to extract program:', error);
        }
      }
      
      if (programs.length > 0) break; // Found programs with this selector
      
    } catch (error) {
      console.warn(`[Scraping] Container selector failed: ${containerSelector}`, error);
    }
  }
  
  console.log(`[Scraping] Extracted ${programs.length} programs`);
  return programs;
}

// ============================================================================
// FIELD DISCOVERY (extracted from serial_field_discovery.ts)
// ============================================================================

const MAX_LOOPS = 10; // Conservative for production scraping

/**
 * Discover form fields using serial autofill → submit → collect errors loop
 */
export async function discoverFieldsSerially(
  page: Page,
  programRef: string
): Promise<SerialDiscoveryResult> {
  const discovered = new Map<string, DiscoveredField>();
  const seen = new Set<string>();
  let loopCount = 0;
  let successDetected = false;
  
  console.log('[SerialDiscovery] Starting field discovery...');
  
  while (loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(`[SerialDiscovery] Loop ${loopCount}/${MAX_LOOPS}`);
    
    // Step 1: Fill visible fields
    await naiveAutofill(page);
    await humanPause(600, 1200);
    
    // Step 2: Try to submit
    const submitted = await trySubmit(page);
    if (!submitted) {
      console.log('[SerialDiscovery] No submit button found');
      break;
    }
    
    // Step 3: Wait for validation
    await humanPause(1400, 2400);
    
    // Step 4: Check success
    if (await detectSuccess(page)) {
      console.log('[SerialDiscovery] Success detected');
      successDetected = true;
      break;
    }
    
    // Step 5: Collect errors
    const errors = await collectErrors(page);
    const newErrors = errors.filter(e => !seen.has(e.fieldKey));
    
    if (newErrors.length === 0) {
      console.log('[SerialDiscovery] No new errors found');
      break;
    }
    
    // Step 6: Record discoveries
    for (const error of newErrors) {
      const field: DiscoveredField = {
        id: error.fieldKey,
        label: humanizeFieldKey(error.fieldKey),
        type: inferFieldType(error.fieldKey, error.selector),
        required: true,
        message: error.message,
        selector: error.selector,
      };
      
      discovered.set(error.fieldKey, field);
      seen.add(error.fieldKey);
    }
  }
  
  const fields = Array.from(discovered.values());
  const confidence = successDetected ? 1.0 : Math.min(0.95, fields.length > 0 ? 0.7 : 0.3);
  
  return {
    fields,
    confidence,
    loopCount,
    metadata: {
      maxLoopsReached: loopCount >= MAX_LOOPS,
      successDetected,
      errorsFound: fields.length,
    },
  };
}

// ============================================================================
// NAVIGATION HELPERS (extracted from unified_discovery.ts)
// ============================================================================

/**
 * Navigate to a program registration form
 */
export async function navigateToProgramForm(
  page: Page,
  programRef: string,
  baseDomain: string,
  programUrl?: string
): Promise<void> {
  console.log('[Navigation] Navigating to program form...');
  
  // If direct URL provided, use it
  if (programUrl) {
    console.log(`[Navigation] Using direct URL: ${programUrl}`);
    await page.goto(programUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return;
  }
  
  // Otherwise navigate to registration page and find program
  const registrationUrl = `https://${baseDomain}/registration`;
  console.log(`[Navigation] Navigating to: ${registrationUrl}`);
  await page.goto(registrationUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Try to find and click the program link
  const programLink = page.locator(`a:has-text("${programRef}")`).first();
  const linkCount = await programLink.count();
  
  if (linkCount > 0) {
    console.log(`[Navigation] Found program link, clicking...`);
    await programLink.click();
    await humanPause(1000, 2000);
  } else {
    console.warn(`[Navigation] Could not find program link for: ${programRef}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS (extracted from various files)
// ============================================================================

function humanPause(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function naiveAutofill(page: Page): Promise<void> {
  try {
    // Fill text inputs
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]');
      inputs.forEach((input: any) => {
        if (!input.value) {
          if (input.type === 'email') input.value = 'test@example.com';
          else if (input.type === 'tel') input.value = '555-0100';
          else input.value = 'Test';
        }
      });
    });
  } catch (error) {
    console.warn('[Autofill] Failed:', error);
  }
}

async function trySubmit(page: Page): Promise<boolean> {
  try {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
    ];
    
    for (const selector of submitSelectors) {
      const button = page.locator(selector).first();
      if (await button.count() > 0) {
        await button.click();
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.warn('[Submit] Failed:', error);
    return false;
  }
}

async function detectSuccess(page: Page): Promise<boolean> {
  try {
    const successIndicators = [
      'text=/success/i',
      'text=/complete/i',
      'text=/thank you/i',
      'text=/confirmed/i',
    ];
    
    for (const indicator of successIndicators) {
      if (await page.locator(indicator).count() > 0) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

interface FieldError {
  fieldKey: string;
  message: string;
  selector?: string;
  type?: string;
}

async function collectErrors(page: Page): Promise<FieldError[]> {
  try {
    return await page.evaluate(() => {
      const errors: FieldError[] = [];
      const errorSelectors = [
        '.error',
        '.field-error',
        '.validation-error',
        '[role="alert"]',
        '.invalid-feedback',
      ];
      
      for (const selector of errorSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el: any) => {
          const text = el.textContent?.trim();
          if (text) {
            // Try to find associated field
            const field = el.closest('.field')?.querySelector('input, select, textarea') ||
                         el.previousElementSibling?.querySelector('input, select, textarea');
            
            errors.push({
              fieldKey: field?.name || field?.id || 'unknown',
              message: text,
              selector: field?.name ? `[name="${field.name}"]` : undefined,
              type: field?.type,
            });
          }
        });
      }
      
      return errors;
    });
  } catch (error) {
    console.warn('[CollectErrors] Failed:', error);
    return [];
  }
}

function humanizeFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
}

function inferFieldType(key: string, selector?: string): string {
  const keyLower = key.toLowerCase();
  
  if (keyLower.includes('email')) return 'email';
  if (keyLower.includes('phone')) return 'tel';
  if (keyLower.includes('date')) return 'date';
  if (keyLower.includes('age')) return 'number';
  if (selector?.includes('select')) return 'select';
  if (selector?.includes('textarea')) return 'textarea';
  
  return 'text';
}

// ============================================================================
// SIGNUP FORM EXTRACTION
// ============================================================================

/**
 * Extract signup form structure from a program page
 * Parses visible form fields, options, and requirements
 */
export async function extractProgramSignupForm(
  page: Page,
  programUrl: string
): Promise<{
  fields: DiscoveredField[];
  fingerprint: string;
  metadata: { url: string; timestamp: string };
}> {
  console.log(`[Scraping] Extracting signup form from: ${programUrl}`);
  
  // Navigate to the program signup page
  await page.goto(programUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Allow dynamic content to load
  
  // Extract all visible form fields
  const fields = await page.$$eval(
    'input, select, textarea',
    (elements) => {
      return (elements as HTMLElement[])
        .filter((el: any) => {
          const cs = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        })
        .filter((el: any) => !['hidden', 'submit', 'button', 'image', 'file'].includes(el.type))
        .map((el: any) => {
          const id = el.name || el.id || `field_${Math.random().toString(36).slice(2)}`;
          const isSelect = el.tagName === 'SELECT';
          const isTextArea = el.tagName === 'TEXTAREA';
          const type = isSelect ? 'select' : isTextArea ? 'textarea' : (el.type || 'text');
          
          // Try to find label
          const explicit = document.querySelector(`label[for='${el.id}']`);
          const implicit = el.closest('label');
          const label = (explicit?.textContent || implicit?.textContent || el.ariaLabel || el.placeholder || '').trim();
          
          // Extract options for select fields
          const options = isSelect
            ? Array.from((el as HTMLSelectElement).options).map(o => ({
                value: o.value,
                label: o.textContent || o.value
              }))
            : undefined;
          
          const selector = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : undefined;
          
          return {
            id,
            label: label || id,
            type,
            required: !!el.required,
            options,
            selector,
            category: type === 'select' ? 'dropdown' : type === 'textarea' ? 'longtext' : 'input'
          };
        });
    }
  );
  
  console.log(`[Scraping] Extracted ${fields.length} form fields`);
  
  // Generate fingerprint from field structure
  const fieldSignature = fields
    .map(f => `${f.id}:${f.type}:${f.required ? 'req' : 'opt'}`)
    .sort()
    .join('|');
  
  const crypto = await import('crypto');
  const fingerprint = crypto.createHash('sha256').update(fieldSignature).digest('hex').slice(0, 16);
  
  return {
    fields,
    fingerprint,
    metadata: {
      url: programUrl,
      timestamp: new Date().toISOString()
    }
  };
}

console.log('[Scraping] Shared scraping helpers loaded');
