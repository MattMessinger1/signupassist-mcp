import { Page, Locator } from 'playwright';

export interface FormFieldMapping {
  [logicalField: string]: string | string[];
}

export interface FormFillOptions {
  typeDelay?: number;
  interFieldPauseMin?: number;
  interFieldPauseMax?: number;
  finalPause?: number;
  antibotTokenWait?: number;
  scrollDelay?: number;
  enableMouseMovement?: boolean;
  detectCaptcha?: boolean;
  maxAmountCents?: number; // Payment limit in cents
}

export interface FormFillResult {
  success: boolean;
  captchaDetected?: boolean;
  antibotFieldsFound?: string[];
  fieldsFilledCount?: number;
  fieldsMissedCount?: number;
  error?: string;
  totalPriceCents?: number; // Total price detected after filling
  priceExceeded?: boolean; // True if price exceeded max
}

// Common antibot field patterns
const ANTIBOT_SELECTORS = [
  'input[name="antibot_key"]',
  'input[name^="antibot"]',
  'input[id^="antibot"]',
  '.antibot input',
  'input[class*="antibot"]'
];

// CAPTCHA detection patterns
const CAPTCHA_SELECTORS = [
  '.g-recaptcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.h-captcha',
  '[data-sitekey]'
];

/**
 * Random delay helper
 */
function randomDelay(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/**
 * Detect CAPTCHA presence on page
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  console.log("DEBUG Checking for CAPTCHA...");
  for (const selector of CAPTCHA_SELECTORS) {
    const captcha = await page.$(selector);
    if (captcha) {
      console.log(`DEBUG ⚠️  CAPTCHA detected: ${selector}`);
      return true;
    }
  }
  return false;
}

/**
 * Detect and log antibot fields
 */
async function detectAntibotFields(page: Page): Promise<string[]> {
  console.log("DEBUG Checking for Antibot fields...");
  const foundFields: string[] = [];
  
  for (const selector of ANTIBOT_SELECTORS) {
    const fields = await page.$$(selector);
    if (fields.length > 0) {
      console.log(`DEBUG Found ${fields.length} Antibot field(s): ${selector}`);
      foundFields.push(selector);
      
      for (const field of fields) {
        const name = await field.getAttribute('name');
        const id = await field.getAttribute('id');
        const value = await field.getAttribute('value');
        const type = await field.getAttribute('type');
        console.log(`  - Antibot field: name="${name}", id="${id}", type="${type}", value="${value}"`);
      }
    }
  }
  
  return foundFields;
}

/**
 * Find first available selector from array or string
 */
async function findField(page: Page, selectors: string | string[], timeout = 5000): Promise<Locator | null> {
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  
  for (const sel of selectorArray) {
    try {
      await page.waitForSelector(sel, { timeout });
      console.log(`DEBUG Found field selector: ${sel}`);
      return page.locator(sel).first();
    } catch (e) {
      // Try next selector
    }
  }
  return null;
}

/**
 * Simulate realistic mouse movement to a target position
 */
async function moveMouseToTarget(page: Page, targetX: number, targetY: number): Promise<void> {
  const currentPos = { x: randomDelay(0, 100), y: randomDelay(0, 100) };
  const steps = randomDelay(10, 20);
  
  await page.mouse.move(currentPos.x, currentPos.y);
  await page.mouse.move(targetX + randomDelay(-10, 10), targetY + randomDelay(-10, 10), { steps });
}

/**
 * Detects if a select option contains pricing information
 * Returns { isPriceBearing: boolean, priceCents: number | null }
 */
function detectOptionPrice(optionText: string): { isPriceBearing: boolean; priceCents: number | null } {
  // Match patterns like: "$75", "75.00", "$0", "No charge", "Free"
  const pricePattern = /\$?\s*(\d+(?:\.\d{2})?)\s*(?:USD|CAD)?/i;
  const freePattern = /\b(free|no\s+charge|no\s+cost|\$0(?:\.00)?)\b/i;
  
  if (freePattern.test(optionText)) {
    return { isPriceBearing: true, priceCents: 0 };
  }
  
  const priceMatch = optionText.match(pricePattern);
  if (priceMatch) {
    const dollars = parseFloat(priceMatch[1]);
    return { isPriceBearing: true, priceCents: Math.round(dollars * 100) };
  }
  
  // Check for price-bearing keywords even without explicit price
  const priceBearingKeywords = /\b(rental|t-shirt|jersey|equipment|gear|add-on|upgrade|fee)\b/i;
  if (priceBearingKeywords.test(optionText)) {
    return { isPriceBearing: true, priceCents: null };
  }
  
  return { isPriceBearing: false, priceCents: null };
}

/**
 * Handle select field with price-aware logic
 * - For price-bearing fields: chooses $0/free option
 * - For non-price fields: chooses first non-placeholder option
 */
async function fillSelectField(
  page: Page,
  field: Locator,
  logical: string,
  value: any,
  maxAmountCents: number | undefined,
  currentTotalCents: number
): Promise<{ success: boolean; addedPriceCents: number; errorMessage?: string }> {
  try {
    const options = await field.locator('option').all();
    const optionTexts = await Promise.all(options.map(opt => opt.textContent()));
    
    console.log(`DEBUG: Select field "${logical}" has ${options.length} options:`, optionTexts);
    
    // Analyze all options for pricing
    const optionPrices = optionTexts.map((text, idx) => ({
      index: idx,
      text: text || '',
      ...detectOptionPrice(text || '')
    }));
    
    const hasPricingOptions = optionPrices.some(o => o.isPriceBearing);
    
    let selectedIndex: number | undefined;
    let addedPriceCents = 0;
    
    if (hasPricingOptions) {
      // Price-bearing field: choose $0/free option
      console.log(`DEBUG: "${logical}" is price-bearing, selecting $0 option`);
      const freeOptions = optionPrices.filter(o => o.priceCents === 0 && o.index > 0);
      
      if (freeOptions.length > 0) {
        selectedIndex = freeOptions[0].index;
        console.log(`DEBUG: Selected free option at index ${selectedIndex}: "${freeOptions[0].text}"`);
      } else {
        // No free option, look for lowest price
        const pricedOptions = optionPrices
          .filter(o => o.priceCents !== null && o.index > 0)
          .sort((a, b) => (a.priceCents || 0) - (b.priceCents || 0));
        
        if (pricedOptions.length > 0) {
          selectedIndex = pricedOptions[0].index;
          addedPriceCents = pricedOptions[0].priceCents || 0;
          console.log(`DEBUG: No free option, selected lowest price at index ${selectedIndex}: "${pricedOptions[0].text}" ($${addedPriceCents / 100})`);
          
          // Check payment limit
          if (maxAmountCents && (currentTotalCents + addedPriceCents) > maxAmountCents) {
            return {
              success: false,
              addedPriceCents: 0,
              errorMessage: `PRICE_EXCEEDS_LIMIT: Adding $${addedPriceCents / 100} would exceed limit of $${maxAmountCents / 100} (current: $${currentTotalCents / 100})`
            };
          }
        }
      }
    } else {
      // Non-price field: choose first non-placeholder option or match value
      const nonPlaceholder = optionPrices.filter((opt, idx) => 
        idx > 0 && // Skip first option (usually placeholder)
        opt.text.trim() &&
        !/(select|choose|pick|—|\.\.\.)/i.test(opt.text)
      );
      
      if (nonPlaceholder.length > 0) {
        // Try to match value if provided
        if (value) {
          const matchedOption = nonPlaceholder.find(opt => 
            opt.text.toLowerCase().includes(String(value).toLowerCase())
          );
          selectedIndex = matchedOption ? matchedOption.index : nonPlaceholder[0].index;
        } else {
          selectedIndex = nonPlaceholder[0].index;
        }
        console.log(`DEBUG: Non-price field, selected option at index ${selectedIndex}: "${optionTexts[selectedIndex]}"`);
      }
    }
    
    if (selectedIndex !== undefined) {
      await field.selectOption({ index: selectedIndex });
      return { success: true, addedPriceCents };
    } else {
      return { 
        success: false, 
        addedPriceCents: 0,
        errorMessage: `Could not determine option for "${logical}"`
      };
    }
  } catch (error) {
    return {
      success: false,
      addedPriceCents: 0,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Fill a form with human-like behavior to bypass Antibot protection
 * 
 * @param page - Playwright page instance
 * @param mapping - Map of logical field names to CSS selector(s)
 * @param values - Map of logical field names to values to fill
 * @param options - Optional configuration for timing and behavior
 * @returns Result object with success status and diagnostics
 */
export async function fillFormHumanLike(
  page: Page,
  mapping: FormFieldMapping,
  values: Record<string, any>,
  options: FormFillOptions = {}
): Promise<FormFillResult> {
  // Default options
  const opts: Required<FormFillOptions> = {
    typeDelay: options.typeDelay ?? randomDelay(50, 80),
    interFieldPauseMin: options.interFieldPauseMin ?? 200,
    interFieldPauseMax: options.interFieldPauseMax ?? 800,
    finalPause: options.finalPause ?? randomDelay(2000, 3500),
    antibotTokenWait: options.antibotTokenWait ?? 1500,
    scrollDelay: options.scrollDelay ?? randomDelay(100, 300),
    enableMouseMovement: options.enableMouseMovement ?? true,
    detectCaptcha: options.detectCaptcha ?? true
  };

  console.log("DEBUG Starting human-like form fill with Antibot bypass...");

  try {
    // Check for CAPTCHA first
    if (opts.detectCaptcha) {
      const hasCaptcha = await detectCaptcha(page);
      if (hasCaptcha) {
        return {
          success: false,
          captchaDetected: true,
          error: "CAPTCHA detected - manual solving required"
        };
      }
    }

    // Detect antibot fields
    const antibotFields = await detectAntibotFields(page);

    let fieldsFilledCount = 0;
    let fieldsMissedCount = 0;
    let totalPriceCents = 0;

    // Iterate through logical fields in mapping order
    const entries = Object.entries(mapping);
    console.log(`DEBUG Processing ${entries.length} field mappings...`);

    for (let i = 0; i < entries.length; i++) {
      const [logical, selectors] = entries[i];
      const value = values[logical];
      
      if (value === undefined || value === null || value === '') {
        console.log(`DEBUG Skipping field "${logical}" (no value provided)`);
        continue;
      }

      console.log(`DEBUG [${i + 1}/${entries.length}] Filling field: ${logical}`);

      // Find the field
      const field = await findField(page, selectors, 5000);
      
      if (!field) {
        console.log(`DEBUG ⚠️  Could not find selector for "${logical}". Tried: ${JSON.stringify(selectors)}`);
        fieldsMissedCount++;
        continue;
      }

      try {
        // Check if this is a select/dropdown field
        const tagName = await field.evaluate(el => el.tagName.toLowerCase());
        
        if (tagName === 'select') {
          // Handle select with price-aware logic
          const selectResult = await fillSelectField(
            page,
            field,
            logical,
            value,
            options.maxAmountCents,
            totalPriceCents
          );
          
          if (!selectResult.success) {
            if (selectResult.errorMessage?.startsWith('PRICE_EXCEEDS_LIMIT')) {
              console.log(`ERROR: ${selectResult.errorMessage}`);
              return {
                success: false,
                priceExceeded: true,
                totalPriceCents: totalPriceCents + selectResult.addedPriceCents,
                error: selectResult.errorMessage,
                fieldsFilledCount,
                fieldsMissedCount: fieldsMissedCount + 1
              };
            }
            console.log(`DEBUG ⚠️  ${selectResult.errorMessage}`);
            fieldsMissedCount++;
          } else {
            totalPriceCents += selectResult.addedPriceCents;
            fieldsFilledCount++;
          }
        } else {
          // Handle text/input fields normally
          // Scroll field into view with realistic timing
          await field.scrollIntoViewIfNeeded();
          await page.waitForTimeout(opts.scrollDelay);

          // Get field bounding box for mouse movement
          if (opts.enableMouseMovement) {
            const box = await field.boundingBox();
            if (box) {
              await moveMouseToTarget(page, box.x + box.width / 2, box.y + box.height / 2);
              await page.waitForTimeout(randomDelay(50, 150));
            }
          }

          // Click to focus
          await field.click();
          await page.waitForTimeout(randomDelay(100, 250));

          // Clear existing value
          await field.fill('');
          await page.waitForTimeout(randomDelay(50, 150));

          // Type value with per-character delay
          const stringValue = String(value);
          for (const char of stringValue) {
            await field.type(char, { delay: opts.typeDelay });
          }

          console.log(`DEBUG ✓ Filled "${logical}" with ${stringValue.length} characters`);
          fieldsFilledCount++;

          // Blur the field (trigger validation)
          await field.blur();
        }

        // Random pause between fields (mimic human form-filling rhythm)
        const interFieldDelay = randomDelay(opts.interFieldPauseMin, opts.interFieldPauseMax);
        console.log(`DEBUG Pausing ${interFieldDelay}ms before next field...`);
        await page.waitForTimeout(interFieldDelay);

      } catch (error) {
        console.log(`DEBUG ⚠️  Error filling field "${logical}":`, error);
        fieldsMissedCount++;
      }
    }

    console.log(`DEBUG Form fill summary: ${fieldsFilledCount} filled, ${fieldsMissedCount} missed`);

    // Wait for antibot tokens to populate (if detected)
    if (antibotFields.length > 0) {
      console.log(`DEBUG Waiting ${opts.antibotTokenWait}ms for Antibot token generation...`);
      await page.waitForTimeout(opts.antibotTokenWait);

      // Re-check antibot field values
      for (const selector of antibotFields) {
        const field = await page.$(selector);
        if (field) {
          const value = await field.getAttribute('value');
          console.log(`DEBUG Antibot field ${selector} now has value: ${value ? '(populated)' : '(empty)'}`);
        }
      }
    }

    // Final human-like pause before submission
    console.log(`DEBUG Final pause ${opts.finalPause}ms before form submission...`);
    await page.waitForTimeout(opts.finalPause);

    // Simulate final mouse movement (user reviewing form)
    if (opts.enableMouseMovement) {
      await moveMouseToTarget(page, randomDelay(200, 400), randomDelay(200, 400));
    }

    console.log("DEBUG Form fill complete - ready for submission");
    console.log(`DEBUG Total price detected: $${totalPriceCents / 100}`);

    return {
      success: true,
      antibotFieldsFound: antibotFields.length > 0 ? antibotFields : undefined,
      fieldsFilledCount,
      fieldsMissedCount,
      totalPriceCents,
      priceExceeded: false
    };

  } catch (error) {
    console.error("DEBUG Form fill failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Submit a form with Antibot awareness and human-like timing
 * Waits for Antibot key to be populated before submitting
 * 
 * @param page - Playwright page instance
 * @param submitSelectors - CSS selector(s) for the submit button
 * @returns Result object with success status and optional error message
 */
export async function submitFormHumanLike(
  page: Page,
  submitSelectors: string | string[] = ['button[type="submit"]', 'input[type="submit"]', '#edit-submit']
): Promise<{ success: boolean; errorMessage?: string }> {
  console.log("DEBUG Preparing to submit form with Antibot bypass...");

  // Step 1: Wait for Drupal Antibot key to be populated
  console.log("DEBUG Waiting for Antibot key to be populated...");
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[name="antibot_key"]') as HTMLInputElement;
        return el && el.getAttribute('value') && el.getAttribute('value').length > 0;
      },
      { timeout: 15000 }
    );
    console.log("DEBUG Antibot key populated before form submit");
  } catch (e) {
    console.log("DEBUG No Antibot key found or timeout (site may not use Antibot) – continuing with submit...");
  }

  // Step 2: Human-like pause before submit (2-4 seconds)
  const preSubmitDelay = 2000 + Math.floor(Math.random() * 2000);
  console.log(`DEBUG Pausing ${preSubmitDelay}ms before form submission (human simulation)...`);
  await page.waitForTimeout(preSubmitDelay);

  // Step 3: Simulate mouse movement to submit button
  try {
    await moveMouseToTarget(page, randomDelay(400, 600), randomDelay(300, 500));
  } catch (e) {
    console.log("DEBUG Could not simulate mouse movement to submit:", e);
  }

  // Step 4: Find and click submit button
  const selArray = Array.isArray(submitSelectors) ? submitSelectors : [submitSelectors];
  let clicked = false;
  
  for (const sel of selArray) {
    try {
      const button = await page.$(sel);
      if (button) {
        console.log(`DEBUG Clicking submit button: ${sel}`);
        
        // Scroll to button
        await button.scrollIntoViewIfNeeded();
        await page.waitForTimeout(randomDelay(100, 200));
        
        // Get bounding box for mouse movement
        const box = await button.boundingBox();
        if (box) {
          await moveMouseToTarget(page, box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(randomDelay(100, 300));
        }
        
        await button.click();
        clicked = true;
        break;
      }
    } catch (e) {
      console.log(`DEBUG Failed to click ${sel}:`, e);
    }
  }

  if (!clicked) {
    console.log("DEBUG No submit button found, trying keyboard Enter...");
    await page.keyboard.press('Enter');
  }

  // Step 5: Wait for navigation or response
  await page.waitForTimeout(1000);

  // Step 6: Verify submission success
  console.log("DEBUG Checking for submission confirmation or errors...");
  
  try {
    // Check for success indicators
    const successSelectors = [
      'text=Confirmation',
      'text=Success',
      'text=Thank you',
      '.messages--status',
      '.messages.status',
      'div.messages.status'
    ];
    
    for (const sel of successSelectors) {
      const found = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null);
      if (found) {
        const successText = await found.textContent();
        console.log(`DEBUG Form submission successful – found: ${sel} (${successText?.slice(0, 50)}...)`);
        return { success: true };
      }
    }
  } catch (e) {
    // Continue to error checking
  }

  // Check for error messages
  const errorSelectors = [
    '.messages--error',
    '.messages.error',
    'div.messages.error',
    'div[role="alert"]',
    '.form-item--error-message',
    '.error-message'
  ];

  for (const sel of errorSelectors) {
    try {
      const errorEl = await page.$(sel);
      if (errorEl) {
        const errorMsg = await errorEl.textContent();
        console.log("DEBUG Form submission failed with error:", errorMsg?.trim() || "no error text");
        return { 
          success: false, 
          errorMessage: errorMsg?.trim() || "Form submission error (no message)" 
        };
      }
    } catch (e) {
      // Try next selector
    }
  }

  // No clear success or error indicator found
  console.log("DEBUG Form submission result unclear – no confirmation or error found");
  
  // Capture page state for debugging
  const currentUrl = page.url();
  const pageTitle = await page.title();
  console.log(`DEBUG Current URL: ${currentUrl}, Title: ${pageTitle}`);
  
  // If URL changed from login/register page, assume success
  if (!currentUrl.includes('/user/login') && !currentUrl.includes('/register')) {
    console.log("DEBUG Assuming success based on URL change");
    return { success: true };
  }

  return { 
    success: false, 
    errorMessage: "Form submission result unclear – no confirmation found" 
  };
}
