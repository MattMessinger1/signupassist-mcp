/**
 * Three-Pass Extractor for Program Discovery
 * Uses AI to extract accurate program listings from SkiClubPro pages
 */

import { Page } from 'playwright-core';
import { openai, MODELS, withModel } from './oai.js';
import pLimit from 'p-limit';

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

/**
 * Run the Three-Pass Extractor on the current page
 * Pass 0: Preflight check (NEW)
 * Pass 1: Identify program containers
 * Pass 2: Extract structured data
 * Pass 3: AI-powered validation and normalization
 */
export async function runThreePassExtractor(
  page: Page,
  orgRef: string,
  provider: string
): Promise<ProgramData[]> {
  
  console.log('[ThreePassExtractor] Starting extraction...');
  console.log('[ExtractorModels]', { vision: MODELS.vision, extractor: MODELS.extractor, validator: MODELS.validator });
  
  try {
    const pageURL = page.url();
    console.log(`[ThreePassExtractor] Analyzing ${pageURL}`);
    
    // PASS 0: Preflight check (non-blocking)
    console.log('[ThreePassExtractor] Pass 0: Preflight check...');
    const preflight = await preflightCheck(page);
    if (!preflight.ok) {
      console.warn(`[ThreePassExtractor] ⚠️ Preflight warning: ${preflight.reason}`);
      if (preflight.should_go_to) {
        console.log(`[ThreePassExtractor] 💡 Suggestion: navigate to ${preflight.should_go_to}`);
      }
      // Continue anyway - extractor is resilient
    } else {
      console.log('[ThreePassExtractor] ✅ Preflight passed');
    }
    
    // Capture page state
    const screenshot = await page.screenshot({ fullPage: false }); // Upper section only
    const pageHTML = await page.content();
    
    // PASS 1: Identify program containers using Vision
    console.log('[ThreePassExtractor] Pass 1: Identifying containers...');
    const containers = await identifyProgramContainers(screenshot, pageHTML, pageURL);
    console.log(`[ThreePassExtractor] Pass 1: Found ${containers.length} containers`);
    
    if (containers.length === 0) {
      console.warn('[ThreePassExtractor] No program containers found');
      return [];
    }
    
    // PASS 2: Extract structured data from HTML
    console.log('[ThreePassExtractor] Pass 2: Extracting program data...');
    const baseUrl = new URL(pageURL).origin;
    const extractedPrograms = await extractProgramData(pageHTML, containers, baseUrl);
    console.log(`[ThreePassExtractor] Pass 2: Extracted ${extractedPrograms.length} programs`);
    
    // PASS 3: AI-powered validation and normalization
    console.log('[ThreePassExtractor] Pass 3: Validating and normalizing...');
    const result = await validateAndNormalize(extractedPrograms, orgRef, pageURL);
    console.log(`[ThreePassExtractor] Pass 3: Final ${result.programs.length} programs`);
    
    // Map to ProgramData format
    return result.programs.map((p: any) => ({
      id: p.program_id,
      program_ref: p.program_id,
      title: p.title,
      description: p.brief || 'See website for details',
      schedule: p.schedule || 'TBD',
      age_range: p.age_range || 'All ages',
      skill_level: 'All levels',
      price: p.price || 'See website',
      actual_id: p.program_id,
      org_ref: orgRef
    }));
    
  } catch (error) {
    console.error('[ThreePassExtractor] Extraction failed:', error);
    throw error;
  }
}

/**
 * Pass 0: Preflight check - validate we're on the right page
 */
async function preflightCheck(
  page: Page
): Promise<{ ok: boolean; reason?: string; should_go_to?: string }> {
  
  const url = page.url();
  const html = await page.content();
  
  const response = await openai.chat.completions.create(
    withModel(MODELS.extractor, {
      messages: [
      {
        role: 'system',
        content: `You are validating that we are on a provider's programs listing page.

Return JSON with:
{
  "ok": boolean,                     // true if this appears to be the registration/programs list
  "reason": string | null,           // short reason if not ok
  "should_go_to": string | null      // if not ok, suggested path (e.g., "/registration")
}

Rules:
- ok = true if the HTML includes strong cues like "Register", "Join Waitlist", or repeated program rows/cards.
- If url does not include "/registration", suggest should_go_to="/registration".
- No prose. JSON only.`
      },
      {
        role: 'user',
        content: `url: ${url}\n\nhtml: ${html.slice(0, 200000)}`
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'preflight_check',
        description: 'Validate page readiness',
        parameters: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
            should_go_to: { type: 'string' }
          },
          required: ['ok']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'preflight_check' } },
    temperature: 0.1
  }));
  
  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    return { ok: false, reason: 'No response from preflight' };
  }
  
  return JSON.parse(toolCall.function.arguments);
}

/**
 * Pass 1: Use OpenAI Vision to identify program containers
 */
async function identifyProgramContainers(
  screenshot: Buffer,
  html: string,
  url: string
): Promise<Array<{ id: string; hint: string; confidence: number }>> {
  
  const base64Image = screenshot.toString('base64');
  
  const response = await openai.chat.completions.create(
    withModel(MODELS.vision, {
      messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Find all visible containers that represent individual programs/classes.

Cues:
- A program/card row usually shows: title, schedule/dates, age range, price, and a Register/Join/Full button/link.
- Ignore navigation bars, filters, search inputs, footers, banners, ads, cookie bars.

Return JSON ONLY:
{
  "containers": [
    {
      "id": "p1",
      "hint": "css=.views-row:nth(1)  .registration-list-item  .program-row  .card",
      "confidence": 0.0
    }
  ]
}

Constraints:
- Max 30 containers.
- Order is top-to-bottom.
- Confidence in [0,1].
- No prose.`
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${base64Image}` }
          }
        ]
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'identify_program_containers',
        description: 'Return identified program containers',
        parameters: {
          type: 'object',
          properties: {
            containers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  hint: { type: 'string' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['id', 'confidence']
              }
            }
          },
          required: ['containers']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'identify_program_containers' } }
  }));
  
  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn('[ThreePassExtractor] Pass 1: No tool call returned');
    return [];
  }
  
  const result = JSON.parse(toolCall.function.arguments);
  return result.containers || [];
}

/**
 * Pass 2: Extract structured program data from HTML
 * Now with parallel batch processing for speed
 */
async function extractProgramData(
  html: string,
  containers: Array<{ id: string; hint: string; confidence: number }>,
  baseUrl: string
): Promise<any[]> {
  
  // Batch containers into groups to stay under token limits
  // ~10-12 containers per batch is safe for most pages
  const BATCH_SIZE = 10;
  const batches: typeof containers[] = [];
  for (let i = 0; i < containers.length; i += BATCH_SIZE) {
    batches.push(containers.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`[Pass 2] Processing ${containers.length} containers in ${batches.length} batches`);
  
  // Parallel extraction with concurrency limit (3 concurrent API calls)
  const limit = pLimit(3);
  
  const allPrograms = await Promise.all(
    batches.map((batch, idx) => 
      limit(async () => {
        console.log(`[Pass 2] Batch ${idx + 1}/${batches.length}: Processing ${batch.length} containers`);
        const programs = await extractBatch(html, batch, baseUrl);
        console.log(`[Pass 2] Batch ${idx + 1}/${batches.length}: Extracted ${programs.length} programs`);
        return programs;
      })
    )
  );
  
  return allPrograms.flat();
}

/**
 * Extract a single batch of program containers
 */
async function extractBatch(
  html: string,
  containers: Array<{ id: string; hint: string; confidence: number }>,
  baseUrl: string
): Promise<any[]> {
  
  const response = await openai.chat.completions.create(
    withModel(MODELS.extractor, {
      messages: [
      {
        role: 'system',
        content: `Extract programs from the provided HTML container snippets.

Return JSON ONLY:
{
  "programs": [
    {
      "program_id": "stable-slug-from-title-and-schedule",
      "title": "≤ 60 chars",
      "brief": "≤ 90 chars or null",
      "schedule": "dates / day / time in 1 compact line or null",
      "age_range": "e.g., Ages 7–10 or null",
      "season": "e.g., Winter 2025 or null",
      "price": "$123" | "Free" | null,
      "status": "open" | "waitlist" | "full" | "closed" | null,
      "cta_label": "Register | Join Waitlist | Details | null",
      "cta_href": "absolute URL or null"
    }
  ]
}

CRITICAL RULES - Skip Non-Programs:
- SKIP any row that is a TABLE HEADER (contains only "Day", "Age", "Price", "Status", etc.)
- SKIP any row that is NAVIGATION/ACTION (only contains "Confirm", "Select", "Cancel", "Back")
- SKIP any row with EMPTY or WHITESPACE-ONLY cells
- ONLY extract rows that represent ACTUAL PROGRAMS with:
  * A meaningful program title (not generic labels like "Program Name" or "Class Title")
  * At least 2 populated fields (title + schedule/price/age)
  * A registration link or clear status indicator

Field Population Rules:
- Populate fields ONLY from visible text in the HTML
- If a field is missing or unclear, set to null
- Normalize status to lowercase: "open" | "waitlist" | "full" | "closed"
- Build program_id as a URL-safe slug from title+schedule (lowercase, hyphens only)
- Resolve relative links to absolute using base_url
- Keep descriptions brief (≤90 chars)

No prose. JSON only.`
      },
      {
        role: 'user',
        content: `base_url: ${baseUrl}\n\ncontainer_html: ${html.slice(0, 50000)}`
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'extract_program_data',
        description: 'Extract program fields',
        parameters: {
          type: 'object',
          properties: {
            programs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  program_id: { type: 'string' },
                  title: { type: 'string' },
                  brief: { type: 'string' },
                  schedule: { type: 'string' },
                  age_range: { type: 'string' },
                  season: { type: 'string' },
                  price: { type: 'string' },
                  status: { type: 'string', enum: ['open', 'waitlist', 'full', 'closed'] },
                  cta_label: { type: 'string' },
                  cta_href: { type: 'string' },
                  program_ref: { type: 'string' }
                },
                required: ['title']
              }
            }
          },
          required: ['programs']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'extract_program_data' } },
    temperature: 0.1
  }));
  
  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn('[ThreePassExtractor] Pass 2 Batch: No tool call returned');
    return [];
  }
  
  const result = JSON.parse(toolCall.function.arguments);
  return result.programs || [];
}

/**
 * Pass 3: AI-powered validation and normalization
 */
async function validateAndNormalize(
  programs: any[],
  orgRef: string,
  sourceUrl: string
): Promise<any> {
  
  const response = await openai.chat.completions.create(
    withModel(MODELS.validator, {
      messages: [
      {
        role: 'system',
        content: `You will receive an array of program records. Clean, deduplicate, and normalize.

Steps:
1) Drop any record that lacks both title AND schedule.
2) De-dupe by identical (title + schedule), prefer the one that has a price/status/cta.
3) price: keep "$123" or "Free" exactly; strip other characters.
4) status: map to one of ["open","waitlist","full","closed"]; default "open" if ambiguous.
5) Trim whitespace on all fields; ensure "program_id" is a URL-safe slug (lowercase; hyphens).
6) Keep strings short: title ≤60, brief ≤90, schedule ≤120.
7) Sort by original appearance order if available; else by title asc.

Return JSON ONLY:
{
  "programs": [ …final records… ],
  "metadata": {
    "org_ref": "...",
    "source_url": "...",
    "timestamp": 0
  }
}`
      },
      {
        role: 'user',
        content: `programs: ${JSON.stringify(programs)}\norg_ref: ${orgRef}\nsource_url: ${sourceUrl}`
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'validate_and_normalize',
        description: 'Clean and normalize programs',
        parameters: {
          type: 'object',
          properties: {
            programs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  program_id: { type: 'string' },
                  title: { type: 'string' },
                  brief: { type: 'string' },
                  schedule: { type: 'string' },
                  age_range: { type: 'string' },
                  season: { type: 'string' },
                  price: { type: 'string' },
                  status: { type: 'string' },
                  cta_label: { type: 'string' },
                  cta_href: { type: 'string' }
                },
                required: ['program_id', 'title']
              }
            },
            metadata: {
              type: 'object',
              properties: {
                org_ref: { type: 'string' },
                source_url: { type: 'string' },
                timestamp: { type: 'number' }
              },
              required: ['org_ref', 'source_url', 'timestamp']
            }
          },
          required: ['programs', 'metadata']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'validate_and_normalize' } },
    temperature: 0.1
  }));
  
  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    return { 
      programs: [], 
      metadata: { org_ref: orgRef, source_url: sourceUrl, timestamp: Date.now() } 
    };
  }
  
  return JSON.parse(toolCall.function.arguments);
}
