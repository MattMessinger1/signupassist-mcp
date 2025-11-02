/**
 * Three-Pass Extractor for Program Discovery
 * Uses AI to extract accurate program listings from SkiClubPro pages
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

/**
 * Run the Three-Pass Extractor on the current page
 * Pass 1: Identify program containers
 * Pass 2: Extract structured data
 * Pass 3: Validate and normalize
 */
export async function runThreePassExtractor(
  page: Page,
  orgRef: string,
  provider: string
): Promise<ProgramData[]> {
  
  console.log('[ThreePassExtractor] Starting extraction...');
  
  // Check API key BEFORE instantiation
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = 'OPENAI_API_KEY environment variable is not set. Configure it in Railway project variables.';
    console.error(`[ThreePassExtractor] ❌ ${error}`);
    throw new Error(error);
  }
  
  const openai = new OpenAI({ apiKey });
  console.log('[ThreePassExtractor] Using model: gpt-5-2025-08-07 (vision), gpt-5-mini-2025-08-07 (text)');
  
  try {
    // Capture page state
    const screenshot = await page.screenshot({ fullPage: true });
    const pageHTML = await page.content();
    const pageURL = page.url();
    
    console.log(`[ThreePassExtractor] Analyzing ${pageURL}`);
    
    // PASS 1: Identify program containers using Vision
    console.log('[ThreePassExtractor] Pass 1: Identifying program containers...');
    const containers = await identifyProgramContainers(screenshot, pageHTML);
    console.log(`[ThreePassExtractor] Pass 1: Identified ${containers.length} program containers`);
    
    if (containers.length === 0) {
      console.warn('[ThreePassExtractor] No program containers found');
      return [];
    }
    
    // PASS 2: Extract structured data from HTML
    console.log('[ThreePassExtractor] Pass 2: Extracting program data...');
    const extractedPrograms = await extractProgramData(pageHTML, containers, orgRef);
    console.log(`[ThreePassExtractor] Pass 2: Extracted ${extractedPrograms.length} programs`);
    console.log('[ThreePassExtractor] Pass 2: Programs extracted:', extractedPrograms.map(p => p.title).join(', '));
    
    // PASS 3: Validate and normalize
    console.log('[ThreePassExtractor] Pass 3: Validating and normalizing...');
    const validatedPrograms = validateAndNormalize(extractedPrograms, orgRef);
    console.log(`[ThreePassExtractor] Pass 3: Validated ${validatedPrograms.length} programs`);
    
    return validatedPrograms;
    
  } catch (error) {
    console.error('[ThreePassExtractor] Extraction failed:', error);
    throw error;
  }
}

/**
 * Pass 1: Use OpenAI Vision to identify program containers
 * 
 * EXTRACTOR_PROMPT__PROGRAMS_ONLY (Pass 1)
 */
async function identifyProgramContainers(
  screenshot: Buffer,
  html: string
): Promise<Array<{ selector: string; index: number }>> {
  
  const base64Image = screenshot.toString('base64');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-5-2025-08-07',  // Vision-structured capability for OCR precision (multimodal)
    messages: [
      {
        role: 'system',
        content: `Context: You will extract programs/classes that a parent can enroll in from the provider's registration page (e.g., SkiClubPro). Treat this page as the canonical list.

Pass 1 — Identify Program Containers (Vision)

From the screenshot, identify all visible program containers (cards, rows, or list items) likely to correspond to individual programs. Typical cues: a program title, a session/season, date/time, age range, price/fee, and a Register button or link.

DO NOT extract prerequisites, waivers, or payment fields. This extractor is for program discovery only.

Output: an ordered list of program containers with DOM hints (CSS/XPath snippets) for each container.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Identify all visible program containers (cards, rows, or list items) from the screenshot. Look for program titles, schedules, dates, ages, prices, and Register/Join buttons. Return a container for each distinct program offering.'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'identify_program_containers',
        description: 'Return the identified program containers',
        parameters: {
          type: 'object',
          properties: {
            containers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: {
                    type: 'string',
                    description: 'CSS selector or class name visible on the card'
                  },
                  index: {
                    type: 'number',
                    description: 'Position index on the page'
                  }
                },
                required: ['index']
              }
            }
          },
          required: ['containers']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'identify_program_containers' } }
  });
  
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
 * 
 * EXTRACTOR_PROMPT__PROGRAMS_ONLY (Pass 2)
 */
async function extractProgramData(
  html: string,
  containers: Array<{ selector: string; index: number }>,
  orgRef: string
): Promise<Partial<ProgramData>[]> {
  
  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini-2025-08-07',  // Structured-json capability for field completeness
    messages: [
      {
        role: 'system',
        content: `Pass 2 — Extract Program Fields (HTML to structured)

For each container, extract these fields when present (leave null if missing; never invent values):
- program_id (stable hash/slug derived from title+dates)
- title (short, readable)
- brief (1‑sentence summary or level, if available)
- age_range (e.g., "Ages 7–10")
- schedule (dates and day/time; keep it concise)
- season (e.g., "2025 Winter", if present)
- price (numeric + currency symbol if shown, e.g., "$180")
- status ("open", "waitlist", "full", "closed", if shown)
- cta_label (e.g., "Register", "Join Waitlist")
- cta_href (absolute URL if available)

Extract the EXACT text visible - do not rephrase, summarize, or invent information. Copy program titles, prices, and details word-for-word as they appear.`
      },
      {
        role: 'user',
        content: `Extract programs from this HTML. Return exactly what you see - do not paraphrase or invent programs. If you cannot find programs in the HTML, return an empty array rather than making up fake ones.\n\nHTML:\n${html.slice(0, 50000)}`
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'extract_program_data',
        description: 'Return the extracted program data',
        parameters: {
          type: 'object',
          properties: {
            programs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  program_id: { type: 'string', description: 'Stable slug derived from title+dates' },
                  title: { type: 'string', description: 'Program title (≤60 chars)' },
                  brief: { type: 'string', description: '1-sentence summary or level (≤90 chars)' },
                  description: { type: 'string', description: 'Longer program description if available' },
                  age_range: { type: 'string', description: 'Age range (e.g., "Ages 7–10")' },
                  schedule: { type: 'string', description: 'Dates and day/time in compact format' },
                  season: { type: 'string', description: 'Season (e.g., "2025 Winter")' },
                  skill_level: { type: 'string', description: 'Skill level (beginner, intermediate, advanced)' },
                  price: { type: 'string', description: 'Price with currency symbol (e.g., "$180")' },
                  status: { type: 'string', enum: ['open', 'waitlist', 'full', 'closed'], description: 'Program status' },
                  cta_label: { type: 'string', description: 'Call-to-action button label' },
                  cta_href: { type: 'string', description: 'Absolute URL for registration' },
                  program_ref: { type: 'string', description: 'Program ID or reference code from provider' }
                },
                required: ['title']
              }
            }
          },
          required: ['programs']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'extract_program_data' } }
  });
  
  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn('[ThreePassExtractor] Pass 2: No tool call returned');
    return [];
  }
  
  const result = JSON.parse(toolCall.function.arguments);
  return result.programs || [];
}

/**
 * Pass 3: Validate and normalize program data
 * 
 * EXTRACTOR_PROMPT__PROGRAMS_ONLY (Pass 3)
 * 
 * - Ensure program_id is URL‑safe and stable.
 * - Normalize currency formatting (e.g., "$180").
 * - Trim whitespace; keep title ≤ 60 chars, brief ≤ 90 chars.
 * - If multiple dates/times exist, choose a compact human‑readable summary for schedule.
 * - Do not drop records unless clearly not a program (e.g., newsletter signup).
 */
function validateAndNormalize(
  programs: Partial<ProgramData>[],
  orgRef: string
): ProgramData[] {
  
  return programs.map((prog, index) => {
    // Generate stable, URL-safe program_id
    const rawId = (prog as any).program_id || prog.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `program-${index}`;
    const programRef = rawId.slice(0, 60).replace(/^-+|-+$/g, ''); // Max 60 chars, trim dashes
    
    // Normalize title and brief
    const title = (prog.title || 'Untitled Program').slice(0, 60).trim();
    const brief = prog.description?.slice(0, 90).trim() || '';
    
    // Normalize price formatting
    let price = prog.price || 'See website';
    if (price && !price.startsWith('$') && /\d/.test(price)) {
      price = `$${price}`;
    }
    
    return {
      id: programRef,
      program_ref: prog.program_ref || programRef,
      title,
      description: brief || 'See website for details',
      schedule: prog.schedule?.trim() || 'See website for dates',
      age_range: prog.age_range?.trim() || 'All ages',
      skill_level: prog.skill_level?.trim() || 'All levels',
      price,
      actual_id: programRef,
      org_ref: orgRef
    };
  });
}
