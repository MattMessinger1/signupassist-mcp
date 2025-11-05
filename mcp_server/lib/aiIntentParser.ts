/**
 * AI-Powered Intent Parser
 * 
 * Uses OpenAI function calling to extract structured intent from natural language.
 * Handles misspellings, variations, and informal phrasing better than regex.
 * 
 * Enhancements:
 * 1. New User Detection - Proactively identifies signals that user doesn't have an account
 * 2. Email Normalization - Handles messy email input and common typos
 * 3. Personalized Messaging - Generates contextual responses based on user signals
 */

import { callOpenAI_JSON } from "./openaiHelpers.js";
import { ParsedIntent } from "./intentParser.js";
import Logger from "../utils/logger.js";

/**
 * Extended intent with account status signals
 */
export interface ExtendedIntent extends ParsedIntent {
  isNewUser?: boolean;          // Detected "I'm new" or "don't have account" signals
  userTechLevel?: 'beginner' | 'intermediate' | 'advanced'; // User's comfort with tech
  userType?: 'first_time_parent' | 'returning_user' | 'unknown';
  rawEmail?: string;            // Raw email input before normalization
  normalizedEmail?: string;     // Normalized email (e.g., john.smith@gmail.com)
}

/**
 * AI-powered intent parser using OpenAI function calling
 * Extracts provider, category, child age, AND account status signals
 * 
 * @param message - User's natural language input
 * @returns Extended structured intent object
 * @throws Error if OpenAI API call fails
 */
export async function parseIntentWithAI(message: string): Promise<ExtendedIntent> {
  try {
    Logger.info('[AI Intent Parser] Processing message:', message);
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: `You are an intent extraction system for child activity registration.

Extract FIVE pieces of information from user messages:

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

4. NEW USER SIGNALS - Detect if user indicates they don't have an account:
   - Positive signals: "I'm new", "never signed up", "don't have login", "first time", "no account"
   - Negative signals: "I have an account", "already registered", "logged in before"
   - Return true if positive signals detected, false if negative, null if unclear

5. USER TYPE - Categorize user based on language:
   - "first_time_parent": Uses hesitant language, asks basic questions, mentions being new
   - "returning_user": Confident, mentions past registrations, knows the process
   - "unknown": Can't determine from message
   
Handle misspellings, variations, and informal phrasing gracefully.
Return JSON with exactly this structure: 
{ 
  "provider": string|null, 
  "category": string|null, 
  "childAge": number|null,
  "isNewUser": boolean|null,
  "userType": "first_time_parent"|"returning_user"|"unknown"
}`,
      user: { message },
      maxTokens: 200,
      temperature: 0.1, // Low temp for consistency
      useResponsesAPI: false, // Use Chat Completions for simpler structure
    });

    const parsed: ExtendedIntent = {
      provider: result.provider || undefined,
      category: result.category || undefined,
      childAge: result.childAge || undefined,
      hasIntent: !!(result.provider || result.category || result.childAge),
      isNewUser: result.isNewUser !== null ? result.isNewUser : undefined,
      userType: result.userType || 'unknown',
    };

    Logger.info('[AI Intent Parser] Extracted:', parsed);
    return parsed;
    
  } catch (error: any) {
    Logger.error('[AI Intent Parser] OpenAI call failed:', error.message);
    throw error; // Fallback handled by caller
  }
}

/**
 * Normalize email address using AI
 * Handles common typos and informal formats
 * 
 * @param rawEmail - Raw email input (e.g., "john dot smith at gmail")
 * @returns Normalized email (e.g., "john.smith@gmail.com")
 */
export async function normalizeEmailWithAI(rawEmail: string): Promise<string> {
  try {
    Logger.info('[Email Normalizer] Processing:', rawEmail);
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: `You are an email normalization system.

Convert informal email formats to standard format:
- "john dot smith at gmail" → "john.smith@gmail.com"
- "alice underscore jones at yahoo" → "alice_jones@yahoo.com"
- "bob-brown@gmial.com" → "bob-brown@gmail.com" (fix typo)
- "sarah(at)hotmail dot com" → "sarah@hotmail.com"

Rules:
- Fix common typos: "gmial" → "gmail", "yahooo" → "yahoo", "outloook" → "outlook"
- Convert spelled-out symbols: "at" → "@", "dot" → "."
- Remove extra spaces
- Lowercase the entire email
- If already valid, return as-is
- If unparseable, return null

Return JSON: { "email": string|null }`,
      user: { rawEmail },
      maxTokens: 50,
      temperature: 0.0, // Zero temp for deterministic normalization
      useResponsesAPI: false,
    });

    const normalized = result.email || rawEmail.toLowerCase().trim();
    Logger.info('[Email Normalizer] Result:', normalized);
    return normalized;
    
  } catch (error: any) {
    Logger.warn('[Email Normalizer] AI failed, using basic normalization:', error.message);
    // Fallback: basic normalization
    return rawEmail.toLowerCase().trim().replace(/\s+/g, '');
  }
}

/**
 * Generate personalized message based on user signals
 * 
 * @param userType - Detected user type (first_time_parent, returning_user, unknown)
 * @param context - Current conversation context (provider, step, etc.)
 * @returns Contextual message text
 */
export async function generatePersonalizedMessage(
  userType: 'first_time_parent' | 'returning_user' | 'unknown',
  context: {
    provider?: string;
    isNewUser?: boolean;
    step?: string;
  }
): Promise<string> {
  try {
    Logger.info('[Personalized Messaging] Generating for:', { userType, context });
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: `You are a friendly assistant helping parents register kids for activities.

Generate a SHORT (1-2 sentences) personalized message based on:
- User type: "${userType}"
- Context: ${JSON.stringify(context)}

Tone guidelines:
- first_time_parent: Extra reassuring, explain steps clearly, avoid jargon
- returning_user: Efficient, skip basics, get to the point
- unknown: Balanced, friendly but not condescending

Rules:
- Max 2 sentences
- 1 emoji max
- Reading level 6-8 (Flesch-Kincaid)
- No sales language
- Focus on next action

Return JSON: { "message": string }`,
      user: { userType, context: JSON.stringify(context) },
      maxTokens: 100,
      temperature: 0.3, // Some creativity but consistent
      useResponsesAPI: false,
    });

    const message = result.message || "Let's get started!";
    Logger.info('[Personalized Messaging] Generated:', message);
    return message;
    
  } catch (error: any) {
    Logger.warn('[Personalized Messaging] AI failed, using default:', error.message);
    // Fallback messages by user type
    const fallbacks = {
      first_time_parent: "No worries, I'll guide you through every step! Let's start by finding the right program.",
      returning_user: "Welcome back! Let's find what you're looking for.",
      unknown: "Let's get started! I'll help you find the perfect program."
    };
    return fallbacks[userType];
  }
}
