/**
 * AAP Discovery Planner - Converts AAP → Feed Queries
 */

import { callOpenAI_JSON } from "../lib/openaiHelpers.js";
import { AAPTriad, DiscoveryPlan } from "../types/aap.js";
import Logger from "../utils/logger.js";

const DISCOVERY_PLANNER_SYSTEM_PROMPT = `You turn the current A‑A‑P triad + user intent into a plan for which program feed to call, and how.

You receive:
- aap: the A‑A‑P triad object (from triage_aap).
- user_intent: a short description of what the parent wants to do

Your job:
- Decide which feed/endpoint to query.
- Decide how to use Age, Activity, Provider to filter or sort.
- Suggest a safe fallback if the feed is empty.
- Provide one sentence the assistant can reuse to explain the results.

DATA RULES:
- Prefer cron‑prefetched program feeds for discovery. 
- Use:
  - aap.provider.org_ref when known to target a specific provider's feed.
  - aap.activity.category when known to focus on an activity.
  - aap.age.normalized (years or range) as an age_hint when available.

- If Provider mode is "named" and org_ref is present:
  - Use org_ref to target that provider's feed
  
- If Provider mode is "local" and locationHint is present:
  - Use locationHint.lat/lng for geographic search
  - Set radiusKm from locationHint (default 25km)
  - Note the city/region in notes_for_assistant

- If Age is unknown: Do not fabricate a specific age. Avoid strict age filters; instead, prefer common youth ranges (e.g., 5–12) and rely on the UI to show age ranges clearly.
- If Provider is unknown and no location available: Do NOT invent org_ref. Plan to search across multiple providers and then filter/sort by activity and age if available.
- If Activity is unknown: Plan to show a small, diverse set of popular categories for the child's age.`;

export async function planProgramDiscovery(
  aap: AAPTriad,
  userIntent: string,
  context?: { aap?: AAPTriad; aap_discovery_plan?: DiscoveryPlan }
): Promise<DiscoveryPlan> {
  
  //----------------------------------------------------------------------
  // 🚀 FAST-PATH: Reuse cached discovery plan if AAP hasn't changed
  //----------------------------------------------------------------------
  const prevPlan = context?.aap_discovery_plan;
  const prevAAP = context?.aap;
  
  if (prevPlan && prevAAP) {
    const newAge = aap.age?.normalized?.years || null;
    const newActivity = aap.activity?.normalized?.category || null;
    const newProvider = aap.provider?.normalized?.org_ref || null;
    
    const prevAge = prevAAP.age?.normalized?.years || null;
    const prevActivity = prevAAP.activity?.normalized?.category || null;
    const prevProvider = prevAAP.provider?.normalized?.org_ref || null;
    
    // IF: AAP has not changed → reuse cache
    const sameAAP = 
      prevAge === newAge &&
      prevActivity === newActivity &&
      prevProvider === newProvider;
    
    if (sameAAP) {
      Logger.info('[AAP Discovery Planner] ✅ Cache hit - reusing plan', { prevPlan });
      return {
        ...prevPlan,
        notes_for_assistant: prevPlan.notes_for_assistant + " (cached)"
      };
    }
  }
  //----------------------------------------------------------------------
  // Otherwise: compute new plan via OpenAI
  //----------------------------------------------------------------------
  
  Logger.info('[AAP Discovery Planner] Input:', { aap, userIntent });

  try {
    const result = await callOpenAI_JSON({
      model: "gpt-4o-mini",
      system: DISCOVERY_PLANNER_SYSTEM_PROMPT,
      user: { aap, user_intent: userIntent },
      maxTokens: 300,
      temperature: 0.1,
      useResponsesAPI: false
    });

    Logger.info('[AAP Discovery Planner] Result:', result);
    return result as DiscoveryPlan;

  } catch (error) {
    Logger.error('[AAP Discovery Planner] Error:', error);
    
    // Fallback: broad discovery
    const fallback: DiscoveryPlan = {
      feed_query: {
        org_ref: aap.provider?.normalized?.org_ref || null,
        category: aap.activity?.normalized?.category || null,
        age_hint: {
          years: aap.age?.normalized?.years || null,
          range: aap.age?.normalized?.range || null
        }
      },
      fallback_strategy: "Show a diverse set of popular programs for all ages if no matches found.",
      notes_for_assistant: "I'm showing programs based on what you've shared so far."
    };
    
    // Add location if available
    if (aap.provider?.locationHint?.lat && aap.provider?.locationHint?.lng) {
      fallback.feed_query.location = {
        lat: aap.provider.locationHint.lat,
        lng: aap.provider.locationHint.lng,
        radiusKm: aap.provider.locationHint.radiusKm || 25
      };
    }
    
    return fallback;
  }
}
