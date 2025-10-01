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
}

export interface FormFillResult {
  success: boolean;
  captchaDetected?: boolean;
  antibotFieldsFound?: string[];
  fieldsFilledCount?: number;
  fieldsMissedCount?: number;
  error?: string;
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

    return {
      success: true,
      antibotFieldsFound: antibotFields.length > 0 ? antibotFields : undefined,
      fieldsFilledCount,
      fieldsMissedCount
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
 * Submit form with human-like behavior
 * 
 * @param page - Playwright page instance
 * @param submitSelectors - CSS selector(s) for the submit button
 * @param options - Optional configuration
 */
export async function submitFormHumanLike(
  page: Page,
  submitSelectors: string | string[],
  options: { preClickPause?: number; postClickWait?: number } = {}
): Promise<void> {
  const opts = {
    preClickPause: options.preClickPause ?? randomDelay(300, 700),
    postClickWait: options.postClickWait ?? 1000
  };

  console.log(`DEBUG Pausing ${opts.preClickPause}ms before clicking submit...`);
  await page.waitForTimeout(opts.preClickPause);

  // Find submit button
  const submitField = await findField(page, submitSelectors, 5000);
  
  if (!submitField) {
    console.log("DEBUG Submit button not found, trying keyboard Enter...");
    await page.keyboard.press('Enter');
  } else {
    console.log("DEBUG Clicking submit button...");
    
    // Scroll to submit button
    await submitField.scrollIntoViewIfNeeded();
    await page.waitForTimeout(randomDelay(100, 200));
    
    // Move mouse to submit button
    const box = await submitField.boundingBox();
    if (box) {
      await moveMouseToTarget(page, box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(randomDelay(100, 300));
    }
    
    // Click submit
    await submitField.click();
  }

  console.log(`DEBUG Waiting ${opts.postClickWait}ms after submission...`);
  await page.waitForTimeout(opts.postClickWait);
}
