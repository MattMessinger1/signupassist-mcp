import type { Page } from "playwright-core";

/**
 * Wait for SkiClubPro program listing page to be ready
 * Ensures registration table and interactive buttons are fully loaded
 */
export async function waitForSkiClubProReady(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log("[SCP Ready] Waiting for program table or Register buttons...");

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.waitForFunction(() => {
        const html = document.body.innerHTML;
        return (
          html.includes("Register") ||
          html.includes("View Details") ||
          html.includes("Sold Out") ||
          html.includes("Waiting list") ||
          document.querySelectorAll("td.views-field-title, .views-row, .program, table tr").length > 5
        );
      }, { timeout: 20000 });
      console.log(`[SCP Ready] ✓ Program content detected (attempt ${attempt})`);
      return;
    } catch {
      console.warn(`[SCP Ready] Attempt ${attempt} timed out, reloading page...`);
      await page.reload();
    }
  }
  throw new Error("[SCP Ready] Timeout: no program content after retries");
}
