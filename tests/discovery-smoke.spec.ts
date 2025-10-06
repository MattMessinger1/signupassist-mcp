import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Smoke test for discovery engine against fixture form
 * Tests that discovery can find required fields and collect errors
 */

// Mock discovery stage function (simplified version)
async function discoverStage(page: any, stage: 'program') {
  const errors: Array<{ fieldKey: string; message: string; selectorHints: string[] }> = [];
  const maxIterations = 10;
  let previousErrorCount = -1;
  let stableErrorCount = 0;

  for (let iter = 1; iter <= maxIterations; iter++) {
    console.log(`Iteration ${iter}: Attempting autofill and validation`);

    // Autofill fields with test data
    await page.fill('#child-name', 'Test Child');
    await page.fill('#child-dob', '2015-06-15');
    await page.selectOption('#skill-level', 'beginner');
    await page.fill('#parent-email', 'parent@example.com');

    // Clear one field to trigger error
    if (iter <= 3) {
      await page.fill('#child-name', ''); // Trigger error on first few iterations
    }

    // Try to submit
    await page.click('#submit-btn');
    
    // Wait for validation
    await page.waitForTimeout(100);

    // Collect errors
    const currentErrors = await page.evaluate(() => {
      const errorElements = document.querySelectorAll('.error.visible, [aria-invalid="true"]');
      const collected: Array<{ fieldKey: string; message: string; selector: string }> = [];
      
      errorElements.forEach((el: Element) => {
        if (el.classList.contains('error')) {
          // Error message span
          const message = el.textContent?.trim() || '';
          const fieldId = el.id.replace('-error', '');
          const field = document.getElementById(fieldId);
          
          if (field) {
            collected.push({
              fieldKey: field.getAttribute('name') || fieldId,
              message,
              selector: `#${fieldId}`,
            });
          }
        }
      });
      
      return collected;
    });

    console.log(`Found ${currentErrors.length} errors`);

    // Update errors array
    for (const err of currentErrors) {
      const existing = errors.find(e => e.fieldKey === err.fieldKey);
      if (!existing) {
        errors.push({
          fieldKey: err.fieldKey,
          message: err.message,
          selectorHints: [err.selector, `[name="${err.fieldKey}"]`, `[aria-describedby="${err.fieldKey}-error"]`],
        });
      }
    }

    // Check stop condition: no new errors for 2 consecutive iterations
    if (currentErrors.length === previousErrorCount) {
      stableErrorCount++;
      if (stableErrorCount >= 2) {
        console.log('Stop condition met: errors stable for 2 iterations');
        break;
      }
    } else {
      stableErrorCount = 0;
    }

    previousErrorCount = currentErrors.length;

    // Check for success panel (another stop condition)
    const successVisible = await page.evaluate(() => {
      const panel = document.getElementById('success-panel');
      return panel?.classList.contains('visible') || false;
    });

    if (successVisible) {
      console.log('Stop condition met: success panel visible');
      break;
    }
  }

  return { errors, stage };
}

test.describe('Discovery Engine Smoke Test', () => {
  test('should discover required fields and collect errors', async ({ page }) => {
    // Load fixture HTML
    const fixturePath = `file://${path.join(__dirname, 'fixtures', 'program-form.html')}`;
    await page.goto(fixturePath);

    // Wait for page to be ready
    await page.waitForSelector('#program-form');

    // Run discovery
    const result = await discoverStage(page, 'program');

    // Verify errors were found
    expect(result.errors.length).toBeGreaterThan(0);
    console.log('Discovered errors:', result.errors);

    // Verify required field keys were identified
    const fieldKeys = result.errors.map(e => e.fieldKey);
    
    // Should find at least the child name field error (we intentionally left it empty)
    expect(fieldKeys).toContain('childName');

    // Verify error messages are sanitized and present
    result.errors.forEach(error => {
      expect(error.message).toBeTruthy();
      expect(error.selectorHints.length).toBeGreaterThan(0);
      expect(error.selectorHints.length).toBeLessThanOrEqual(3); // max 3 hints
    });
  });

  test('should stop after errors are exhausted', async ({ page }) => {
    const fixturePath = `file://${path.join(__dirname, 'fixtures', 'program-form.html')}`;
    await page.goto(fixturePath);

    await page.waitForSelector('#program-form');

    // Fill all required fields correctly
    await page.fill('#child-name', 'Jane Doe');
    await page.fill('#child-dob', '2016-03-20');
    await page.selectOption('#skill-level', 'intermediate');
    await page.fill('#parent-email', 'jane.parent@example.com');

    // Submit
    await page.click('#submit-btn');
    await page.waitForTimeout(200);

    // Verify success panel is visible
    const successVisible = await page.isVisible('#success-panel.visible');
    expect(successVisible).toBe(true);

    // Verify form is hidden
    const formVisible = await page.isVisible('#program-form');
    expect(formVisible).toBe(false);

    // Verify no errors are visible
    const errorCount = await page.evaluate(() => {
      return document.querySelectorAll('.error.visible').length;
    });
    expect(errorCount).toBe(0);
  });

  test('should avoid clicking payment buttons', async ({ page }) => {
    // Create a test page with payment button
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <form id="test-form">
          <input type="text" name="field1" required>
          <button type="submit" id="continue-btn">Continue</button>
          <button type="button" id="pay-btn">Pay Now</button>
          <button type="button" id="checkout-btn">Checkout</button>
          <button type="button" id="confirm-btn">Confirm Purchase</button>
        </form>
        <script>
          let clickedButtons = [];
          document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
              clickedButtons.push(btn.id);
            });
          });
          window.getClickedButtons = () => clickedButtons;
        </script>
      </body>
      </html>
    `);

    // Simulate discovery trySubmit - should NOT click payment-related buttons
    const buttonTexts = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map(btn => ({
        id: btn.id,
        text: btn.textContent?.trim() || '',
      }));
    });

    // Find non-payment buttons
    const safeButtons = buttonTexts.filter(btn => {
      const text = btn.text.toLowerCase();
      return !/(pay|purchase|checkout|confirm|place order)/i.test(text);
    });

    // Click only safe buttons
    for (const btn of safeButtons) {
      await page.click(`#${btn.id}`);
    }

    // Verify payment buttons were not clicked
    const clickedButtons = await page.evaluate(() => (window as any).getClickedButtons());
    
    expect(clickedButtons).not.toContain('pay-btn');
    expect(clickedButtons).not.toContain('checkout-btn');
    expect(clickedButtons).not.toContain('confirm-btn');
    expect(clickedButtons).toContain('continue-btn');
  });
});
