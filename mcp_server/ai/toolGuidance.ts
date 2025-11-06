/**
 * Tool Guidance for AIOrchestrator
 * 
 * TOOL_GUIDANCE__LOGIN_WRAPPER_ANTIBOT
 * 
 * scp.login Anti-bot Tool Guidance:
 * 
 * Rules:
 * 1. If anti-bot waits exceed 6.5 seconds without clear progress, immediately navigate 
 *    to /registration and continue (fast-path).
 * 2. On first success, persist cookies+localStorage and tag session_issued_at.
 * 3. On reuse, skip anti-bot waits and go straight to /registration.
 * 4. Never re-login if a fresh session_token exists (issued < ttl-30s).
 * 
 * Implementation:
 * - 6.5s timeout cap in mcp_server/lib/login.ts (ANTIBOT_MAX_WAIT_MS)
 * - Session persistence via storageState (cookies + localStorage)
 * - session_issued_at tracked in AIOrchestrator context
 * - Session reuse check validates: session_token + org_ref match + (now - session_issued_at < ttl-30s)
 * 
 * Why: Prevents unnecessary delays, improves reliability, follows Design DNA 
 * (minimize friction, transparent behavior).
 * 
 * ───────────────────────────────────────────────────────────────────────────
 * 
 * TOOL_GUIDANCE__AUTO_PROGRAM_DISCOVERY_V2
 * 
 * Goal: After successful provider login, automatically fetch and display programs.
 * Do NOT prompt the user for intent — immediately call scp.find_programs.
 * 
 * Flow:
 * 1. credentials_submitted triggers handleAutoProgramDiscovery()
 * 2. Reuse existing session token — never start new login unless session expired
 * 3. Call scp.find_programs with { org_ref, session_token, category: "all" }
 * 4. Force navigation to /registration (skip dashboard redirect)
 * 5. Wait for page readiness with timeout handling
 * 6. Extract programs using runThreePassExtractor
 *    - Vision pass: gpt-5-2025-08-07 (multimodal)
 *    - Text extraction: gpt-5-mini-2025-08-07
 * 7. Group programs using groupProgramsByTheme (gpt-5-mini-2025-08-07)
 *    - Themes: Lessons, Camps, Race Team, Other
 *    - Limit: 4 cards per group
 * 8. Return: message → grouped cards → CTA chips
 * 
 * Error handling:
 * - Page readiness timeout: Return timeout error with auto-retry option
 * - Session expired: Prompt to reconnect
 * - No programs: Offer to search other providers
 * - Max retries (2): Offer manual reconnect
 * 
 * Expected Log Sequence:
 * 1️⃣ ✅ Reusing session from token (or 🔁 New session will be created)
 * 2️⃣ Navigated to: /registration (or Already on programs page)
 * 3️⃣ Extractor model: gpt-5-2025-08-07 (vision), gpt-5-mini-2025-08-07 (text)
 * 4️⃣ Programs found: >0
 * 5️⃣ Classified into N theme groups
 * 6️⃣ Assistant shows grouped cards (no intent prompt)
 * 
 * Why: Eliminates friction, follows Design DNA (predictable rhythm), 
 * maintains security transparency, and handles timeouts gracefully.
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
