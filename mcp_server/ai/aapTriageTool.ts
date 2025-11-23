/**
 * AAP Triage Tool - OpenAI Function Call
 * Extracts and merges Age-Activity-Provider without losing context
 */

import { callOpenAI_JSON } from "../lib/openaiHelpers.js";

// Simple in-memory triage cache to skip redundant OpenAI calls
const triageCache = new Map<string, any>();
import { AAPTriageResult, AAPAskedFlags, AAPTriad, createEmptyAAP, createAAPAge, createAAPActivity, createAAPProvider } from "../types/aap.js";
import { parseAAPTriad as legacyParseAAPTriad, AAPTriad as LegacyAAPTriad } from "./preLoginNarrowing.js";
import Logger from "../utils/logger.js";
import { detectNewProvider } from "./aap/detectNewProvider.js";

const TRIAGE_AAP_SYSTEM_PROMPT = `You maintain the A‑A‑P triad (Age, Activity, Provider) for the current signup flow.

You receive:
- recent_messages: the conversation history (up to 10 recent messages) as an array.
- existing_aap: the current A‑A‑P triad object from session (may be partial).
- request_hints: optional hints from the frontend (category, childAge, provider).
- asked_flags: which A‑A‑P follow‑up questions have already been asked in this flow

Your job:
1) SCAN ALL MESSAGES in recent_messages, not just the last one. Check the entire conversation for Age, Activity, and Provider mentions.
2) Merge new information into existing_aap without losing anything.
3) Decide which (if any) A‑A‑P follow‑up questions are still needed.
4) Decide if we're ready to start showing programs (ready_for_discovery).

MERGE RULES:
- Treat existing_aap as the baseline; it came from earlier turns or profile.
- NEVER clear a field whose status is "known".
- You may refine it if the new info is strictly more specific (e.g., "elementary school" → 9 years).
- Use request_hints as additional evidence for A‑A‑P fields (age, activity, provider).

Infer:

AGE
- Look for explicit ages: "9", "she's 9", "9 years old".
- Look for grades: "2nd grade", "3rd grader", "kindergartener".
- Map grades to approximate years when helpful, and record either years or a range.
- If multiple kids are mentioned, focus on the one clearly tied to this signup request.

ACTIVITY
- Look for what they want to sign up for: "ski lessons", "after‑school care", "swim team", "soccer clinic".
- Map to a simple category if possible: "skiing", "swimming", "soccer", "music", "tennis".

PROVIDER (ChatGPT-specific)
- Extract organization name if mentioned:
  * "ABC Swim School" → provider.search_query = "ABC Swim School"
  * "XYZ Music" → provider.search_query = "XYZ Music"
  * "Blackhawk Ski" → provider.search_query = "Blackhawk Ski"
- If you can map to a known org_ref, set normalized.org_ref and mode = "named"
- If you cannot confidently map, set normalized = null and mode = "local"

LOCATION EXTRACTION (ChatGPT-specific):
- User MUST explicitly mention city in their message
- Examples:
  * "Swimming in Madison" → location_hint.city = "Madison"
  * "ABC School in Milwaukee" → location_hint.city = "Milwaukee"
  * "Tennis near Waukesha" → location_hint.city = "Waukesha"
- If NO city mentioned → location_hint.city = null
- Set location_hint.source = "user_explicit" when city is provided by user

IMPORTANT: For provider.normalized, you MUST return an object with this structure:
{
  "org_ref": "org-slug" | null,
  "backend": "bookeo" | "skiclubpro" | "campminder" | null,
  "display_name": "Organization Name" | null
}

Example mappings:
- "Blackhawk" → { org_ref: "blackhawk-ski-club", backend: "skiclubpro", display_name: "Blackhawk Ski Club" }
- "Bookeo" or "AIM Design" → { org_ref: "aim-design", backend: "bookeo", display_name: "AIM Design" }
- Unknown provider → { org_ref: null, backend: null, display_name: null }

FOLLOW‑UP QUESTIONS:
A field is "missing" if its status is "unknown".

- For each missing field (Age, Activity, Provider, Location):
  - If asked_flags for that field is false: You MAY propose ONE follow‑up question for that field.
  - If asked_flags for that field is true: Do NOT propose another question; assume the parent was unable or unwilling to answer.

- Questions must be short, parent‑friendly, and target one field at a time:
  - Age: "How old is your child, or what grade are they in?"
  - Activity: "What kind of activity are you looking for (for example: swim, ski, music, tennis)?"
  - Provider: "Do you have a specific organization in mind, or should I show you options?"
  - Location: "Which city are you in? (e.g., Madison, Milwaukee, Waukesha)"

- If the message shows the parent is unsure ("not sure", "no idea yet"):
  - Do NOT propose another question for that field.
  - Leave status = "unknown" and note the uncertainty in assumptions.

READY FOR DISCOVERY:
Set ready_for_discovery as:
- true if: Age is known OR clearly bounded by a reasonable range (e.g., "elementary school"), AND Activity OR Provider is known.
- false otherwise.

OUTPUT FORMAT:
Return your response as a JSON object with this exact structure:
{
  "aap": {
    "age": { 
      "status": "known"|"unknown", 
      "raw": "...", 
      "normalized": { "years": 10, "grade_band": "elementary", "range": [8, 12] } | null,
      "source": "explicit"|"implicit"|"profile"|"assumed" 
    },
    "activity": { 
      "status": "known"|"unknown", 
      "raw": "...", 
      "normalized": { "category": "swimming" } | null,
      "source": "..." 
    },
    "provider": { 
      "status": "known"|"unknown", 
      "raw": "...", 
      "normalized": { "org_ref": "bookeo-default", "backend": "bookeo", "display_name": "Bookeo Demo Classes" } | null,
      "search_query": "ABC Swim School" | null,
      "location_hint": { "city": "Madison", "source": "user_explicit" } | null,
      "source": "...", 
      "mode": "named"|"local"
    }
  },
  "followup_questions": ["question1", "question2"],
  "assumptions": ["assumption1", "assumption2"],
  "ready_for_discovery": true|false
}

CRITICAL: The "normalized" field MUST be an object with the exact structure shown above, NOT a string.`;

export async function triageAAP(
  recentMessages: Array<{ role: string; content: string }>,
  existingAAP: AAPTriad | null,
  requestHints: { 
    category?: string; 
    childAge?: number; 
    provider?: string;
    location?: any;  // NEW: LocationHint from ipAPI
  },
  askedFlags: AAPAskedFlags,
  rawUserMessage?: string  // NEW: Raw user message for provider detection
): Promise<AAPTriageResult> {
  
  Logger.info('[AAP Triage] Input:', { 
    messageCount: recentMessages.length,
    existingAAP,
    requestHints,
    askedFlags,
    hasLocation: !!requestHints.location,
    hasRawUserMessage: !!rawUserMessage
  });

  // Get the most recent user message for provider change detection
  // Prefer rawUserMessage (current turn) over history
  const lastUserMessage = rawUserMessage || recentMessages.filter(m => m.role === 'user').pop()?.content || '';

  // Detect provider switch
  const existingProviderRaw = existingAAP?.provider?.raw || null;
  const providerSwitch = detectNewProvider(lastUserMessage, existingProviderRaw);

  // Create mutable copy of inputs for modification
  let updatedAAP = existingAAP;
  let updatedAskedFlags = { ...askedFlags };
  let updatedRequestHints = { ...requestHints };

  // If provider switch detected, reset provider and related state
  if (providerSwitch) {
    Logger.info('[AAP Triage] Provider switch detected, resetting provider state', {
      oldProvider: existingProviderRaw,
      userMessage: lastUserMessage
    });
    
    // Reset provider
    updatedAAP = {
      ...existingAAP,
      provider: createAAPProvider()
    } as AAPTriad;
    
    // Reset provider-related asked flags
    updatedAskedFlags.asked_provider = false;
    updatedAskedFlags.asked_activity = false; // Allow re-triage of activity
    // Keep age if known (updatedAskedFlags.asked_age remains as is)
    
    // Clear location hint to avoid stale data
    updatedRequestHints.location = null;
  }

  //----------------------------------------------------------------------
  // 🚀 FAST-PATH: Skip triage if AAP is already complete and user added no new info.
  //----------------------------------------------------------------------
  
  // Consider short or empty messages as "no new info"
  const noNewInfo =
    !lastUserMessage.trim() ||
    lastUserMessage.trim().length < 3 ||        // often just "ok", "yes", "9" etc.
    /^[\d\s]+$/.test(lastUserMessage.trim());   // pure numbers = child age answer

  const aapComplete =
    updatedAAP &&
    updatedAAP.age?.status === "known" &&
    updatedAAP.activity?.status === "known" &&
    updatedAAP.provider?.status === "known";

  // Skip expensive OpenAI call if we already have everything and user said nothing new
  if (aapComplete && noNewInfo && !providerSwitch) {
    Logger.info('[AAP Triage] Fast-path: AAP complete with trivial input, skipping OpenAI call');
    return {
      aap: updatedAAP,
      followup_questions: [],
      assumptions: [],
      ready_for_discovery: true
    };
  }
  // END FAST-PATH
  //----------------------------------------------------------------------

  // Check if location is unreliable (ChatGPT DC IPs)
  const isLocationUnreliable = updatedRequestHints.location && (
    updatedRequestHints.location.city === 'Ashburn' ||
    updatedRequestHints.location.region === 'Virginia' ||
    (updatedRequestHints.location.source === 'ipapi' && updatedRequestHints.location.mock === true)
  );

  // Treat unreliable location as no location for triage purposes
  const reliableLocation = isLocationUnreliable ? null : updatedRequestHints.location;

  try {
    // Check triage cache first to skip redundant OpenAI calls (~300-900ms savings)
    const cacheKey = JSON.stringify({
      lastUserMsg: lastUserMessage,
      existingAAP: updatedAAP,
      requestHints: updatedRequestHints,
      askedFlags: updatedAskedFlags
    });
    
    if (triageCache.has(cacheKey)) {
      Logger.info('[AAP Triage] Cache hit');
      return triageCache.get(cacheKey);
    }
    
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: TRIAGE_AAP_SYSTEM_PROMPT,
      user: {
        recent_messages: recentMessages,
        existing_aap: updatedAAP,
        request_hints: { ...updatedRequestHints, location: reliableLocation },
        asked_flags: updatedAskedFlags,
        available_location: reliableLocation ? {
          city: reliableLocation.city,
          region: reliableLocation.region,
          source: reliableLocation.source
        } : null
      },
      maxTokens: 500,
      temperature: 0.1,
      useResponsesAPI: false
    });

    // Preserve location hint if it exists and provider mode is local
    if (reliableLocation && result.aap?.provider?.mode === 'local') {
      result.aap.provider.locationHint = reliableLocation;
    }
    
    // If provider was reset and is still unknown, ask for it once
    if (providerSwitch && result.aap?.provider?.status === 'unknown' && !updatedAskedFlags.asked_provider) {
      if (!result.followup_questions.includes("Which organization or program should I look at?")) {
        result.followup_questions.push("Which organization or program should I look at?");
      }
      updatedAskedFlags.asked_provider = true;
    }
    
    // Store in cache for next time
    triageCache.set(cacheKey, result);

    Logger.info('[AAP Triage] Result:', result);
    return result as AAPTriageResult;

  } catch (error) {
    Logger.error('[AAP Triage] Error:', error);
    
    // OpenAI triage failed – preserve existing context and parse user message for hints
    // Start with existing AAP or create empty one
    const fallbackAAP: AAPTriad = existingAAP ? {
      age: { ...existingAAP.age },
      activity: { ...existingAAP.activity },
      provider: { ...existingAAP.provider },
    } : {
      age: createAAPAge(),
      activity: createAAPActivity(),
      provider: createAAPProvider(),
    };
    
    // Use legacy parser to extract any AAP fields from the latest user message
    const lastUserMsg = recentMessages.filter(m => m.role === 'user').pop()?.content || '';
    const parsedHints: LegacyAAPTriad = legacyParseAAPTriad(lastUserMsg);
    
    // Fill in parsed values if fallbackAAP field is still unknown (user-provided takes priority)
    if (parsedHints.age && fallbackAAP.age.status === 'unknown') {
      fallbackAAP.age = createAAPAge({
        status: 'known',
        raw: parsedHints.age.toString(),
        normalized: { years: parsedHints.age, grade_band: null, range: null },
        source: 'explicit'
      });
    }
    
    if (parsedHints.activity && fallbackAAP.activity.status === 'unknown') {
      fallbackAAP.activity = createAAPActivity({
        status: 'known',
        raw: parsedHints.activity,
        normalized: { category: parsedHints.activity },
        source: 'explicit'
      });
    }
    
    if (parsedHints.provider && fallbackAAP.provider.status === 'unknown') {
      fallbackAAP.provider = createAAPProvider({
        status: 'known',
        raw: parsedHints.provider,
        normalized: null, // Can't map to org_ref in fallback
        source: 'explicit',
        mode: 'named'
      });
    }
    
    // Fill in any remaining unknown fields from legacy profile hints (never overwrite known)
    // Bridge legacy childAge only if AAP age is still unknown
    if (
      fallbackAAP.age.status === 'unknown' &&
      typeof requestHints.childAge === 'number'
    ) {
      fallbackAAP.age = createAAPAge({
        status: 'known',
        raw: requestHints.childAge.toString(),
        normalized: { years: requestHints.childAge, grade_band: null, range: null },
        source: 'profile',
      });
    }
    
    // Bridge legacy category only if AAP activity is unknown
    if (
      fallbackAAP.activity.status === 'unknown' &&
      typeof requestHints.category === 'string'
    ) {
      fallbackAAP.activity = createAAPActivity({
        status: 'known',
        raw: requestHints.category,
        normalized: { category: requestHints.category },
        source: 'profile',
      });
    }
    
    // Bridge legacy provider only if AAP provider is unknown
    if (
      fallbackAAP.provider.status === 'unknown' &&
      typeof requestHints.provider === 'string'
    ) {
      fallbackAAP.provider = createAAPProvider({
        status: 'known',
        raw: requestHints.provider,
        normalized: { 
          org_ref: requestHints.provider,
          backend: null,
          display_name: null
        },
        source: 'profile',
        mode: 'named',
      });
    }
    
    // Preserve location hint if available and provider is local mode
    if (reliableLocation && fallbackAAP.provider.mode === 'local') {
      fallbackAAP.provider.locationHint = reliableLocation;
    }
    
    return {
      aap: fallbackAAP,
      followup_questions: buildFallbackQuestions(fallbackAAP, askedFlags, !reliableLocation && !existingAAP?.provider?.locationHint),
      assumptions: ['AI triage failed, preserved user-provided values and filled defaults for missing fields'],
      ready_for_discovery: false,
    };
  }
}


function buildFallbackQuestions(
  aap: AAPTriad | null, 
  asked: AAPAskedFlags,
  needsLocation: boolean = false
): string[] {
  const questions: string[] = [];
  
  if ((!aap?.age || aap.age.status === 'unknown') && !asked.asked_age) {
    questions.push("How old is your child, or what grade are they in?");
  }
  
  if ((!aap?.activity || aap.activity.status === 'unknown') && !asked.asked_activity) {
    questions.push("What kind of activity are you looking for (for example: ski lessons, swim, or music)?");
  }
  
  if ((!aap?.provider || aap.provider.status === 'unknown') && !asked.asked_provider) {
    questions.push("Do you already have a specific provider in mind, or should I show you a few options first?");
  }
  
  // Ask for location only if provider is unknown AND location is unreliable/missing
  if ((!aap?.provider || aap.provider.status === 'unknown') && needsLocation && !asked.asked_location) {
    questions.push("What city should I look in?");
  }
  
  return questions;
}
