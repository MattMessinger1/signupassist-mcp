/**
 * Tool Guidance for AIOrchestrator
 *
 * Bookeo API tools use server-side credentials; program discovery reads from the
 * provider feed/cache via `bookeo.find_programs`. No browser automation or
 * anti-bot handling is required for the default flow.
 */

export interface SessionReuseConfig {
  skipReauthIfValid: boolean;
  navigateDirectlyToRegistration: boolean;
  maxProgramsPerGroup: number;
  defaultCategory?: "lessons" | "all";
}

export const SESSION_REUSE_CONFIG: SessionReuseConfig = {
  skipReauthIfValid: true,
  navigateDirectlyToRegistration: true,
  maxProgramsPerGroup: 4,
  defaultCategory: "lessons"
};

/**
 * Determines if we should reuse an existing session or re-authenticate
 */
export function shouldReuseSession(sessionToken?: string): boolean {
  return !!(sessionToken && SESSION_REUSE_CONFIG.skipReauthIfValid);
}

/**
 * Gets the appropriate category for program search based on intent
 */
export function getProgramCategory(intent?: string): "lessons" | "all" {
  if (!intent) return SESSION_REUSE_CONFIG.defaultCategory || "lessons";

  const lowerIntent = intent.toLowerCase();
  if (lowerIntent.includes("lesson") || lowerIntent.includes("class")) {
    return "lessons";
  }

  return "all";
}

/**
 * Tool calling workflow for program discovery (Bookeo API)
 */
export const TOOL_WORKFLOW = {
  /**
   * Step 1: Check session validity (optional client/session markers)
   */
  checkSession: async (sessionToken?: string) => {
    if (shouldReuseSession(sessionToken)) {
      return { valid: true, token: sessionToken };
    }
    return { valid: false, requiresLogin: true };
  },

  /**
   * Step 2: Load programs via Bookeo-backed discovery
   */
  findPrograms: {
    toolName: "bookeo.find_programs",
    requiredArgs: ["org_ref"],
    optionalArgs: ["category", "user_jwt", "mandate_jws", "user_id"]
  },

  /**
   * Step 3: Field metadata comes from API discovery (see discover_required_fields)
   */
  extractPrograms: {
    toolName: "bookeo.discover_required_fields",
    requiredFor: "structured program + form field data"
  },

  /**
   * Step 4: Group and display
   */
  displayPrograms: {
    maxPerGroup: SESSION_REUSE_CONFIG.maxProgramsPerGroup,
    sortBy: "soonest_start",
    groupBy: ["Lessons", "Camps/Clinics", "Race Team/Events"]
  }
};
