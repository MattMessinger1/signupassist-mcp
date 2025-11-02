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
 * ASSISTANT__NO_PROGRAMS_FOUND
 * 
 * Fallback when no programs are discovered
 */
export function getNoProgramsMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `🤔 I couldn't find any active programs at ${providerName} right now. This could mean:
• The season hasn't opened yet
• Programs are sold out
• The registration page is temporarily unavailable

Would you like me to check again, or can I help with something else?`;
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
 * ASSISTANT__SESSION_EXPIRED
 * 
 * Message when session token is invalid/expired
 */
export function getSessionExpiredMessage(vars: MessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  
  return `Looks like your ${providerName} login expired. Let's reconnect securely—I'll just need you to log in again, and we'll pick up right where we left off.`;
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
 * Helper to select the appropriate message based on flow state
 */
export function getMessageForState(
  state: "post_login" | "loading" | "programs_ready" | "no_programs" | "error" | "session_expired" | "confirmation",
  vars: MessageVariables = {}
): string {
  switch (state) {
    case "post_login":
      return getPostLoginMessage(vars);
    case "loading":
      return getLoadingMessage();
    case "programs_ready":
      return getProgramsReadyMessage(vars);
    case "no_programs":
      return getNoProgramsMessage(vars);
    case "error":
      return getErrorRecoveryMessage(vars);
    case "session_expired":
      return getSessionExpiredMessage(vars);
    case "confirmation":
      return getConfirmationMessage(vars);
    default:
      return "Let me know how I can help!";
  }
}
