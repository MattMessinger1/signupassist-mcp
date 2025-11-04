/**
 * PACK-06: Real Three-Pass Extractor (Programs)
 * Streamlined AI-powered extraction using OpenAI JSON mode
 */

import { callOpenAI_JSON } from "./openaiHelpers.js";

type Models = { vision: string; extractor: string; validator: string; };

interface ExtractorConfig {
  models: Models;
  scope: "program_list";
  selectors: { 
    container: string[]; 
    title: string[]; 
    price: string[]; 
    schedule: string[]; 
  };
}

// OpenAI client now managed by helper

export async function runThreePassExtractorForPrograms(
  page: any, 
  orgRef: string,
  opts: ExtractorConfig
) {
  console.log('[PACK-06 Extractor] Starting programs-only extraction');
  console.log('[PACK-06 Models]', opts.models);
  
  // PASS 1: Candidate nodes (selector-first; screenshot kept for future vision boosts)
  console.log('[PACK-06 Pass 1] Finding candidate nodes via selectors');
  const candidates = await page.$$(opts.selectors.container.join(","));
  const snippets: { id: number; html: string }[] = [];
  
  for (let i = 0; i < candidates.length; i++) {
    const html = await candidates[i].evaluate((el: HTMLElement) => el.outerHTML);
    if (html?.trim()) snippets.push({ id: i, html });
  }
  
  console.log(`[PACK-06 Pass 1] Found ${snippets.length} candidate snippets`);
  if (!snippets.length) {
    console.warn('[PACK-06] No program containers found');
    return [];
  }

  // PASS 2: Extraction (strict JSON)
  console.log('[PACK-06 Pass 2] Extracting program data with AI');
  const extracted = await callOpenAI_JSON({
    model: opts.models.extractor,
    system: `You are extracting SKI PROGRAM LISTINGS from provided HTML snippets (each snippet is one row/card).
Return a JSON object { items: [...] } where each item has:
- id (from input)
- title (string)
- description (string or "")
- price (string or "")
- schedule (string or "")
- age_range (string or "")
- skill_level (string or "")
- status (string or "")
- program_ref (string; derive a stable slug from title + orgRef)
- org_ref (string; echo '${orgRef}')
Rules:
- Keep values as displayed (do not invent).
- If a field is missing, set to "".`,
    user: { orgRef, snippets },
    maxTokens: 1500
  });
  
  const extractedItems = extracted?.items ?? extracted ?? [];
  console.log(`[PACK-06 Pass 2] Extracted ${extractedItems.length} raw programs`);

  // PASS 3: Validation/Normalization
  console.log('[PACK-06 Pass 3] Validating and normalizing');
  const normalized = await callOpenAI_JSON({
    model: opts.models.validator,
    system: `Normalize and validate each program object:
- Ensure title exists; drop entries with empty title.
- Ensure program_ref is kebab-case unique slug.
- Coalesce price formats like "$175 per session" into "$175/session".
- Trim whitespace; ensure org_ref === '${orgRef}'.
Return { programs: [...] }.`,
    user: { programs: extractedItems },
    maxTokens: 800
  });

  const finalPrograms = normalized?.programs || [];
  console.log(`[PACK-06 Pass 3] Final ${finalPrograms.length} validated programs`);
  
  return finalPrograms;
}
