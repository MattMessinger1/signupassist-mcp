import type { Page } from 'playwright-core';

export interface ProgramData {
  program_ref: string;
  title: string;
  schedule_text: string;
  age_range: string;
  price: string;
  status: string;
  url?: string;
}

/**
 * Scrape all programs from the registration listing page
 */
export async function scrapeProgramList(page: Page, baseUrl: string): Promise<ProgramData[]> {
  // Navigate to registration page
  await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
  
  const cardSelector = '.views-row, .program-card, tr[class*="views-row"]';
  const programElements = await page.locator(cardSelector).all();

  const programsList: ProgramData[] = [];
  
  for (const el of programElements) {
    try {
      const programData = await el.evaluate((element) => {
        // Helper to extract text content from the element using any of the given selectors
        const findText = (elem: Element, selectors: string[]): string => {
          for (const sel of selectors) {
            const found = elem.querySelector(sel);
            if (found && found.textContent && found.textContent.trim()) {
              return found.textContent.trim();
            }
          }
          return '';
        };
        const title = findText(element, ['.views-field-title a', '.program-title', 'h3', 'a[href*="program"]']) || '';
        if (!title) return null;
        const price = findText(element, ['.views-field-field-price', '.price']) || '';
        const schedule = findText(element, ['.views-field-field-schedule', '.schedule']) || '';
        const ageRange = findText(element, ['.views-field-field-age', '.age-range', '[class*="age"]', 'td:nth-child(3)']) || '';
        const regLinkElem = element.querySelector('a[href*="registration"], a[href*="register"]');
        const url = regLinkElem ? (regLinkElem as HTMLAnchorElement).href : '';
        let status = '';
        if (regLinkElem && (regLinkElem as HTMLElement).innerText) {
          const linkText = (regLinkElem as HTMLElement).innerText.toLowerCase();
          if (linkText.includes('waitlist')) status = 'Waitlist';
          else if (linkText.includes('full') || linkText.includes('sold out') || linkText.includes('closed')) status = 'Full';
          else status = 'Open';
        }
        return { title, price, schedule, ageRange, url, status };
      });
      
      if (!programData || !programData.title) {
        continue;
      }
      
      // Derive a stable program reference (ID or slug)
      let programRef = '';
      if (programData.url) {
        const match = programData.url.match(/\/(?:program|registration)\/(\d+)/);
        if (match) programRef = match[1];
      }
      if (!programRef) {
        // Fallback to slug from title if numeric ID not found
        programRef = programData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      }

      programsList.push({
        program_ref: programRef,
        title: programData.title,
        schedule_text: programData.schedule,
        age_range: programData.ageRange,
        price: programData.price,
        status: programData.status,
        url: programData.url
      });
    } catch (extractErr: any) {
      console.error(`⚠️ Error extracting a program entry:`, extractErr.message);
      // Continue to next element without throwing
    }
  }
  
  return programsList;
}
