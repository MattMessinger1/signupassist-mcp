/**
 * NavigationResolver - Handles navigation with configurable selectors
 */

import { Page } from 'playwright-core';
import { SelectorResolver } from './SelectorResolver';

export class NavigationResolver {
  private selectorResolver: SelectorResolver;

  constructor(orgRef: string) {
    this.selectorResolver = new SelectorResolver(orgRef);
  }

  /**
   * Navigate to programs page via left-nav or direct URL
   */
  async navigateToPrograms(page: Page, baseUrl: string): Promise<boolean> {
    const navSelectors = this.selectorResolver.resolve('navigation', 'programs');

    console.log(`[NavigationResolver] Attempting navigation with ${navSelectors.length} selectors`);

    // Try each nav selector
    for (const selector of navSelectors) {
      try {
        const link = page.locator(selector).first();
        const count = await link.count();
        
        if (count > 0) {
          console.log(`[NavigationResolver] Found nav link: ${selector}`);
          await link.scrollIntoViewIfNeeded().catch(() => {});
          await link.click();
          return true;
        }
      } catch (e) {
        // Try next selector
        continue;
      }
    }

    // Fallback to direct navigation
    console.log(`[NavigationResolver] Nav links not found, using direct URL`);
    await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
    return false;
  }

  /**
   * Navigate to dashboard
   */
  async navigateToDashboard(page: Page, baseUrl: string): Promise<boolean> {
    const navSelectors = this.selectorResolver.resolve('navigation', 'dashboard');

    for (const selector of navSelectors) {
      try {
        const link = page.locator(selector).first();
        const count = await link.count();
        
        if (count > 0) {
          await link.scrollIntoViewIfNeeded().catch(() => {});
          await link.click();
          return true;
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback to direct navigation
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    return false;
  }

  /**
   * Check if we're on the login page (session expired)
   */
  isLoginPage(page: Page): boolean {
    return page.url().includes('/user/login');
  }

  /**
   * Wait for page to settle after navigation
   */
  async waitForPageReady(page: Page, expectedSelectors?: string[]): Promise<void> {
    await page.waitForLoadState('networkidle');
    
    if (expectedSelectors && expectedSelectors.length > 0) {
      // Wait for any of the expected selectors
      const selectorString = expectedSelectors.join(', ');
      await page.waitForSelector(selectorString, { timeout: 15000 });
    }
  }
}
