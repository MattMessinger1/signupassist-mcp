/**
 * PACK-06: Real Three-Pass Extractor (Programs)
 * Streamlined AI-powered extraction using OpenAI JSON mode with strict schema validation
 */

import OpenAI from "openai";
import { MODELS } from "./oai.js";

type Models = { vision: string; extractor: string; validator: string; };

const BATCH_SIZE = 17; // Process 17 programs per batch (3 batches for 49 programs)

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
          price: { type: "string", description: "Price as displayed in the source." },
          schedule: { type: "string", description: "Schedule dates or times." },
          age_range: { type: "string", description: "Age range for participants." },
          skill_level: { type: "string", description: "Skill level requirement." },
          status: { type: "string", description: "Availability status." },
          program_ref: { type: "string", description: "Kebab-case slug reference." },
          org_ref: { type: "string", description: "Organization reference identifier." }
        },
        required: ["id", "title", "description", "price", "schedule", "age_range", "skill_level", "status", "program_ref", "org_ref"],
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
          org_ref: { type: "string", description: "Organization reference." }
        },
        required: ["title", "program_ref", "price", "schedule", "age_range", "skill_level", "status", "description", "org_ref"],
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
}) {
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
    return JSON.parse(text); // Schema mode should guarantee valid JSON
  } catch (err: any) {
    console.error("[threePassExtractor] Strict extraction failed:", err.message);
    throw err;
  }
}

export async function runThreePassExtractorForPrograms(
  page: any, 
  orgRef: string,
  opts: ExtractorConfig
) {
  console.log('[PACK-06 Extractor] Starting programs-only extraction');
  
  // Use centralized MODELS as defaults
  const models = {
    vision: opts.models?.vision || MODELS.vision,
    extractor: opts.models?.extractor || MODELS.extractor,
    validator: opts.models?.validator || MODELS.validator
  };
  
  console.log('[PACK-06 Models]', models);
  
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

  // Step 4: Wrap extraction in try-catch for graceful fallback
  try {
    // PASS 2: Extraction (batched for reliability)
    console.log('[PACK-06 Pass 2] Extracting program data with strict schema (batched)');
    
    const batches = chunkArray(snippets, BATCH_SIZE);
    console.log(`[PACK-06 Pass 2] Processing ${batches.length} batches of ${BATCH_SIZE} programs`);
    
    let allExtractedItems: any[] = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[PACK-06 Pass 2] Batch ${i + 1}/${batches.length}: Extracting ${batch.length} programs`);
      
      try {
        const extracted = await callStrictExtraction({
          model: models.extractor,
          system: `Extract SKI PROGRAM LISTINGS from HTML snippets. Each snippet is one program card/row.
Return JSON with items array. Each item needs:
- id (number from snippet index)
- title (exact text)
- description (full text or "")
- price (as shown or "")
- schedule (dates/times or "")
- age_range (ages or "")
- skill_level (level or "")
- status (availability or "")
- program_ref (kebab-case slug from title)
- org_ref (echo the orgRef)
Keep values as displayed, do not invent data.`,
          data: { orgRef, snippets: batch },
          schema: ExtractionSchema,
          maxTokens: 1500 // Smaller batch = smaller token need
        });
        
        const batchItems = extracted?.items ?? [];
        console.log(`[PACK-06 Pass 2] Batch ${i + 1}: Extracted ${batchItems.length} programs`);
        allExtractedItems = allExtractedItems.concat(batchItems);
        
      } catch (err: any) {
        console.error(`[PACK-06 Pass 2] Batch ${i + 1} failed:`, err.message);
        // Continue with other batches
      }
    }
    
    console.log(`[PACK-06 Pass 2] Total extracted: ${allExtractedItems.length} programs from ${snippets.length} snippets`);
    
    if (allExtractedItems.length === 0) {
      console.warn('[PACK-06] No items extracted from any batch, returning empty array');
      return [];
    }

    // PASS 3: Validation/Normalization (strict JSON schema mode)
    console.log('[PACK-06 Pass 3] Validating and normalizing');
    const normalized = await callStrictExtraction({
      model: models.validator,
      system: `Normalize and validate program objects:
- Ensure title exists; drop if empty
- Ensure program_ref is valid kebab-case slug
- Normalize price formats (e.g., "$175 per session" → "$175/session")
- Trim whitespace
- Ensure org_ref matches '${orgRef}'
Return validated programs array.`,
      data: { programs: allExtractedItems },
      schema: ValidationSchema,
      maxTokens: 2000
    });

    const finalPrograms = normalized?.programs || [];
    console.log(`[PACK-06 Pass 3] Final ${finalPrograms.length} validated programs`);
    
    return finalPrograms;
    
  } catch (err: any) {
    // Step 4: Graceful fallback on complete failure
    console.error('[PACK-06] Extraction failed completely:', err.message);
    console.warn('[PACK-06] Returning empty programs array as fallback');
    return []; // Don't crash the entire mandate flow
  }
}
