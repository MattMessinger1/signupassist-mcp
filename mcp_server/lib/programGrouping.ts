/**
 * Program Grouping & Classification Module
 * 
 * GROUPING_PROMPT__PROGRAM_THEMES
 * 
 * Task: Given programs[] (fields from the extractor), assign each program to a single theme 
 * and output grouped lists.
 */

import OpenAI from 'openai';
import type { ProgramData } from './threePassExtractor.js';

/**
 * Program theme categories
 */
export type ProgramTheme = 
  | "Lessons & Classes"
  | "Camps & Clinics"
  | "Race Team & Events"
  | "Other";

export interface GroupedProgram {
  program_id: string;
  title: string;
  brief: string;
  age_range: string;
  schedule: string;
  season?: string;
  price: string;
  status: "open" | "waitlist" | "full" | "closed";
  cta_label: string;
  cta_href?: string;
}

export interface ProgramGroup {
  theme: ProgramTheme;
  programs: GroupedProgram[];
}

export interface GroupedProgramsResult {
  groups: ProgramGroup[];
  counts: {
    total: number;
    by_theme: Record<ProgramTheme, number>;
  };
}

/**
 * Group programs by theme using AI classification
 * 
 * Themes (choose the best fit):
 * - Lessons & Classes — lessons, classes, skills, learn‑to‑ski/ride.
 * - Camps & Clinics — camps, holiday/school‑break clinics, intensives.
 * - Race Team & Events — teams, race programs, competitions, time‑trials, events.
 * - Other — anything else (use sparingly).
 * 
 * Ranking (per theme):
 * - "open" status before "waitlist", before "full/closed";
 * - soonest upcoming schedule first (infer by dates if present);
 * - shorter title wins ties.
 * 
 * Card limit: keep max 4 programs per theme for the current screen.
 */
export async function groupProgramsByTheme(
  programs: ProgramData[],
  maxPerGroup: number = 4
): Promise<GroupedProgramsResult> {
  
  if (programs.length === 0) {
    return {
      groups: [],
      counts: {
        total: 0,
        by_theme: {
          "Lessons & Classes": 0,
          "Camps & Clinics": 0,
          "Race Team & Events": 0,
          "Other": 0
        }
      }
    };
  }

  console.log(`[ProgramGrouping] Classifying ${programs.length} programs into themes...`);
  
  // Check API key BEFORE instantiation
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = 'OPENAI_API_KEY environment variable is not set. Configure it in Railway project variables.';
    console.error(`[ProgramGrouping] ❌ ${error}`);
    throw new Error(error);
  }
  
  const openai = new OpenAI({ apiKey });
  console.log('[ProgramGrouping] Using model: gpt-5-mini-2025-08-08 (semantic grouping)');

  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini-2025-08-07',  // Reasoning capability for semantic grouping accuracy
    messages: [
      {
        role: 'system',
        content: `Task: Given programs[] (fields from the extractor), assign each program to a single theme and output grouped lists.

Themes (choose the best fit):
1. "Lessons & Classes" — lessons, classes, skills, learn‑to‑ski/ride.
2. "Camps & Clinics" — camps, holiday/school‑break clinics, intensives.
3. "Race Team & Events" — teams, race programs, competitions, time‑trials, events.
4. "Other" — anything else (use sparingly).

Ranking (per theme):
- "open" status before "waitlist", before "full/closed";
- soonest upcoming schedule first (infer by dates if present);
- shorter title wins ties.

Card limit: keep max ${maxPerGroup} programs per theme for the current screen.

Do not fabricate values. If a field is missing (e.g., price), keep it null. Keep titles and briefs parent‑friendly and concise.`
      },
      {
        role: 'user',
        content: `Classify these programs into themes and rank them:\n\n${JSON.stringify(programs, null, 2)}`
      }
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'group_programs_by_theme',
        description: 'Return programs grouped by theme with rankings',
        parameters: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  theme: {
                    type: 'string',
                    enum: ["Lessons & Classes", "Camps & Clinics", "Race Team & Events", "Other"],
                    description: 'Theme category'
                  },
                  programs: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        program_id: { type: 'string' },
                        title: { type: 'string', description: 'Max 60 chars' },
                        brief: { type: 'string', description: 'Max 90 chars' },
                        age_range: { type: 'string' },
                        schedule: { type: 'string' },
                        season: { type: 'string' },
                        price: { type: 'string' },
                        status: { 
                          type: 'string', 
                          enum: ['open', 'waitlist', 'full', 'closed'],
                          description: 'Program enrollment status'
                        },
                        cta_label: { type: 'string' },
                        cta_href: { type: 'string' }
                      },
                      required: ['program_id', 'title', 'status', 'cta_label']
                    },
                    maxItems: maxPerGroup
                  }
                },
                required: ['theme', 'programs']
              }
            }
          },
          required: ['groups']
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'group_programs_by_theme' } }
  });

  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn('[ProgramGrouping] No tool call returned, returning ungrouped programs');
    return ungroupedFallback(programs, maxPerGroup);
  }

  const result = JSON.parse(toolCall.function.arguments);
  const groups = result.groups || [];

  // Calculate counts
  const counts = {
    total: programs.length,
    by_theme: {
      "Lessons & Classes": 0,
      "Camps & Clinics": 0,
      "Race Team & Events": 0,
      "Other": 0
    } as Record<ProgramTheme, number>
  };

  groups.forEach((group: ProgramGroup) => {
    counts.by_theme[group.theme] = group.programs.length;
  });

  console.log(`[ProgramGrouping] Classified into ${groups.length} theme groups`);
  console.log(`[ProgramGrouping] Counts:`, counts.by_theme);

  return { groups, counts };
}

/**
 * Fallback grouping when AI classification fails
 */
function ungroupedFallback(
  programs: ProgramData[],
  maxPerGroup: number
): GroupedProgramsResult {
  
  const mappedPrograms: GroupedProgram[] = programs.slice(0, maxPerGroup).map(p => ({
    program_id: p.id,
    title: p.title,
    brief: p.description || '',
    age_range: p.age_range,
    schedule: p.schedule,
    price: p.price,
    status: 'open' as const,
    cta_label: 'Register',
    cta_href: undefined
  }));

  return {
    groups: [
      {
        theme: "Other",
        programs: mappedPrograms
      }
    ],
    counts: {
      total: programs.length,
      by_theme: {
        "Lessons & Classes": 0,
        "Camps & Clinics": 0,
        "Race Team & Events": 0,
        "Other": mappedPrograms.length
      }
    }
  };
}
