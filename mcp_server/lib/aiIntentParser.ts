/**
 * AI-Powered Intent Parser
 * 
 * Uses OpenAI function calling to extract structured intent from natural language.
 * Handles misspellings, variations, and informal phrasing better than regex.
 */

import { callOpenAI_JSON } from "./openaiHelpers.js";
import { ParsedIntent } from "./intentParser.js";
import Logger from "../utils/logger.js";

/**
 * AI-powered intent parser using OpenAI function calling
 * Extracts provider, category, and child age from natural language
 * 
 * @param message - User's natural language input
 * @returns Structured intent object
 * @throws Error if OpenAI API call fails
 */
export async function parseIntentWithAI(message: string): Promise<ParsedIntent> {
  try {
    Logger.info('[AI Intent Parser] Processing message:', message);
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: `You are an intent extraction system for child activity registration.

Extract THREE pieces of information from user messages:

1. PROVIDER - Organization or club name:
   - "blackhawk" or "black hawk" → "blackhawk-ski-club"
   - "vail" or "vail resort" → "vail"
   - "ski club" (generic) → "ski-club"
   - "nordic" or "nordic ski" without other context → null (it's an activity type, not a provider)
   - Return null if not mentioned

2. CATEGORY - Activity type:
   - "lessons", "lesson", "ski", "skiing", "class" → "lessons"
   - "camps", "camp", "day camp" → "camps"
   - "race", "races", "race team", "racing", "team" → "races"
   - "nordic", "nordic ski", "nordic skiing" → "lessons" (nordic is a lesson type)
   - Return null if not mentioned

3. CHILD AGE - Numeric age (3-18):
   - Extract any number in the context of a child/kid
   - Examples: "9", "9 year old", "my 9yo", "age 9", ", 9" (trailing comma)
   - Handle standalone numbers after activity mentions: "nordic ski, 9" → age is 9
   - Return null if not mentioned

Handle misspellings, variations, and informal phrasing gracefully.
Return JSON with exactly this structure: { "provider": string|null, "category": string|null, "childAge": number|null }`,
      user: { message },
      maxTokens: 150,
      temperature: 0.1, // Low temp for consistency
      useResponsesAPI: false, // Use Chat Completions for simpler structure
    });

    const parsed: ParsedIntent = {
      provider: result.provider || undefined,
      category: result.category || undefined,
      childAge: result.childAge || undefined,
      hasIntent: !!(result.provider || result.category || result.childAge)
    };

    Logger.info('[AI Intent Parser] Extracted:', parsed);
    return parsed;
    
  } catch (error: any) {
    Logger.error('[AI Intent Parser] OpenAI call failed:', error.message);
    throw error; // Fallback handled by caller
  }
}
