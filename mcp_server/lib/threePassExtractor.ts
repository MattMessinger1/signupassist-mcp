/**
 * Three-Pass Extractor for Program Discovery
 * Uses AI to extract accurate program listings from SkiClubPro pages
 */

import { Page } from 'playwright-core';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
 */
async function identifyProgramContainers(
  screenshot: Buffer,
  html: string
): Promise<Array<{ selector: string; index: number }>> {
  
  const base64Image = screenshot.toString('base64');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-5',
    messages: [
      {
        role: 'system',
        content: 'You are an expert at identifying program listing cards on web pages. Your task is to find EVERY SINGLE program card visible in the screenshot. Count them carefully - if you see 5 cards, return 5 containers. If you see 10 cards, return 10 containers. Do not skip any programs, even if they look similar. Return the exact count of program cards you observe.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Count and identify EVERY program listing card in this screenshot. Each program typically has a title, price (like $25.00 or $0.00), and a Register or Waiting List button. Look for repeating card/row patterns. Return one container entry for EACH program you see - do not combine or skip any. Be thorough and precise in your count.'
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
 */
async function extractProgramData(
  html: string,
  containers: Array<{ selector: string; index: number }>,
  orgRef: string
): Promise<Partial<ProgramData>[]> {
  
  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert at extracting structured program data from HTML. Your job is to extract the EXACT text visible on the page - do not rephrase, summarize, or invent any information. Copy program titles, prices, and details word-for-word as they appear in the HTML. If the HTML says "Nordic Kids Parent Tot Sunday", return exactly that - not "Beginner Ski Class" or any other interpretation.'
      },
      {
        role: 'user',
        content: `Extract EXACTLY ${containers.length} programs from this HTML. Return the exact program titles, prices, and details as they appear - do not paraphrase or invent programs. If you cannot find ${containers.length} programs in the HTML, return fewer rather than making up fake ones. Copy the text verbatim.\n\nHTML:\n${html.slice(0, 50000)}`
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
                  title: { type: 'string', description: 'Program title' },
                  description: { type: 'string', description: 'Program description' },
                  schedule: { type: 'string', description: 'Date and time information' },
                  age_range: { type: 'string', description: 'Age range or grade level' },
                  skill_level: { type: 'string', description: 'Skill level (beginner, intermediate, advanced)' },
                  price: { type: 'string', description: 'Price information' },
                  program_ref: { type: 'string', description: 'Program ID or reference code' }
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
 */
function validateAndNormalize(
  programs: Partial<ProgramData>[],
  orgRef: string
): ProgramData[] {
  
  return programs.map((prog, index) => {
    const programRef = prog.program_ref || prog.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `program-${index}`;
    
    return {
      id: programRef,
      program_ref: programRef,
      title: prog.title || 'Untitled Program',
      description: prog.description || 'See website for details',
      schedule: prog.schedule || 'See website for dates',
      age_range: prog.age_range || 'All ages',
      skill_level: prog.skill_level || 'All levels',
      price: prog.price || 'See website',
      actual_id: programRef,
      org_ref: orgRef
    };
  });
}
