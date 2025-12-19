/**
 * Assistant Message Templates for SignupAssist
 * 
 * Pre-defined, parent-friendly messages for different flow stages
 * following Design DNA: warm, concise, security-transparent
 */

export interface MessageVariables {
  provider_name?: string;
  counts?: {
    total: number;
    by_theme?: Record<string, number>;
  };
  child_name?: string;
  program_name?: string;
  error_details?: string;
}

/**
 * ASSISTANT__POST_LOGIN_STATUS
 * 
 * Used immediately after successful login to reassure parent and 
 * explain what's happening next
 */
export function getPostLoginMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `🎿 You're securely logged in to ${providerName}. I'm pulling the latest programs now and sorting them by theme (lessons, camps, teams) so it's easy to browse. This uses your active session with the club—no extra logins needed. ⏳

(Your personal info stays private with ${providerName}; SignupAssist never stores card numbers.)`;
}

/**
 * ASSISTANT__LOADING_STATUS
 * 
 * Optional heartbeat message during program extraction
 * (can be sent as a progress update if extraction takes >3 seconds)
 */
export function getLoadingMessage(): string {
  return `⏳ Grabbing the class list from the registration page and organizing it for you… one moment!`;
}

/**
 * ASSISTANT__PROGRAMS_READY
 * 
 * Message that precedes the grouped program cards
 */
export function getProgramsReadyMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  const total = vars.counts?.total || 0;
  
  return `✅ I found ${total} program${total !== 1 ? 's' : ''} at ${providerName}. I've grouped a few to get you started—tap any card to explore or enroll. If you'd like a different category, just say the word.`;
}

/**
 * ASSISTANT__NO_PROGRAMS_FALLBACK (Block 9)
 * 
 * Fallback when no programs are discovered
 */
export function getNoProgramsMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `I couldn't find open programs at ${providerName} right now. That usually means signups haven't opened yet or everything's full.

• Want me to check a different category or nearby club?
• I can also keep an eye out and let you know when new sessions appear.

(Your login is still active—we won't ask you to re‑enter it.)`;
}

/**
 * ASSISTANT__ERROR_RECOVERY
 * 
 * Error message following Design DNA (polite, actionable, "let's fix it together")
 */
export function getErrorRecoveryMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `Oops, I ran into a snag connecting to ${providerName}. Let's try again—sometimes these pages need a moment to load. Ready to retry?`;
}

/**
 * ASSISTANT__SESSION_EXPIRED (Block 10)
 * 
 * Message when session token is invalid/expired - gentle recovery
 */
export function getSessionExpiredMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `Hmm, it looks like your provider login expired. Let's reconnect securely and I'll fetch the programs again. 🔐

(You'll sign in directly with ${providerName}; we don't store your password.)`;
}

/**
 * ASSISTANT__POST_LOGIN_STATUS_V2
 * 
 * Updated post-login message (more concise, auto-discovery announcement)
 */
export function getPostLoginMessageV2(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  return `🎿 Great news — you're securely logged in to ${providerName}!
I'll now take you straight to your programs page and pull everything that's open for registration. ⏳
(No need to log in again — your secure session is still active.)`;
}

/**
 * ASSISTANT__PROGRAMS_READY_V2
 * 
 * Updated programs-ready message
 */
export function getProgramsReadyMessageV2(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  const total = vars.counts?.total || 0;
  return `✅ I found ${total} program${total !== 1 ? 's' : ''} at ${providerName}.
They're grouped by theme so you can scan easily — Lessons, Camps, Race Team, and more.
(Your session remains active for a few minutes, so you can explore freely.)`;
}

/**
 * ASSISTANT__PROGRAM_DISCOVERY_ERROR
 * 
 * Error message for discovery failures
 */
export function getProgramDiscoveryErrorMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  return `Hmm — I couldn't reach the program listings on ${providerName} just now.
It looks like the page took too long to load. Let's try again in a few seconds ⏳.
(You're still logged in; I'll reuse your session.)`;
}

/**
 * ASSISTANT__CONFIRMATION_NEEDED
 * 
 * Pre-action confirmation request (before enrollment/payment)
 */
export function getConfirmationMessage(vars: MessageVariables): string {
  const childName = vars.child_name || "your child";
  const programName = vars.program_name || "this program";
  
  return `Before I proceed, let me confirm: I'll enroll ${childName} in ${programName}. Does everything look correct? (Reply "Yes" to continue or let me know what needs to change.)`;
}

/**
 * ASSISTANT__ACK_SELECTION (Block 12)
 * 
 * Post‑selection acknowledgement (after user taps a card)
 */
export function getSelectionAckMessage(vars: MessageVariables): string {
  const programTitle = vars.program_name || "this program";
  
  return `Great choice! I'll pull the registration details for "${programTitle}." If anything's required before sign‑up (like membership or a waiver), I'll let you know and help you through it. 🙌

(We'll confirm everything before submitting anything.)`;
}

/**
 * ASSISTANT__MANDATE_RECOVERY
 * 
 * Shown when mandate verification fails and user needs to reconnect
 */
export function getMandateRecoveryMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `🔐 I wasn't able to verify your secure connection with ${providerName} just now. Let's reconnect safely — I'll generate a fresh authorization and keep your data protected.`;
}

// ============================================================================
// LOCATION & COVERAGE MESSAGES
// ============================================================================

export interface LocationMessageVars extends MessageVariables {
  detected_city?: string;
  detected_state?: string;
  coverage_area?: string;
  show_waitlist?: boolean;
  ambiguous_options?: Array<{ city: string; state: string; description: string }>;
}

/**
 * ASSISTANT__OUT_OF_COVERAGE
 * 
 * Message when user's location is outside our service area
 */
export function getOutOfCoverageMessage(vars: LocationMessageVars): string {
  const cityDisplay = vars.detected_city 
    ? `${vars.detected_city}, ${vars.detected_state || ''}`.trim()
    : vars.detected_state || 'your area';
  const coverageArea = vars.coverage_area || 'the Madison, Wisconsin area';
  
  let message = `I don't have providers in **${cityDisplay}** yet — SignupAssist is currently live in **${coverageArea}**.`;
  
  if (vars.show_waitlist) {
    message += `\n\n🔔 Would you like me to notify you when we expand to ${vars.detected_city || 'your area'}? I can add you to our notification list!`;
  }
  
  return message;
}

/**
 * ASSISTANT__AMBIGUOUS_CITY
 * 
 * Message when user mentions a city that exists in multiple states
 */
export function getAmbiguousCityMessage(vars: LocationMessageVars): string {
  const cityName = vars.detected_city || 'that city';
  const options = vars.ambiguous_options || [];
  
  let message = `There are a few places called **${cityName}**! Which one are you in?\n`;
  
  options.slice(0, 4).forEach(opt => {
    message += `\n• ${opt.description}`;
  });
  
  return message;
}

/**
 * ASSISTANT__COMING_SOON
 * 
 * Message when user's location is in a planned expansion area
 */
export function getComingSoonMessage(vars: LocationMessageVars): string {
  const cityDisplay = vars.detected_city 
    ? `${vars.detected_city}, ${vars.detected_state || ''}`.trim()
    : 'your area';
  
  return `Great news! SignupAssist is coming to **${cityDisplay}** soon! Would you like me to notify you when we launch there? I'll add you to our early access list. 🚀`;
}

/**
 * ASSISTANT__IN_COVERAGE
 * 
 * Positive confirmation when user is in a covered area
 */
export function getInCoverageMessage(vars: LocationMessageVars): string {
  const cityDisplay = vars.detected_city 
    ? `${vars.detected_city}, ${vars.detected_state || ''}`.trim()
    : 'your area';
  
  return `I can help with that in **${cityDisplay}**! Let me find what's available for you...`;
}

/**
 * ASSISTANT__NO_PROVIDER_MATCH
 * 
 * Message when we couldn't find the provider they're looking for
 */
export function getNoProviderMatchMessage(vars: MessageVariables & { search_query?: string; coverage_area?: string }): string {
  const query = vars.search_query || 'that organization';
  const coverageArea = vars.coverage_area || 'the Madison, Wisconsin area';
  
  return `I couldn't find any providers matching "${query}".\n\nWe currently support organizations in **${coverageArea}**.\n\nTry searching by city (e.g., "swim lessons in Madison") or tell me what activity you're looking for and I can show you what's available!`;
}

/**
 * Helper to select the appropriate message based on flow state
 */
export function getMessageForState(
  state: "post_login" | "post_login_v2" | "loading" | "programs_ready" | "programs_ready_v2" | "no_programs" | "error" | "program_discovery_error" | "session_expired" | "confirmation" | "selection_ack" | "mandate_recovery" | "out_of_coverage" | "ambiguous_city" | "coming_soon" | "in_coverage" | "no_provider_match",
  vars: MessageVariables | LocationMessageVars = {}
): string {
  switch (state) {
    case "post_login":
      return getPostLoginMessage(vars);
    case "post_login_v2":
      return getPostLoginMessageV2(vars);
    case "loading":
      return getLoadingMessage();
    case "programs_ready":
      return getProgramsReadyMessage(vars);
    case "programs_ready_v2":
      return getProgramsReadyMessageV2(vars);
    case "no_programs":
      return getNoProgramsMessage(vars);
    case "error":
      return getErrorRecoveryMessage(vars);
    case "program_discovery_error":
      return getProgramDiscoveryErrorMessage(vars);
    case "session_expired":
      return getSessionExpiredMessage(vars);
    case "confirmation":
      return getConfirmationMessage(vars);
    case "selection_ack":
      return getSelectionAckMessage(vars);
    case "mandate_recovery":
      return getMandateRecoveryMessage(vars);
    case "out_of_coverage":
      return getOutOfCoverageMessage(vars as LocationMessageVars);
    case "ambiguous_city":
      return getAmbiguousCityMessage(vars as LocationMessageVars);
    case "coming_soon":
      return getComingSoonMessage(vars as LocationMessageVars);
    case "in_coverage":
      return getInCoverageMessage(vars as LocationMessageVars);
    case "no_provider_match":
      return getNoProviderMatchMessage(vars as MessageVariables & { search_query?: string; coverage_area?: string });
    default:
      return "Let me know how I can help!";
  }
}
