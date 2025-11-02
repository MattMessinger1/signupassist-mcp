/**
 * Tool Guidance for AIOrchestrator
 * 
 * TOOL_GUIDANCE__AUTO_PROGRAM_DISCOVERY
 * 
 * Goal: After successful provider login, automatically fetch and display programs.
 * Do NOT prompt the user for intent — immediately call scp.find_programs.
 * 
 * Flow:
 * 1. credentials_submitted triggers handleAutoProgramDiscovery()
 * 2. Call scp.find_programs with { org_ref, session_token, category: "all" }
 * 3. If session_token is missing/expired, scp.find_programs will handle re-login
 * 4. Navigate directly to /registration (skip dashboard)
 * 5. Extract programs using runThreePassExtractor
 * 6. Group programs using groupProgramsByTheme (Lessons, Camps, Race Team, Other)
 * 7. Limit to 4 cards per group
 * 8. Return: message → grouped cards → CTA chips
 * 
 * Error handling:
 * - Session expired: Prompt to reconnect
 * - No programs: Offer to search other providers
 * - Extraction error: Retry with timeout
 * 
 * Why: Eliminates friction, follows Design DNA (predictable rhythm), and
 * maintains security transparency.
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
