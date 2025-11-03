/**
 * Programs-Only Three-Pass Extractor for Program Discovery
 * Optimized version that focuses solely on program listings
 */

import { Page } from 'playwright-core';
import OpenAI from 'openai';

export interface ProgramData {
  id: string;
  program_ref: string;
  title: string;
  description: string;
  schedule: string;
  age_range: string;
  skill_level: string;
  price: string;
  actual_id: string;
  org_ref: string;
}

interface ExtractorConfig {
  models: {
    vision: string;
    extractor: string;
    validator: string;
  };
  scope: 'program_list';
  selectors: {
    container: string[];
    title: string[];
    price: string[];
    schedule: string[];
  };
}

/**
 * Run the Programs-Only Three-Pass Extractor on the current page
 * Pass 1: Vision-based container identification
 * Pass 2: HTML extraction with AI assistance
 * Pass 3: Validation and normalization
 */
export async function runThreePassExtractorForPrograms(
  page: Page,
  orgRef: string,
  config: ExtractorConfig
): Promise<ProgramData[]> {
  
  console.log('[ProgramsExtractor] Starting extraction...');
  console.log('[ExtractorModels]', config.models);
  
  // Check API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  
  const openai = new OpenAI({ apiKey });
  
  try {
    const pageURL = page.url();
    console.log(`[ProgramsExtractor] Analyzing ${pageURL}`);
    
    // Capture page state
    const screenshot = await page.screenshot({ fullPage: false });
    const pageHTML = await page.content();
    
    // PASS 1: Identify program containers using Vision
    console.log('[ProgramsExtractor] Pass 1: Identifying containers...');
    const containers = await identifyProgramContainers(
      screenshot,
      pageHTML,
      config.selectors,
      openai,
      config.models.vision
    );
    console.log(`[ProgramsExtractor] Pass 1: Found ${containers.length} containers`);
    
    if (containers.length === 0) {
      console.warn('[ProgramsExtractor] No program containers found');
      return [];
    }
    
    // PASS 2: Extract structured data from HTML
    console.log('[ProgramsExtractor] Pass 2: Extracting program data...');
    const baseUrl = new URL(pageURL).origin;
    const extractedPrograms = await extractProgramData(
      pageHTML,
      containers,
      config.selectors,
      baseUrl,
      openai,
      config.models.extractor
    );
    console.log(`[ProgramsExtractor] Pass 2: Extracted ${extractedPrograms.length} programs`);
    
    // PASS 3: AI-powered validation and normalization
    console.log('[ProgramsExtractor] Pass 3: Validating and normalizing...');
    const result = await validateAndNormalize(
      extractedPrograms,
      orgRef,
      openai,
      config.models.validator
    );
    console.log(`[ProgramsExtractor] Pass 3: Final ${result.programs.length} programs`);
    
    // Map to ProgramData format
    return result.programs.map((p: any) => ({
      id: p.program_id,
      program_ref: p.program_id,
      title: p.title,
      description: p.brief || 'See website for details',
      schedule: p.schedule || 'TBD',
      age_range: p.ages || 'All Ages',
      skill_level: p.level || 'All Levels',
      price: p.price || 'Contact for pricing',
      actual_id: p.program_id,
      org_ref: orgRef
    }));
    
  } catch (error) {
    console.error('[ProgramsExtractor] ❌ Extraction failed:', error);
    throw error;
  }
}

/**
 * Pass 1: Identify program containers using Vision AI
 */
async function identifyProgramContainers(
  screenshot: Buffer,
  pageHTML: string,
  selectors: ExtractorConfig['selectors'],
  openai: OpenAI,
  model: string
): Promise<string[]> {
  
  const base64Image = screenshot.toString('base64');
  
  const prompt = `You are analyzing a ski club program listing page. 
Identify CSS selectors for program containers.

Expected elements in each container:
- Program title/name
- Price or fee information
- Schedule/dates/times
- Age range or skill level

Common patterns: ${selectors.container.join(', ')}

Return ONLY a JSON array of CSS selector strings, e.g.:
["table.views-table tr", ".program-card", ".views-row"]`;

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { 
            type: 'image_url', 
            image_url: { url: `data:image/png;base64,${base64Image}` }
          }
        ]
      }
    ]
  });

  const content = response.choices[0].message.content || '[]';
  try {
    const selectors = JSON.parse(content);
    return Array.isArray(selectors) ? selectors : [];
  } catch {
    console.warn('[ProgramsExtractor] Failed to parse Vision response, using defaults');
    return selectors.container;
  }
}

/**
 * Pass 2: Extract structured data from HTML
 */
async function extractProgramData(
  pageHTML: string,
  containerSelectors: string[],
  fieldSelectors: ExtractorConfig['selectors'],
  baseUrl: string,
  openai: OpenAI,
  model: string
): Promise<any[]> {
  
  const prompt = `Extract program data from this HTML.

Container selectors: ${containerSelectors.join(', ')}
Title selectors: ${fieldSelectors.title.join(', ')}
Price selectors: ${fieldSelectors.price.join(', ')}
Schedule selectors: ${fieldSelectors.schedule.join(', ')}

For each program, extract:
- program_id (unique identifier or slug)
- title
- price (with currency symbol)
- schedule (dates/times)
- ages (age range if available)
- level (skill level if available)
- brief (short description if available)
- link (registration URL if available, relative to ${baseUrl})

Return a JSON array of program objects.`;

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: 'You are an HTML parser. Return only valid JSON arrays.'
      },
      {
        role: 'user',
        content: `${prompt}\n\nHTML:\n${pageHTML.substring(0, 50000)}`
      }
    ]
  });

  const content = response.choices[0].message.content || '[]';
  try {
    const programs = JSON.parse(content);
    return Array.isArray(programs) ? programs : [];
  } catch {
    console.warn('[ProgramsExtractor] Failed to parse extraction response');
    return [];
  }
}

/**
 * Pass 3: Validate and normalize extracted data
 */
async function validateAndNormalize(
  programs: any[],
  orgRef: string,
  openai: OpenAI,
  model: string
): Promise<{ programs: any[] }> {
  
  if (programs.length === 0) {
    return { programs: [] };
  }

  const prompt = `Validate and normalize this program data for ${orgRef}.

Rules:
1. Ensure each program has a unique program_id
2. Standardize price formats (e.g., "$150", "$200/session")
3. Normalize schedule formats
4. Fill missing ages/level with sensible defaults
5. Remove duplicates (same title + price)
6. Sort by: lessons first, then camps, then other programs

Return JSON: { "programs": [...] }`;

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: 'You are a data validator. Return only valid JSON.'
      },
      {
        role: 'user',
        content: `${prompt}\n\nData:\n${JSON.stringify(programs, null, 2)}`
      }
    ]
  });

  const content = response.choices[0].message.content || '{"programs":[]}';
  try {
    return JSON.parse(content);
  } catch {
    console.warn('[ProgramsExtractor] Failed to parse validation response, returning raw data');
    return { programs };
  }
}
