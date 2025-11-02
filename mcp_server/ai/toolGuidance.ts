/**
 * Tool Guidance for AIOrchestrator
 * 
 * TOOL_GUIDANCE__SESSION_REUSE_AND_FIND_PROGRAMS
 * 
 * Goal: After successful provider login, do not re‑prompt for intent. 
 * Immediately fetch programs in the same authenticated session.
 * 
 * If a valid session_token exists, call scp.find_programs with:
 * { org_ref, session_token, category: "lessons" | "all" } (category optional).
 * 
 * If session_token is missing/expired, call scp.login with saved credentials, 
 * capture the new session_token, then call scp.find_programs.
 * 
 * scp.find_programs must navigate directly to /registration for the org and wait for readiness; 
 * do not route via dashboard.
 * 
 * Once on /registration, call the extractor (runThreePassExtractor) to get structured program rows.
 * 
 * Return raw programs[] to the LLM, then run the GROUPING prompt to bucket into themes 
 * and pick the top 4 per group (soonest start or most relevant first).
 * 
 * Compose "message → grouped cards → CTA".
 * 
 * Why: minimizes re‑login and keeps the chat rhythm predictable while honoring 
 * the Design DNA (chat‑native flow and safe transparency).
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
 * Tool calling workflow for post-login program discovery
 */
export const TOOL_WORKFLOW = {
  /**
   * Step 1: Check session validity
   */
  checkSession: async (sessionToken?: string) => {
    if (shouldReuseSession(sessionToken)) {
      return { valid: true, token: sessionToken };
    }
    return { valid: false, requiresLogin: true };
  },
  
  /**
   * Step 2: Call find_programs with session
   */
  findPrograms: {
    toolName: "scp.find_programs",
    requiredArgs: ["org_ref", "session_token"],
    optionalArgs: ["category"],
    navigationTarget: "/registration",
    skipDashboard: true
  },
  
  /**
   * Step 3: Extract programs using Three-Pass Extractor
   */
  extractPrograms: {
    toolName: "runThreePassExtractor",
    requiredFor: "structured program data"
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
