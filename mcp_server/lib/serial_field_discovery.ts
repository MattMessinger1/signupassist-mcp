/**
 * Serial Field Discovery Loop
 * Iterative autofill → submit → collect errors approach
 * 
 * This replaces static CSS selector scraping with dynamic discovery:
 * 1. Fill all visible fields with safe defaults
 * 2. Try to submit the form
 * 3. Collect validation errors
 * 4. Record newly discovered fields
 * 5. Repeat until no new errors appear or max loops reached
 */

import { Page } from 'playwright';
import { humanPause, jitter } from './humanize.js';

export interface FieldError {
  fieldKey: string;
  message: string;
  selector?: string;
  type?: string;
}

export interface DiscoveredField {
  id: string;
  label: string;
  type: string;
  required: boolean;
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

const MAX_LOOPS = 10;

/**
 * Main serial discovery function
 * Uses warm hints if provided to accelerate discovery
 */
export async function discoverFieldsSerially(
  page: Page,
  programRef: string,
  warmHints: Record<string, any> = {}
): Promise<SerialDiscoveryResult> {
  
  const discovered = new Map<string, DiscoveredField>();
  const seen = new Set<string>();
  let loopCount = 0;
  let successDetected = false;
  
  console.log('[SerialDiscovery] Starting discovery loop...');
  
  // Apply warm hints first if available
  if (warmHints && Object.keys(warmHints).length > 0) {
    console.log('[SerialDiscovery] Applying warm hints...');
    await applyWarmHints(page, warmHints);
    await humanPause(400, 800);
  }
  
  while (loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(`[SerialDiscovery] Loop ${loopCount}/${MAX_LOOPS}`);
    
    // Step 1: Fill all visible fields with safe defaults
    await naiveAutofill(page);
    await humanPause(300, 600);
    
    // Step 2: Try to submit
    const submitted = await trySubmit(page);
    if (!submitted) {
      console.log('[SerialDiscovery] No submit button found, ending loop');
      break;
    }
    
    // Step 3: Wait for validation or navigation
    await humanPause(700, 1200);
    
    // Step 4: Check if we've succeeded
    if (await detectSuccess(page)) {
      console.log('[SerialDiscovery] Success page detected, discovery complete');
      successDetected = true;
      break;
    }
    
    // Step 5: Collect validation errors
    const errors = await collectErrors(page);
    const newErrors = errors.filter(e => !seen.has(e.fieldKey));
    
    if (newErrors.length === 0) {
      console.log('[SerialDiscovery] No new errors found, discovery complete');
      break;
    }
    
    // Step 6: Record new discoveries
    for (const error of newErrors) {
      console.log(`[SerialDiscovery] Found field: ${error.fieldKey} - "${error.message}"`);
      
      const field: DiscoveredField = {
        id: error.fieldKey,
        label: humanizeFieldKey(error.fieldKey),
        type: error.type || inferFieldType(error.fieldKey, error.selector),
        required: true,
        message: error.message,
        selector: error.selector,
        category: categorizeField(error.fieldKey, error.message)
      };
      
      // Extract options if it's a select field
      if (error.selector && (field.type === 'select' || field.type === 'radio')) {
        try {
          const options = await extractFieldOptions(page, error.selector);
          if (options.length > 0) {
            field.options = options;
          }
        } catch (err) {
          console.warn(`[SerialDiscovery] Could not extract options for ${error.fieldKey}:`, err.message);
        }
      }
      
      discovered.set(error.fieldKey, field);
      seen.add(error.fieldKey);
    }
  }
  
  const fields = Array.from(discovered.values());
  const confidence = calculateConfidence(loopCount, fields.length, MAX_LOOPS, successDetected);
  
  console.log(`[SerialDiscovery] Completed: ${fields.length} fields in ${loopCount} loops (confidence: ${confidence.toFixed(2)})`);
  
  return {
    fields,
    confidence,
    loopCount,
    metadata: {
      maxLoopsReached: loopCount >= MAX_LOOPS,
      successDetected,
      errorsFound: fields.length
    }
  };
}

/**
 * Fill all visible fields with safe, non-PII defaults
 */
async function naiveAutofill(page: Page): Promise<void> {
  // Text inputs
  const textSelectors = [
    'input[type="text"]:visible',
    'input:not([type]):visible',
    'input[type="email"]:visible',
    'input[type="tel"]:visible',
    'textarea:visible'
  ];
  
  for (const selector of textSelectors) {
    try {
      const inputs = await page.$$(selector);
      for (const input of inputs) {
        try {
          const isFilled = await input.evaluate((el: any) => el.value && el.value.length > 0);
          if (isFilled) continue; // Skip already filled
          
          const name = await input.getAttribute('name') || '';
          const value = getDefaultValue(name);
          await input.fill(value);
          await page.waitForTimeout(jitter(50, 150));
        } catch (err) {
          // Skip if field not fillable
        }
      }
    } catch (err) {
      console.warn(`[SerialDiscovery] Could not fill ${selector}:`, err.message);
    }
  }
  
  // Selects - choose first real option
  try {
    const selects = await page.$$('select:visible');
    for (const select of selects) {
      try {
        const alreadySelected = await select.evaluate((el: any) => el.selectedIndex > 0);
        if (alreadySelected) continue;
        
        await select.selectOption({ index: 1 });
        await page.waitForTimeout(jitter(50, 150));
      } catch (err) {
        // Skip if can't select
      }
    }
  } catch (err) {
    console.warn('[SerialDiscovery] Could not fill selects:', err.message);
  }
  
  // Radios - check first in each group
  try {
    const radioGroups = new Set<string>();
    const radios = await page.$$('input[type="radio"]:visible');
    for (const radio of radios) {
      const name = await radio.getAttribute('name');
      if (name && !radioGroups.has(name)) {
        const isChecked = await radio.evaluate((el: any) => el.checked);
        if (!isChecked) {
          await radio.check().catch(() => {});
          await page.waitForTimeout(jitter(50, 150));
        }
        radioGroups.add(name);
      }
    }
  } catch (err) {
    console.warn('[SerialDiscovery] Could not fill radios:', err.message);
  }
  
  // Checkboxes - check only "agree" types (safe)
  try {
    const checkboxes = await page.$$('input[type="checkbox"]:visible');
    for (const cb of checkboxes) {
      const id = await cb.getAttribute('id');
      if (!id) continue;
      
      const label = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '');
      const lowerLabel = label.toLowerCase();
      
      if (/agree|accept|consent|acknowledge/i.test(lowerLabel)) {
        const isChecked = await cb.evaluate((el: any) => el.checked);
        if (!isChecked) {
          await cb.check().catch(() => {});
          await page.waitForTimeout(jitter(50, 150));
        }
      }
    }
  } catch (err) {
    console.warn('[SerialDiscovery] Could not fill checkboxes:', err.message);
  }
}

/**
 * Try to submit the form using various strategies
 */
async function trySubmit(page: Page): Promise<boolean> {
  const submitSelectors = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Next"):visible',
    'button:has-text("Continue"):visible',
    'button:has-text("Register"):visible',
    'button:has-text("Submit"):visible',
    '.form-actions button:visible'
  ];
  
  for (const selector of submitSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        const isDisabled = await btn.evaluate((el: any) => el.disabled);
        if (!isDisabled) {
          console.log(`[SerialDiscovery] Clicking submit: ${selector}`);
          await btn.click();
          return true;
        }
      }
    } catch (err) {
      // Try next selector
    }
  }
  
  console.log('[SerialDiscovery] No submit button found');
  return false;
}

/**
 * Collect validation errors from the page
 * Uses multiple strategies: HTML5 validation, custom error messages, ARIA alerts
 */
async function collectErrors(page: Page): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  
  // Strategy 1: HTML5 validation (most reliable)
  try {
    const invalids = await page.$$(':invalid');
    for (const el of invalids) {
      const name = await el.getAttribute('name') || await el.getAttribute('id') || 'unknown';
      const msg = await el.evaluate((n: any) => n.validationMessage || '') || 'Required field';
      const tag = await el.evaluate((n: any) => n.tagName.toLowerCase());
      const type = await el.getAttribute('type') || tag;
      
      const selector = await el.evaluate((n: any) => {
        if (n.id) return `#${n.id}`;
        if (n.name) return `[name="${n.name}"]`;
        return '';
      });
      
      errors.push({
        fieldKey: normalizeFieldKey(name),
        message: msg,
        selector,
        type
      });
    }
  } catch (err) {
    console.warn('[SerialDiscovery] HTML5 validation check failed:', err.message);
  }
  
  // Strategy 2: Custom error messages
  const errorSelectors = [
    '.error:visible',
    '[role="alert"]:visible',
    '.invalid-feedback:visible',
    '.field-error:visible',
    '.validation-error:visible',
    '[data-error]:visible',
    '.form-error:visible'
  ];
  
  for (const selector of errorSelectors) {
    try {
      const errorEls = await page.$$(selector);
      for (const errorEl of errorEls) {
        const text = await errorEl.textContent();
        if (!text || text.trim().length === 0) continue;
        
        // Find associated input (various strategies)
        let input = await errorEl.$('input, select, textarea');
        
        if (!input) {
          // Look for nearby input (previous sibling, parent container)
          input = await errorEl.evaluateHandle((el: any) => {
            return el.previousElementSibling || 
                   el.closest('.form-group')?.querySelector('input, select, textarea') ||
                   el.closest('.field')?.querySelector('input, select, textarea') ||
                   el.parentElement?.querySelector('input, select, textarea');
          }).then(h => h.asElement());
        }
        
        if (input) {
          const name = await input.getAttribute('name') || await input.getAttribute('id') || 'unknown';
          const tag = await input.evaluate((n: any) => n.tagName.toLowerCase());
          const type = await input.getAttribute('type') || tag;
          
          const selector = await input.evaluate((n: any) => {
            if (n.id) return `#${n.id}`;
            if (n.name) return `[name="${n.name}"]`;
            return '';
          });
          
          const key = normalizeFieldKey(name);
          if (!errors.some(e => e.fieldKey === key)) {
            errors.push({
              fieldKey: key,
              message: text.trim(),
              selector,
              type
            });
          }
        }
      }
    } catch (err) {
      // Try next selector
    }
  }
  
  console.log(`[SerialDiscovery] Collected ${errors.length} validation errors`);
  return errors;
}

/**
 * Detect if we've reached a success/confirmation page
 */
async function detectSuccess(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  const successIndicators = [
    /confirm/i,
    /success/i,
    /complete/i,
    /thank.*you/i,
    /receipt/i,
    /confirmation/i
  ];
  
  if (successIndicators.some(rx => rx.test(url))) {
    console.log('[SerialDiscovery] Success detected in URL');
    return true;
  }
  
  try {
    const text = await page.textContent('body');
    if (text && successIndicators.some(rx => rx.test(text))) {
      console.log('[SerialDiscovery] Success detected in page text');
      return true;
    }
  } catch (err) {
    // Ignore
  }
  
  return false;
}

/**
 * Apply warm hints from previous discoveries
 */
async function applyWarmHints(page: Page, hints: Record<string, any>): Promise<void> {
  for (const [fieldKey, hint] of Object.entries(hints)) {
    if (!hint.selector) continue;
    
    try {
      const input = await page.$(hint.selector);
      if (input) {
        const defaultValue = hint.defaultValue || 'test';
        await input.fill(defaultValue);
        console.log(`[SerialDiscovery] Applied warm hint: ${fieldKey}`);
      }
    } catch (err) {
      // Selector might be stale, skip
    }
  }
}

/**
 * Extract options for select/radio fields
 */
async function extractFieldOptions(page: Page, selector: string): Promise<Array<{ value: string; label: string }>> {
  const options: Array<{ value: string; label: string }> = [];
  
  try {
    const el = await page.$(selector);
    if (!el) return options;
    
    const tag = await el.evaluate((n: any) => n.tagName.toLowerCase());
    
    if (tag === 'select') {
      // Extract select options
      const selectOptions = await el.$$eval('option', (opts: any[]) =>
        opts.map(o => ({
          value: o.value || o.textContent?.trim() || '',
          label: o.textContent?.trim() || ''
        }))
      );
      
      return selectOptions.filter(o => 
        o.label && 
        o.label !== 'Select...' && 
        o.label !== '- Select -' &&
        o.label !== 'Choose one'
      );
    }
    
    if (tag === 'input') {
      // For radio, find all radios with same name
      const name = await el.getAttribute('name');
      if (name) {
        const radios = await page.$$(`input[type="radio"][name="${name}"]`);
        for (const radio of radios) {
          const value = await radio.getAttribute('value') || '';
          const id = await radio.getAttribute('id') || '';
          
          let label = '';
          if (id) {
            label = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '') || '';
          }
          
          if (value && label) {
            options.push({ value, label: label.trim() });
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[SerialDiscovery] Could not extract options for ${selector}:`, err.message);
  }
  
  return options;
}

/**
 * Helper: Normalize field key to snake_case
 */
function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^\w]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Helper: Humanize field key to Title Case
 */
function humanizeFieldKey(key: string): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Helper: Get safe default value based on field name
 */
function getDefaultValue(fieldName: string): string {
  const name = fieldName.toLowerCase();
  if (/email/i.test(name)) return 'test@example.com';
  if (/phone|tel/i.test(name)) return '555-555-5555';
  if (/zip|postal/i.test(name)) return '12345';
  if (/first.*name/i.test(name)) return 'Test';
  if (/last.*name/i.test(name)) return 'User';
  if (/city/i.test(name)) return 'Springfield';
  if (/state/i.test(name)) return 'IL';
  if (/address/i.test(name)) return '123 Main St';
  return 'test';
}

/**
 * Helper: Infer field type from name/selector
 */
function inferFieldType(fieldKey: string, selector?: string): string {
  if (!selector) return 'text';
  if (selector.includes('select')) return 'select';
  if (selector.includes('[type="email"]')) return 'email';
  if (selector.includes('[type="tel"]')) return 'tel';
  if (selector.includes('[type="checkbox"]')) return 'checkbox';
  if (selector.includes('[type="radio"]')) return 'radio';
  if (selector.includes('[type="date"]')) return 'date';
  if (selector.includes('textarea')) return 'textarea';
  return 'text';
}

/**
 * Helper: Categorize field based on name and message
 */
function categorizeField(fieldKey: string, message: string): string {
  const combined = `${fieldKey} ${message}`.toLowerCase();
  
  if (/volunteer/i.test(combined)) return 'volunteering';
  if (/emergency|contact.*case/i.test(combined)) return 'emergency';
  if (/waiver|consent|liability|agree|acknowledge/i.test(combined)) return 'waiver';
  if (/medical|allerg|condition|medication|health/i.test(combined)) return 'medical';
  if (/payment|card|billing/i.test(combined)) return 'payment';
  
  return 'general';
}

/**
 * Helper: Calculate confidence score
 */
function calculateConfidence(
  loops: number,
  fieldsFound: number,
  maxLoops: number,
  successDetected: boolean
): number {
  if (fieldsFound === 0) return 0;
  
  // Perfect confidence if we detected success
  if (successDetected) return 0.95;
  
  // Partial confidence if we hit max loops
  if (loops >= maxLoops) return 0.5;
  
  // Higher confidence with more fields found and fewer loops needed
  const loopEfficiency = 1 - (loops / maxLoops);
  const fieldCoverage = Math.min(1, fieldsFound / 10);
  
  return Math.min(0.95, 0.6 + (0.2 * loopEfficiency) + (0.15 * fieldCoverage));
}
