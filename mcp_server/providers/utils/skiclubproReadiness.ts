import type { Page } from "playwright-core";

/**
 * Wait for SkiClubPro program listing page to be ready
 * Ensures registration table and interactive buttons are fully loaded
 */
export async function waitForSkiClubProReady(page: Page): Promise<void> {
  // Force desktop viewport to avoid mobile card view
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log("[SCP Ready] Waiting for program table to load...");

  try {
    // Wait for program content indicators:
    // - Register/Sold Out/Waiting list buttons
    // - Multiple program rows or cards
    await page.waitForFunction(() => {
      const html = document.body.innerHTML;
      return (
        html.includes("Register") ||
        html.includes("Sold Out") ||
        html.includes("Waiting list") ||
        document.querySelectorAll("td.views-field-title, .views-row, .program").length > 5
      );
    }, { timeout: 30000 });
    
    console.log("[SCP Ready] ✓ Program content detected");
  } catch {
    throw new Error("[SCP Ready] Timeout: no program content after 30s");
  }
}
