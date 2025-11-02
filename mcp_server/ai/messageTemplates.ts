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
 * Helper to select the appropriate message based on flow state
 */
export function getMessageForState(
  state: "post_login" | "post_login_v2" | "loading" | "programs_ready" | "programs_ready_v2" | "no_programs" | "error" | "program_discovery_error" | "session_expired" | "confirmation" | "selection_ack",
  vars: MessageVariables = {}
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
    default:
      return "Let me know how I can help!";
  }
}
