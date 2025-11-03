/**
 * PACK-06: Real Three-Pass Extractor (Programs)
 * Streamlined AI-powered extraction using OpenAI JSON mode
 */

import OpenAI from "openai";

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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
  const extracted = await callOpenAI_JSON(opts.models.extractor, {
    role: "You extract SKI PROGRAM LISTINGS from HTML snippets (each snippet = one row/card). " +
          "Return { items: [{ id, title, description, price, schedule, age_range, skill_level, status, " +
          "program_ref (kebab slug from title + org), org_ref }] }. " +
          "Never invent; blank if missing.",
    input: { orgRef, snippets }
  });
  
  console.log(`[PACK-06 Pass 2] Extracted ${extracted?.items?.length || 0} raw programs`);

  // PASS 3: Validation/Normalization
  console.log('[PACK-06 Pass 3] Validating and normalizing');
  const normalized = await callOpenAI_JSON(opts.models.validator, {
    role: "Normalize and validate. Output { programs:[...] }. " +
          `Rules: ensure title exists; drop empties; program_ref unique kebab-case; org_ref === "${orgRef}";` +
          ' normalize price like "$175 per session" -> "$175/session"; trim whitespace.',
    input: extracted
  });

  const finalPrograms = normalized?.programs || normalized?.items || [];
  console.log(`[PACK-06 Pass 3] Final ${finalPrograms.length} validated programs`);
  
  return finalPrograms;
}

async function callOpenAI_JSON(model: string, payload: { role: string; input: any }) {
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: payload.role },
      { role: "user", content: JSON.stringify(payload.input) }
    ]
  });
  const content = res.choices?.[0]?.message?.content ?? "{}";
  try { 
    return JSON.parse(content); 
  } catch (err) {
    console.error('[PACK-06] JSON parse error:', err);
    return {};
  }
}
