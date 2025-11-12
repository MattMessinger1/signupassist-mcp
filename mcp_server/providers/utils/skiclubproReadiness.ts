import type { Page } from "playwright-core";

/**
 * Wait for SkiClubPro program listing page to be ready
 * Ensures registration table and interactive buttons are fully loaded
 */
export async function waitForSkiClubProReady(page: Page): Promise<boolean> {
  const timeout = Number(process.env.SKICLUBPRO_READY_TIMEOUT_MS || 6500);
  const maxReloads = Number(process.env.SKICLUBPRO_READY_MAX_RELOADS || 2);
  const selectors = [
    '#registration-table', '.view-registrations .views-row', 'table.views-table',
    '.card-body', '.card',  // Modern card-based layouts (Blackhawk structure)
    'a[href*="/register"]', 'button:has-text("Register")', '.program-card, .node--type-program'
  ];
  
  for (let attempt = 0; attempt <= maxReloads; attempt++) {
    const ok = await page.waitForSelector(selectors.join(","), { timeout }).then(() => true).catch(() => false);
    if (ok) return true;
    console.warn(`[SCP Ready] Attempt ${attempt + 1} failed, reloading...`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 6000 });
  }
  
  throw new Error("[SCP Ready] Timeout: no program content after retries");
}
