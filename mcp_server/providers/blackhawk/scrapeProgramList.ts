import type { Page } from 'playwright-core';
import { isAuthenticated } from './login.js';
import { runThreePassExtractorForPrograms } from '../../lib/threePassExtractor.programs.js';
import { telemetry } from '../../lib/telemetry.js';

export interface ProgramData {
  program_ref: string;
  title: string;
  price: string;
  status: string;
  url?: string;
  signup_start_time?: string;
  is_full?: boolean;
  theme?: string;
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
  
  // Define CSS fallback extraction for use on failure or empty result
  const fallbackExtract = async (): Promise<ProgramData[]> => {
    console.log('[blackhawk-ski-club] 🟢 Falling back to CSS selector extraction...');
    const cardSelector = '.views-row, .program-card, tr[class*="views-row"]';
    const programElements = await page.locator(cardSelector).all();
    const programsList: ProgramData[] = [];
    
    for (const el of programElements) {
      try {
        const programData = await el.evaluate((element) => {
          const findText = (elem: Element, selectors: string[]): string => {
            for (const sel of selectors) {
              const found = elem.querySelector(sel);
              if (found?.textContent?.trim()) {
                return found.textContent.trim();
              }
            }
            return '';
          };
          const title = findText(element, ['.views-field-title a', '.program-title', 'h3', 'a[href*="program"]']) || '';
          if (!title) return null;
          const price = findText(element, ['.views-field-field-price', '.price']) || '';
          const regLinkElem = element.querySelector('a[href*="registration"], a[href*="register"]');
          const url = regLinkElem ? (regLinkElem as HTMLAnchorElement).href : '';
          let status = '';
          if (regLinkElem && (regLinkElem as HTMLElement).innerText) {
            const linkText = (regLinkElem as HTMLElement).innerText.toLowerCase();
            if (linkText.includes('waitlist')) status = 'Waitlist';
            else if (linkText.includes('full') || linkText.includes('sold out') || linkText.includes('closed')) status = 'Full';
            else status = 'Register';
          }
          return { title, price, url, status };
        });
        
        if (!programData || !programData.title) continue;
        
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
          price: programData.price,
          status: programData.status,
          url: programData.url,
          is_full: programData.status === 'Full' || programData.status === 'Waitlist'
        });
      } catch (extractErr: any) {
        console.error(`⚠️ Error extracting a program entry:`, extractErr.message);
      }
    }
    
    console.log(`[blackhawk-ski-club] 📋 Fallback extraction found ${programsList.length} programs`);
    return programsList;
  };

  try {
    const extractedPrograms = await runThreePassExtractorForPrograms(
      page,
      'blackhawk-ski-club',
      {
        scope: "program_list",
        selectors: {
          container: ['.views-row', '.program-card', 'tr[class*="views-row"]', 'table.views-table > tbody > tr', 'article', '[class*="program"]'],
          title: ['.views-field-title a', '.program-title', 'h3', 'a[href*="program"]'],
          price: ['.views-field-field-price', '.price', '[class*="price"]'],
          schedule: ['.views-field-field-schedule', '.schedule', '[class*="schedule"]']
        }
      },
      'all',
      undefined,
      true  // skipCache for fresh data
    );
    
    if (!extractedPrograms || extractedPrograms.length === 0) {
      console.warn('[blackhawk-ski-club] ⚠️ AI extractor returned no programs, using CSS fallback.');
      const programsList = await fallbackExtract();
      telemetry.record("extraction_method", { provider: "blackhawk", method: "css", program_count: programsList.length, fallback_reason: "empty" });
      return programsList;
    }
    
    console.log(`[blackhawk-ski-club] ✅ AI extraction found ${extractedPrograms.length} programs`);
    telemetry.record("extraction_method", { provider: "blackhawk", method: "ai", program_count: extractedPrograms.length });
    
    const programsList: ProgramData[] = extractedPrograms.map((prog: any) => ({
      program_ref: (prog.cta_href && prog.cta_href.match(/\/(?:program|registration)\/(\d+)/))
                   ? prog.cta_href.match(/\/(?:program|registration)\/(\d+)/)![1]
                   : (prog.program_ref || ''),
      title: prog.title || '',
      price: prog.price || '',
      status: (!prog.status || prog.status.toLowerCase() === 'open') ? 'Register' : prog.status,
      url: prog.cta_href ? (prog.cta_href.startsWith('/') ? baseUrl + prog.cta_href : prog.cta_href) : '',
      signup_start_time: prog.signup_start_time || '',
      is_full: ['full', 'waitlist'].includes((prog.status || '').toLowerCase())
    }));
    
    return programsList;
  } catch (aiError: any) {
    console.error('[blackhawk-ski-club] ⚠️ AI extraction failed, falling back to CSS selectors:', aiError.message);
    const programsList = await fallbackExtract();
    const reason = aiError.message?.includes('invalid JSON') ? 'parse_error' : 'exception';
    telemetry.record("extraction_error", { provider: "blackhawk", error_type: reason, error: aiError.message });
    telemetry.record("extraction_method", { provider: "blackhawk", method: "css", program_count: programsList.length, fallback_reason: reason });
    return programsList;
  }
}
