import type { Page } from 'playwright-core';
import { isAuthenticated } from './login.js';
import { runThreePassExtractorForPrograms } from '../../lib/threePassExtractor.programs.js';
import { MODELS } from '../../lib/oai.js';

export interface ProgramData {
  program_ref: string;
  title: string;
  schedule_text: string;
  age_range: string;
  price: string;
  status: string;
  url?: string;
  theme?: string;
  description?: string;
}

/**
 * Scrape all programs from the registration listing page using AI extraction
 */
export async function scrapeProgramList(page: Page, baseUrl: string): Promise<ProgramData[]> {
  // Navigate to registration page
  await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
  
  // Ensure we are still logged in before scraping (fail-fast safety)
  const stillAuthed = await isAuthenticated(page);
  if (!stillAuthed) {
    console.error('[blackhawk-ski-club] ❌ Authentication dropped mid-scrape.');
    return [];
  }
  
  console.log('[blackhawk-ski-club] 🤖 Using AI-powered extraction for program scraping...');
  
  try {
    // Use Three-Pass AI Extractor with defensive selectors
    const extractedPrograms = await runThreePassExtractorForPrograms(
      page,
      'blackhawk-ski-club',
      {
        models: {
          vision: MODELS.vision,
          extractor: MODELS.extractor,
          validator: MODELS.validator
        },
        scope: "program_list",
        selectors: {
          container: [
            '.views-row',
            '.program-card',
            'tr[class*="views-row"]',
            'table.views-table > tbody > tr',
            'article',
            '[class*="program"]'
          ],
          title: [
            '.views-field-title a',
            '.program-title',
            'h3',
            'a[href*="program"]'
          ],
          price: [
            '.views-field-field-price',
            '.price',
            '[class*="price"]'
          ],
          schedule: [
            '.views-field-field-schedule',
            '.schedule',
            '[class*="schedule"]'
          ]
        }
      },
      'all',        // category
      undefined,    // no filters
      true          // skipCache for fresh data
    );
    
    console.log(`[blackhawk-ski-club] ✅ AI extraction found ${extractedPrograms.length} programs`);
    
    // Transform AI extractor output to our ProgramData format
    const programsList: ProgramData[] = extractedPrograms.map((prog: any) => ({
      program_ref: prog.program_ref || prog.id || '',
      title: prog.title || '',
      schedule_text: prog.schedule || '',
      age_range: prog.age_range || '',
      price: prog.price || '',
      status: prog.status || 'Open',
      url: prog.cta_href || '',
      description: prog.description || ''
    }));
    
    return programsList;
    
  } catch (aiError: any) {
    console.error('[blackhawk-ski-club] ⚠️ AI extraction failed, falling back to CSS selectors:', aiError.message);
    
    // Fallback to CSS selector-based extraction
    const cardSelector = '.views-row, .program-card, tr[class*="views-row"]';
    const programElements = await page.locator(cardSelector).all();

    const programsList: ProgramData[] = [];
    
    for (const el of programElements) {
      try {
        const programData = await el.evaluate((element) => {
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
        
        let programRef = '';
        if (programData.url) {
          const match = programData.url.match(/\/(?:program|registration)\/(\d+)/);
          if (match) programRef = match[1];
        }
        if (!programRef) {
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
      }
    }
    
    console.log(`[blackhawk-ski-club] 📋 Fallback extraction found ${programsList.length} programs`);
    return programsList;
  }
}
