import type { Page } from "playwright-core";

/**
 * Wait for SkiClubPro program listing page to be ready
 * Ensures registration table and interactive buttons are fully loaded
 */
export async function waitForSkiClubProReady(page: Page, retries: number = 2): Promise<boolean> {
  await page.setViewportSize({ width: 1280, height: 900 });

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`[SCP Ready] Checking for program table or Register buttons...`);

    const result = await Promise.race([
      // ✅ Success indicators
      page.waitForSelector('a.btn.btn-secondary.btn-sm:has-text("Register")', { timeout: 8000 }).then(() => 'button'),
      page.waitForSelector('table.views-table', { timeout: 8000 }).then(() => 'table'),
      page.waitForSelector('div.view-content', { timeout: 8000 }).then(() => 'view-content'),
      page.waitForFunction(
        () => document.querySelectorAll('a.btn, tr, .view-content').length > 0,
        { timeout: 8000 }
      ).then(() => 'dynamic'),

      // ❌ Fallback timer
      new Promise<null>(res => setTimeout(() => res(null), 8000))
    ]);

    if (result) {
      console.log(`[SCP Ready] ✅ Page ready via ${result}`);
      return true;
    }

    console.warn(`[SCP Ready] Attempt ${attempt} timed out, reloading page...`);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  throw new Error('[SCP Ready] Timeout: no program content after retries');
}
