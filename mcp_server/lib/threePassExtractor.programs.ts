/**
 * PACK-06: Real Three-Pass Extractor (Programs)
 * Streamlined AI-powered extraction using OpenAI JSON mode with strict schema validation
 */

import OpenAI from "openai";
import { default as pLimit } from "p-limit";
import type { ElementHandle } from 'playwright-core';
import { MODELS } from "./oai.js";
import { safeJSONParse } from "./openaiHelpers.js";
import { canonicalizeSnippet, validateAndDedupePrograms } from "./extractionUtils.js";
import { sha1, getCached, setCached } from "../utils/extractionCache.js";
import { logOncePer } from "../utils/logDebouncer.js";

/**
 * TASK 3: Playwright-based pre-filtering to reduce DOM sent to OpenAI
 * Uses defensive selectors to match different HTML structures
 * Filters by schedule (day/time) and age if provided
 */
async function filterProgramCandidates(
  page: any,
  candidates: ElementHandle[],
  filters: { dayOfWeek?: string; timeOfDay?: string; childAge?: number }
): Promise<ElementHandle[]> {
  const { dayOfWeek, timeOfDay, childAge } = filters;
  
  console.log('[Pre-Filter] Filtering with:', { dayOfWeek, timeOfDay, childAge });
  
  // Defensive selectors for finding schedule/age text across different layouts
  const scheduleSelectors = [
    '.views-field-field-schedule',
    '.schedule',
    'td:has-text("AM")',
    'td:has-text("PM")',
    '[class*="schedule"]',
    'td:nth-child(2)', // Common position for schedule column
  ];
  
  const ageSelectors = [
    '.views-field-field-age',
    '.age-range',
    '[class*="age"]',
    'td:has-text("years")',
    'td:has-text("yrs")',
    'td:nth-child(3)', // Common position for age column
  ];
  
  const filtered: ElementHandle[] = [];
  
  for (const candidate of candidates) {
    try {
      const shouldInclude = await candidate.evaluate(
        (el: HTMLElement, opts: any) => {
          const { dayOfWeek, timeOfDay, childAge, scheduleSelectors, ageSelectors } = opts;
          
          // Helper: Find text using defensive selectors
          const findText = (selectors: string[]): string => {
            for (const sel of selectors) {
              try {
                const elem = el.querySelector(sel);
                if (elem?.textContent?.trim()) {
                  return elem.textContent.trim().toLowerCase();
                }
              } catch {}
            }
            // Fallback: check entire element text
            return el.textContent?.toLowerCase() || '';
          };
          
          // Get schedule and age text
          const scheduleText = findText(scheduleSelectors);
          const ageText = findText(ageSelectors);
          
          // Filter by day of week
          if (dayOfWeek && dayOfWeek !== 'any') {
            const isWeekday = dayOfWeek === 'weekday';
            const hasWeekdayIndicators = /mon|tue|wed|thu|fri|weekday/i.test(scheduleText);
            const hasWeekendIndicators = /sat|sun|weekend/i.test(scheduleText);
            
            if (isWeekday && hasWeekendIndicators && !hasWeekdayIndicators) {
              return false; // Program is weekend-only, user wants weekdays
            }
            if (!isWeekday && hasWeekdayIndicators && !hasWeekendIndicators) {
              return false; // Program is weekday-only, user wants weekends
            }
            // If ambiguous or mentions both, include it (conservative filter)
          }
          
          // Filter by time of day
          if (timeOfDay && timeOfDay !== 'any') {
            const hasMorning = /\b([6-9]|10|11)\s*(am|a\.m\.)/i.test(scheduleText) || /morning/i.test(scheduleText);
            const hasAfternoon = /\b(12|[1-5])\s*(pm|p\.m\.)/i.test(scheduleText) || /afternoon/i.test(scheduleText);
            const hasEvening = /\b([6-9]|10|11)\s*(pm|p\.m\.)/i.test(scheduleText) || /evening/i.test(scheduleText);
            
            if (timeOfDay === 'morning' && !hasMorning && (hasAfternoon || hasEvening)) {
              return false;
            }
            if (timeOfDay === 'afternoon' && !hasAfternoon && (hasMorning || hasEvening)) {
              return false;
            }
            if (timeOfDay === 'evening' && !hasEvening && (hasMorning || hasAfternoon)) {
              return false;
            }
            // If no time indicators found, include it (conservative)
          }
          
          // Filter by child age
          if (childAge) {
            // Extract age range like "6-8 years" or "Ages 5-7"
            const ageMatch = ageText.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (ageMatch) {
              const minAge = parseInt(ageMatch[1], 10);
              const maxAge = parseInt(ageMatch[2], 10);
              
              // Conservative: include if child age is within ±2 years of range
              if (childAge < minAge - 2 || childAge > maxAge + 2) {
                return false;
              }
            }
            // If no age range found, include it (conservative)
          }
          
          return true; // Include by default
        },
        { dayOfWeek, timeOfDay, childAge, scheduleSelectors, ageSelectors }
      );
      
      if (shouldInclude) {
        filtered.push(candidate);
      }
    } catch (err) {
      console.warn('[Pre-Filter] Error filtering candidate:', err);
      filtered.push(candidate); // Include on error (fail-safe)
    }
  }
  
  return filtered;
}


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
  status?: string;
  cta_href?: string;
}

type Models = { vision: string; extractor: string; validator: string; };

// Phase 2 Optimization: Raise batch ceiling from 17 → 30 for faster extraction
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '30', 10);

interface ExtractorConfig {
  models?: Models;
  scope: "program_list";
  selectors: { 
    container: string[]; 
    title: string[]; 
    price: string[]; 
    schedule: string[]; 
  };
}

// Step 3: JSON Schema definitions for strict mode
const ExtractionSchema = {
  type: "object",
  description: "Root object containing extracted program items from HTML snippets.",
  properties: {
    items: {
      type: "array",
      description: "Array of program items extracted from HTML.",
      items: {
        type: "object",
        description: "A single program item with all extracted fields.",
        properties: {
          id: { type: "number", description: "Numeric index from snippet." },
          title: { type: "string", description: "Program title or name." },
          description: { type: "string", description: "Full program description text." },
          price: { type: "string", description: "Price as displayed in the source (whitespace stripped)." },
          schedule: { type: "string", description: "Schedule dates or times." },
          age_range: { type: "string", description: "Age range for participants." },
          skill_level: { type: "string", description: "Skill level requirement." },
          status: { type: "string", description: "Availability status (Open, Register, Waitlist, Full, Closed, Sold Out, Restricted, TBD, -, or empty)." },
          program_ref: { type: "string", description: "Kebab-case slug reference (letters, digits, hyphens only)." },
          org_ref: { type: "string", description: "Organization reference identifier." },
          cta_href: { type: "string", description: "Absolute URL to register/details page if visible, else empty string." }
        },
        required: ["id", "title", "description", "price", "schedule", "age_range", "skill_level", "status", "program_ref", "org_ref", "cta_href"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
  additionalProperties: false
};

const ValidationSchema = {
  type: "object",
  description: "Root object containing validated and normalized programs.",
  properties: {
    programs: {
      type: "array",
      description: "Array of validated program objects.",
      items: {
        type: "object",
        description: "A validated program with normalized fields.",
        properties: {
          title: { type: "string", description: "Validated program title." },
          program_ref: { type: "string", description: "Valid kebab-case slug." },
          price: { type: "string", description: "Normalized price format." },
          schedule: { type: "string", description: "Schedule information." },
          age_range: { type: "string", description: "Age range for program." },
          skill_level: { type: "string", description: "Required skill level." },
          status: { type: "string", description: "Program availability." },
          description: { type: "string", description: "Program description." },
          org_ref: { type: "string", description: "Organization reference." },
          cta_href: { type: "string", description: "Absolute URL to register/details page." }
        },
        required: ["title", "program_ref", "price", "schedule", "age_range", "skill_level", "status", "description", "org_ref", "cta_href"],
        additionalProperties: false
      }
    }
  },
  required: ["programs"],
  additionalProperties: false
};

/**
 * Split array into chunks of specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Step 3: Strict JSON extraction helper
 * Uses Chat Completions API with json_schema strict mode and temperature:0
 * Note: Responses API doesn't support json_schema, only Chat Completions does
 */
async function callStrictExtraction(opts: {
  model: string;
  system: string;
  data: any;
  schema: any;
  maxTokens?: number;
  _retryCount?: number;
}) {
  const { _retryCount = 0 } = opts;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  
  try {
    // Use Chat Completions API (not Responses) for json_schema support
    const maxTokens = opts.maxTokens || 2000;
    
    // Use correct token parameter based on model
    const tokenParam = opts.model.match(/^(gpt-5|gpt-4\.1|o3|o4)/i)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
    
    const res = await openai.chat.completions.create({
      model: opts.model,
      temperature: 0, // Force deterministic
      ...tokenParam,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ProgramExtraction",
          schema: opts.schema,
          strict: true
        }
      },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: JSON.stringify(opts.data) }
      ]
    });
    
    const text = res.choices?.[0]?.message?.content || "{}";
    
    // Diagnostic logging
    console.log(`[threePassExtractor] Response length: ${text?.length || 0}`);
    console.log(`[threePassExtractor] Last 200 chars: ${text?.substring(Math.max(0, text.length - 200))}`);
    
    const parsed = safeJSONParse(text);
    
    // Retry logic for invalid JSON
    if (!parsed && _retryCount < 2) {
      logOncePer(
        `extraction-retry-${opts.model}`,
        5000,
        () => console.warn(`[threePassExtractor] Retrying extraction (attempt ${_retryCount + 2}/3)...`)
      );
      await new Promise(r => setTimeout(r, 1000));
      return callStrictExtraction({ ...opts, _retryCount: _retryCount + 1 });
    }
    
    if (!parsed) {
      console.error('[threePassExtractor] Invalid JSON response after 3 attempts:', text?.substring(0, 500));
      throw new Error('OpenAI returned invalid JSON after 3 attempts');
    }
    
    return parsed;
  } catch (err: any) {
    console.error("[threePassExtractor] Strict extraction failed:", err.message);
    throw err;
  }
}

export async function runThreePassExtractorForPrograms(
  page: any, 
  orgRef: string,
  opts: ExtractorConfig,
  category: string = "programs",
  filters?: { dayOfWeek?: string; timeOfDay?: string; childAge?: number } // TASK 3: Add filter params
) {
  console.log('[PACK-06 Extractor] Starting programs-only extraction', { filters });
  
  // Use centralized MODELS as defaults
  const models = {
    vision: opts.models?.vision || MODELS.vision,
    extractor: opts.models?.extractor || MODELS.extractor,
    validator: opts.models?.validator || MODELS.validator
  };
  
  console.log('[PACK-06 Models]', models);
  
  // PASS 1: Candidate nodes (selector-first; screenshot kept for future vision boosts)
  console.log('[PACK-06 Pass 1] Finding candidate nodes via selectors');
  
  // Quick Win #4: Use tbody selector to exclude header rows
  const containerSelector = opts.selectors.container
    .map(sel => sel.includes('table.views-table') ? 'table.views-table > tbody > tr' : sel)
    .join(',');
  
  const candidates = await page.$$(containerSelector);
  
  // TASK 3: Pre-filter candidates using Playwright before extraction
  const filteredCandidates = filters ? 
    await filterProgramCandidates(page, candidates, filters) : 
    candidates;
  
  const preFilterCount = candidates.length;
  const postFilterCount = filteredCandidates.length;
  
  if (filters && postFilterCount < preFilterCount) {
    console.log(`[PACK-06 Pre-Filter] ✂️ Reduced from ${preFilterCount} → ${postFilterCount} candidates (${Math.round((1 - postFilterCount/preFilterCount) * 100)}% reduction)`);
  }
  
  const snippets: { id: number; html: string }[] = [];
  
  for (let i = 0; i < filteredCandidates.length; i++) {
    const html = await filteredCandidates[i].evaluate((el: HTMLElement) => el.outerHTML);
    if (html?.trim()) {
      // Step 1d: Canonicalize snippet to reduce token usage before LLM extraction
      const canonicalHtml = canonicalizeSnippet(html);
      snippets.push({ id: i, html: canonicalHtml });
    }
  }
  
  console.log(`[PACK-06 Pass 1] Found ${snippets.length} candidate snippets`);
  if (!snippets.length) {
    console.warn('[PACK-06] No program containers found');
    return [];
  }

  // Phase 3: Generate cache key and check cache
  const combinedHtml = snippets.map(s => s.html).join("");
  const pageHash = sha1(combinedHtml);
  const cacheKey = `${orgRef}:${category}:${pageHash}`;
  
  console.log(`[PACK-06 Cache] Key: ${cacheKey.substring(0, 50)}...`);
  const cachedResult = await getCached(cacheKey);
  
  if (cachedResult) {
    logOncePer(
      `cache-hit-${orgRef}`,
      3000,
      () => console.log(`[PACK-06 Cache] Hit! Returning ${cachedResult.length} cached programs`)
    );
    return cachedResult;
  }
  
  console.log('[PACK-06 Cache] Miss, proceeding with extraction');

  // Step 4: Wrap extraction in try-catch for graceful fallback
  try {
    // Quick Win #6: Single-pass extraction (when GPT-5.1 is validated)
    const FEATURE_SINGLE_PASS = process.env.FEATURE_SINGLE_PASS === 'true';
    
    if (FEATURE_SINGLE_PASS && models.extractor === 'gpt-5.1') {
      console.log('[PACK-06 Single-Pass] Using combined extraction + validation (GPT-5.1)');
      const startTime = Date.now();
      
      const result = await callStrictExtraction({
        model: models.extractor,
        system: `You extract and validate REAL program listings from HTML snippets in ONE pass.

For each real program, output normalized fields:
- title: exact program name text
- description: full text or ""
- price: as displayed (strip whitespace), or ""
- schedule: dates/times as displayed, or ""
- age_range: as displayed, or ""
- skill_level: as displayed, or ""
- status: one of ["Open","Register","Waitlist","Full","Closed","Sold Out","Restricted","TBD","-"] or ""
- program_ref: kebab-case slug of title (letters/digits/hyphens)
- org_ref: provided constant
- cta_href: absolute URL to the program's register/details page if visible, else ""

Rules:
- Skip header rows, column labels, or non-program elements entirely.
- Do NOT invent values. If a field is missing, use "".
- Deduplicate by program_ref (keep first occurrence).
- Normalize status values strictly.
- Return strict JSON: {"items":[{...}, ...]} only.`,
        data: { orgRef, snippets },
        schema: ValidationSchema,
        maxTokens: 16000
      });
      
      const validated = result?.items ?? [];
      const elapsedMs = Date.now() - startTime;
      console.log(`[PACK-06 Single-Pass] Extracted ${validated.length} programs in ${elapsedMs}ms`);
      return validated;
    }
    
    // PASS 2: Extraction (batched for reliability)
    console.log('[PACK-06 Pass 2] Extracting program data with strict schema (batched)');
    
    const batches = chunkArray(snippets, BATCH_SIZE);
    console.log(`[PACK-06 Pass 2] Processing ${batches.length} batches of ${BATCH_SIZE} programs`);
    
    // Phase 3 Optimization: Increased parallelization with pLimit(5) for 3-4× speed-up
    const limit = pLimit(5); // Higher concurrency for modern models
    const startTime = Date.now();
    
    const batchPromises = batches.map((batch, i) => 
      limit(async () => {
        console.log(`[PACK-06 Pass 2] Batch ${i + 1}/${batches.length}: Extracting ${batch.length} programs`);
        
        try {
          const extracted = await callStrictExtraction({
            model: models.extractor,
            system: `You extract REAL program listings from HTML snippets. Some snippets may be headers or containers—skip those entirely.

For each real program, output fields with normalization:
- title: exact program name text
- description: full text or ""
- price: as displayed (strip whitespace), or ""
- schedule: dates/times as displayed, or ""
- age_range: as displayed, or ""
- skill_level: as displayed, or ""
- status: one of ["Open","Register","Waitlist","Full","Closed","Sold Out","Restricted","TBD","-"] or ""
- program_ref: kebab-case slug of title (letters/digits/hyphens)
- org_ref: provided constant
- cta_href: absolute URL to the program's register/details page if visible, else ""

Rules:
- If a snippet is a header row, column label (e.g., "Confirm"), or contains no program data, OUTPUT NOTHING for it.
- Do NOT invent values. If a field is not present, use "".
- Deduplicate by program_ref (keep the first).
- Return strict JSON: {"items":[{...}, ...]} only.`,
            data: { orgRef, snippets: batch },
            schema: ExtractionSchema,
            maxTokens: 8000 // Phase 2: Increased for batch size 30
          });
          
          // Phase 1 Part 4: Micro-validator to drop blanks and invalid entries
          const batchItems = (extracted?.items ?? []).filter(p => 
            p.title?.trim() && 
            !p.title.match(/Confirm|Select|Choose|Register|Sign Up|Add to Cart/i)
          );
          console.log(`[PACK-06 Pass 2] Batch ${i + 1}: Extracted ${batchItems.length} programs`);
          return batchItems;
          
        } catch (err: any) {
          console.error(`[PACK-06 Pass 2] Batch ${i + 1} failed:`, err.message);
          return []; // Return empty array on failure, continue with other batches
        }
      })
    );
    
    const allBatchResults = await Promise.all(batchPromises);
    const allExtractedItems = allBatchResults.flat();
    
    const elapsedMs = Date.now() - startTime;
    console.log(`[PACK-06 Pass 2] Total extracted: ${allExtractedItems.length} programs from ${snippets.length} snippets in ${elapsedMs}ms`);
    
    if (allExtractedItems.length === 0) {
      console.warn('[PACK-06] No items extracted from any batch, returning empty array');
      return [];
    }

    // PASS 3: Validation/Normalization (strict JSON schema mode)
    console.log('[PACK-06 Pass 3] Validating and normalizing');
    const normalized = await callStrictExtraction({
      model: models.validator,
      system: `Validate and deduplicate program objects:
- Drop programs with empty or invalid title
- Ensure program_ref is valid kebab-case slug (letters, digits, hyphens only)
- Deduplicate by program_ref (keep the first occurrence)
- Ensure org_ref matches '${orgRef}'
- Ensure all required fields exist (use "" for missing optional fields)
- Trim whitespace from all string fields
- Ensure cta_href is present (empty string if not applicable)
Return validated programs array in strict JSON format.`,
      data: { programs: allExtractedItems },
      schema: ValidationSchema,
      maxTokens: 10000 // Increased to handle all 49 programs safely
    });

    const finalPrograms = normalized?.programs || [];
    console.log(`[PACK-06 Pass 3] Final ${finalPrograms.length} validated programs`);
    
    // Step 1e: Apply final validation and deduplication
    const cleanedPrograms = validateAndDedupePrograms(finalPrograms);
    console.log(`[PACK-06 Post-validation] ${cleanedPrograms.length} programs after filtering and deduplication`);
    
    // Phase 3: Cache the cleaned results (TTL: 900s = 15 minutes)
    await setCached(cacheKey, cleanedPrograms, 900);
    
    return cleanedPrograms;
    
  } catch (err: any) {
    // Step 4: Graceful fallback on complete failure
    console.error('[PACK-06] Extraction failed completely:', err.message);
    console.warn('[PACK-06] Returning empty programs array as fallback');
    return []; // Don't crash the entire mandate flow
  }
}
