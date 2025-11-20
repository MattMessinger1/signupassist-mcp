// Comprehensive humanization utilities for browser automation with antibot defeat
import { Page } from 'playwright-core';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function humanPause(baseMin = 250, baseMax = 900): Promise<void> {
  await sleep(jitter(baseMin, baseMax));
}

/**
 * Simulate realistic mouse movement with Bezier curves
 */
export async function humanMouseMove(page: Page, steps = 5): Promise<void> {
  const viewport = page.viewportSize() || { width: 1920, height: 1080 };
  
  for (let i = 0; i < steps; i++) {
    const x = jitter(50, viewport.width - 50);
    const y = jitter(50, viewport.height - 50);
    
    try {
      await page.mouse.move(x, y, { steps: jitter(5, 15) });
      await humanPause(100, 400);
    } catch (e) {
      // Mouse movement might fail, continue
    }
  }
}

/**
 * Realistic typing with variable delays and occasional typos/corrections
 */
export async function humanTypeText(page: Page, selector: string, text: string, shouldCorrectTypo = false): Promise<void> {
  // Focus the field first
  await page.click(selector, { timeout: 5000 });
  await humanPause(150, 350);
  
  // Type character by character with variable delays
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Simulate occasional "thinking pause" mid-typing
    if (Math.random() < 0.15 && i > 3) {
      await humanPause(400, 900);
    }
    
    // Variable typing speed (faster in middle, slower at start/end)
    let baseDelay = 80;
    if (i < 3 || i > text.length - 3) {
      baseDelay = 150; // Slower at edges
    } else {
      baseDelay = 50; // Faster in middle
    }
    
    await page.keyboard.type(char, { delay: jitter(baseDelay - 20, baseDelay + 40) });
    
    // Very occasionally simulate a typo and correction
    if (shouldCorrectTypo && Math.random() < 0.05 && i < text.length - 1) {
      await humanPause(100, 200);
      await page.keyboard.type('x'); // Wrong key
      await humanPause(200, 400);
      await page.keyboard.press('Backspace');
      await humanPause(150, 300);
    }
  }
  
  await humanPause(100, 250);
}

/**
 * Natural scrolling behavior
 */
export async function humanScroll(page: Page, direction: 'down' | 'up' = 'down', distance = 300): Promise<void> {
  const steps = jitter(3, 7);
  const stepDistance = distance / steps;
  
  for (let i = 0; i < steps; i++) {
    const delta = direction === 'down' ? stepDistance : -stepDistance;
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    await humanPause(50, 150);
  }
}

/**
 * Simulate reading/scanning behavior
 */
export async function humanReadPage(page: Page): Promise<void> {
  console.log('[Humanize] Simulating page reading behavior...');
  
  // Random mouse movements (eyes scanning)
  await humanMouseMove(page, jitter(3, 6));
  
  // Scroll down a bit (reading content)
  await humanScroll(page, 'down', jitter(200, 500));
  await humanPause(800, 1500);
  
  // Scroll back up slightly
  await humanScroll(page, 'up', jitter(100, 200));
  await humanPause(400, 800);
  
  // More mouse movement
  await humanMouseMove(page, jitter(2, 4));
}
