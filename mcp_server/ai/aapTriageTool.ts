/**
 * AAP Triage Tool - OpenAI Function Call
 * Extracts and merges Age-Activity-Provider without losing context
 */

import { callOpenAI_JSON } from "../lib/openaiHelpers.js";
import { AAPTriageResult, AAPAskedFlags, AAPTriad, createEmptyAAP } from "../types/aap.js";
import Logger from "../utils/logger.js";

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
- Map to a simple category if possible: "skiing", "swimming", "soccer", "music".

PROVIDER (including local search)
- Provider can be a specific organization OR a local search area.
- Look for provider names: "Blackhawk ski", "YMCA", "Alpine Ridge Ski School", etc.
- If the orchestrator gives you an org_ref mapping, set mode = "named".
- If request_hints.location is provided and no specific provider is mentioned:
  - Set mode = "local"
  - Include locationHint in the provider field
  - Do NOT ask "Which organization?" as a blocking question
  - Instead, mark provider.status = "unknown" but note the location is available
- If both location AND a named provider exist, prefer the named provider (mode = "named")

FOLLOW‑UP QUESTIONS:
A field is "missing" if its status is "unknown".

- For each missing field (Age, Activity, Provider):
  - If asked_flags for that field is false: You MAY propose ONE follow‑up question for that field.
  - If asked_flags for that field is true: Do NOT propose another question; assume the parent was unable or unwilling to answer.

- Questions must be short, parent‑friendly, and target one field at a time:
  - Age: "How old is your child, or what grade are they in?"
  - Activity: "What kind of activity are you looking for (for example: ski lessons, swim, or music)?"
  - Provider: "Do you already have a specific provider in mind, or should I show you a few options first?"

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
    "age": { "status": "known"|"unknown", "raw": "...", "normalized": "...", "source": "explicit"|"implicit"|"profile"|"assumed" },
    "activity": { "status": "known"|"unknown", "raw": "...", "normalized": "...", "source": "..." },
    "provider": { "status": "known"|"unknown", "raw": "...", "normalized": "...", "source": "...", "mode": "named"|"local", "locationHint": {...} }
  },
  "followup_questions": ["question1", "question2"],
  "assumptions": ["assumption1", "assumption2"],
  "ready_for_discovery": true|false
}`;

export async function triageAAP(
  recentMessages: Array<{ role: string; content: string }>,
  existingAAP: AAPTriad | null,
  requestHints: { 
    category?: string; 
    childAge?: number; 
    provider?: string;
    location?: any;  // NEW: LocationHint from ipAPI
  },
  askedFlags: AAPAskedFlags
): Promise<AAPTriageResult> {
  
  Logger.info('[AAP Triage] Input:', { 
    messageCount: recentMessages.length,
    existingAAP,
    requestHints,
    askedFlags,
    hasLocation: !!requestHints.location
  });

  try {
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: TRIAGE_AAP_SYSTEM_PROMPT,
      user: {
        recent_messages: recentMessages,
        existing_aap: existingAAP,
        request_hints: requestHints,
        asked_flags: askedFlags,
        available_location: requestHints.location ? {
          city: requestHints.location.city,
          region: requestHints.location.region,
          source: requestHints.location.source
        } : null
      },
      maxTokens: 500,
      temperature: 0.1,
      useResponsesAPI: false
    });

    // Preserve location hint if it exists and provider mode is local
    if (requestHints.location && result.aap?.provider?.mode === 'local') {
      result.aap.provider.locationHint = requestHints.location;
    }

    Logger.info('[AAP Triage] Result:', result);
    return result as AAPTriageResult;

  } catch (error) {
    Logger.error('[AAP Triage] Error:', error);
    
    // Fallback: preserve existing AAP, ask for everything missing
    return {
      aap: existingAAP || createEmptyAAP(),
      followup_questions: buildFallbackQuestions(existingAAP, askedFlags),
      assumptions: ['AI triage failed, using safe defaults'],
      ready_for_discovery: false
    };
  }
}


function buildFallbackQuestions(aap: AAPTriad | null, asked: AAPAskedFlags): string[] {
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
  return questions;
}
