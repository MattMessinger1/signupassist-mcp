import OpenAI from "openai";
import Logger from "../utils/logger.js";
import { parseProviderInput, ParsedProviderInput } from "../utils/parseInput.js";
import { lookupLocalProvider, googlePlacesSearch } from "../utils/providerSearch.js";
import type { Provider } from "../utils/providerSearch.js";
import { logAudit, extractUserIdFromJWT, logToneChange } from "../lib/auditLogger.js";
import { loadSessionFromDB, saveSessionToDB } from "../lib/sessionPersistence.js";
import { shouldReuseSession, getProgramCategory, TOOL_WORKFLOW, SESSION_REUSE_CONFIG } from "./toolGuidance.js";
import { getMessageForState } from "./messageTemplates.js";
import { buildGroupedCardsPayload, buildSimpleCardsFromGrouped } from "./cardPayloadBuilder.js";

/**
 * Prompt version tracking for tone changes
 */
export const PROMPT_VERSION = "v1.0.0";

/**
 * SYSTEM__POST_LOGIN_PROGRAM_DISCOVERY
 * 
 * Production System Prompt - Single source of truth for SignupAssist tone and behavior
 * This prompt defines the voice parents hear and ensures consistent Design DNA compliance
 */
const PRODUCTION_SYSTEM_PROMPT = `
You are SignupAssist — a friendly, efficient helper that automates program discovery for families.

After the user successfully logs in to their provider account (e.g. Blackhawk Ski Club), do not ask what they want next.

Instead, immediately:
1. Confirm their secure login in a friendly way.
2. Reassure that their data is safe.
3. Inform them that you're fetching programs now.
4. Automatically call the scp.find_programs tool using their current session token.
5. Display grouped program results (Lessons, Camps, Race Team, Other).

Follow the predictable rhythm: Assistant text → grouped cards → CTA chips.

Tone: friendly, concise, parent-first, secure.

Example behavior:
• Don't ask, "Which type of program?"
• Do say, "🎿 You're logged in! Let's pull the programs for you right now…"
• After extraction, show the top 3-4 per group as cards.

Security reminder: Always restate that personal and payment data stay with the provider; SignupAssist only coordinates securely.

Error rule: If program discovery fails, say "Hmm, I couldn't reach the programs page just now — let's retry" instead of reverting to the intent question.

(Design principles: chat‑native, predictable message→card→CTA, explicit confirmations, security context, audit‑friendly tone.)
`;

// 🔜 Future Reliability Enhancements:
// - Persist logs in Supabase (table: audit_logs)
// - Add distributed cache (Redis) for shared provider results
// - Add tracing IDs for all API calls
// - Integrate Sentry or similar for runtime error tracking

// 🔜 TODO:
// - Replace in-memory session store with Supabase persistence
//   using table: agentic_checkout_sessions
// - Add methods: loadContextFromDB(sessionId), saveContextToDB(sessionId)
// - Sync context automatically every few updates


/**
 * Step constants for flow management
 */
export enum FlowStep {
  PROVIDER_SEARCH = 3,
  LOGIN = 4,
  INTENT_CAPTURE = 4.5,
  FIELD_PROBE = 4.7,
  PROGRAM_SELECTION = 5,
  PREREQUISITE_CHECK = 6,
  CONFIRMATION = 7,
  COMPLETED = 8
}

  /**
   * Session context structure - defines what's stored for each conversation
   */
  export interface SessionContext {
    step?: FlowStep;
    provider?: { name: string; orgRef: string };
    program?: { name: string; id: string };
    child?: { name: string; id?: string; birthdate?: string };
    prerequisites?: Record<string, "ok" | "required" | "missing">;
    formAnswers?: Record<string, any>;
    conversationHistory?: Array<{ role: string; content: string }>;
    loginCompleted?: boolean;
  confirmed?: boolean;
  user_jwt?: string;
  credential_id?: string;
  session_token?: string;  // Browser session token for reuse
  mandate_id?: string;  // Mandate ID for audit trail
  mandate_jws?: string;  // Mandate JWS token for verification
  credentials?: { [provider: string]: { id: string; credential_id: string } };
  pendingLogin?: { provider: string; orgRef: string };
    
    // Smart Program Filtering Properties
    availablePrograms?: any[];
    displayedProgramIds?: string[];
    remainingProgramIds?: string[];
    programSummary?: {
      categories: Array<{
        name: string;
        count: number;
        examples: string[];
        programIds: string[];
      }>;
    };
    showingCategories?: boolean;
    currentCategory?: string;
    selectedProgram?: string;
    
    // Intent Capture & Field Probe Properties
    programIntent?: {
      category?: "lessons" | "membership" | "camp" | "race" | "private";
      day_pref?: "weekend" | "weekday" | null;
      time_pref?: "morning" | "afternoon" | "evening" | null;
      level?: "beginner" | "intermediate" | "advanced" | null;
      keywords?: string[];
    };
    extractedFields?: {
      fields: Array<{
        id: string;
        label: string;
        type: string;
        required: boolean;
        options?: Array<{ value: string; label: string }>;
        group?: string;
        confidence: number;
      }>;
      target_url?: string;
      screenshot?: string;
      meta?: {
        discovered_at: string;
        strategy: string;
        readiness: string;
      };
    };
    field_probe_run_id?: string;
    provider_session_token?: string;
    provider_cookies?: any;
  }

/**
 * Card specification for UI rendering
 */
interface CardSpec {
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: "accent" | "outline";
  }>;
}

/**
 * CTA (Call-to-Action) specification
 */
interface CTASpec {
  label: string;
  action: string;
  variant?: "accent" | "outline";
}

/**
 * Standardized orchestrator response structure
 * Following Design DNA: Message → Card → CTA pattern
 */
interface OrchestratorResponse {
  message: string;              // Assistant text shown above UI
  cards?: CardSpec[];           // Optional cards to render
  cta?: CTASpec[];              // Optional primary/secondary buttons
  uiPayload?: Record<string, any>; // Legacy support - will be phased out
  contextUpdates?: Record<string, any>;
  toolMetadata?: {              // Metadata from tool responses
    tone_hints?: string;
    security_note?: string;
    next_actions?: string[];
  };
  componentType?: "cards-grouped" | "cards-simple";  // NEW: UI component type
  componentPayload?: any;       // NEW: Structured payload for GroupedProgramCards
}

/**
 * Helper constants for common messages (only used for backward compatibility)
 * NEW: Prefer using meta.security_note from tool responses
 */
const SECURITY_NOTE = "Credentials and card data stay with the provider; SignupAssist never stores card numbers.";
const AUDIT_REMINDER = "Every action is logged and requires your explicit consent.";

/**
 * AIOrchestrator - The brain of SignupAssist
 * 
 * Handles all AI-driven interactions including:
 * - Conversational flow management via OpenAI
 * - Context persistence across user sessions
 * - Tool calling for signup automation (prerequisites, discovery, submission)
 * - UI card/action suggestions based on conversation state
 */
class AIOrchestrator {
  private openai: OpenAI;
  private sessions: Record<string, SessionContext> = {};
  private cache: Record<string, any> = {};
  private systemPrompt: string; // Made mutable for tone training
  private promptTemplates: Record<string, string>;
  private exampleMessages: Array<{ role: string; content: string }>;
  private model: string;
  private temperature: number;
  private mcpToolCaller?: (toolName: string, args: any) => Promise<any>;

  /**
   * Initialize the AI orchestrator
   * Sets up OpenAI client, session storage, and system prompt
   */
  constructor(mcpToolCaller?: (toolName: string, args: any) => Promise<any>) {
    this.mcpToolCaller = mcpToolCaller;
    // Initialize OpenAI client with API key from environment
    this.openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY! 
    });

    // Model configuration
    // gpt-5 = flagship model for complex reasoning and orchestration
    // gpt-5-mini = faster, more cost-efficient for simple tasks
    this.model = process.env.OPENAI_MODEL || "gpt-5";
    this.temperature = Number(process.env.OPENAI_TEMPERATURE || 0.3);

    // Use the production system prompt as the single source of truth
    this.systemPrompt = PRODUCTION_SYSTEM_PROMPT;

    // Step-specific prompt templates for consistent messaging
    this.promptTemplates = {
      providerSearch: "User said: '{input}'. Extract provider name and city/state.",
      programSelection: "List available programs for {provider} and help user choose.",
      prerequisiteCheck: "Explain which prerequisites (membership, waivers) are missing and guide politely.",
      formFill: "Ask for remaining registration fields clearly and one at a time.",
      confirmation: "Summarize registration details and ask for explicit confirmation."
    };

    // Few-shot examples to maintain consistent tone and style
    this.exampleMessages = [
      { role: "user", content: "Blackhawk ski Madison" },
      { role: "assistant", content: "🔍 I found **Blackhawk Ski Club (Middleton, WI)**. Is that correct?" },
      { role: "user", content: "Yes" },
      { role: "assistant", content: "✅ Great! Let's check available classes next." }
    ];
  }

  /**
   * Generate AI response for user message
   * Uses step-aware routing to guide user through signup flow
   * 
   * @param userMessage - The user's input text
   * @param sessionId - Unique session identifier for context tracking
   * @param userLocation - Optional GPS coordinates {lat, lng} for location-based filtering
   * @returns Promise resolving to OrchestratorResponse with cards
   */
  async generateResponse(userMessage: string, sessionId: string, userLocation?: {lat: number, lng: number}, userJwt?: string): Promise<OrchestratorResponse> {
    try {
      const context = await this.getContext(sessionId);
      // Store userLocation and JWT in context for tool calls
      if (userLocation) {
        await this.updateContext(sessionId, { userLocation } as any);
      }
      if (userJwt) {
        await this.updateContext(sessionId, { user_jwt: userJwt } as any);
      }
      const step = this.determineStep(userMessage, context);
      
      // Audit logging for responsible delegate trail
      this.logAction("flow_routing", { step, sessionId, input: userMessage, hasLocation: !!userLocation });
      
      // Debug logging for flow visibility
      Logger.info(`🧭 Flow Step: ${step}`, { sessionId, context, hasLocation: !!userLocation });
      
      // NOTE: Intent parsing is now deprecated - auto-discovery handles this
      // Keeping this block for backward compatibility only
      if (context.step === FlowStep.INTENT_CAPTURE && userMessage.trim()) {
        const intentCategory = this.parseIntentFromText(userMessage);
        if (intentCategory) {
          Logger.info(`[Intent Parsed - Legacy] "${userMessage}" → ${intentCategory}`);
          await this.updateContext(sessionId, {
            programIntent: { category: intentCategory },
            step: FlowStep.PROGRAM_SELECTION
          });
          this.logInteraction(sessionId, "user", userMessage);
          return this.handleProgramSearch(intentCategory, sessionId);
        }
      }
      
      this.logInteraction(sessionId, "user", userMessage);
      const result = await this.handleStep(step, userMessage, sessionId);
      
      // NEW: Extract and apply metadata from tool responses
      if (result.toolMetadata) {
        Logger.info(`[Metadata Applied] ${sessionId}`, result.toolMetadata);
      }
      
      // Validate Design DNA compliance
      this.validateRhythm(result);
      this.logAction("response_sent", { step, hasCards: !!result.cards, hasCTA: !!result.cta });
      
      await this.updateContext(sessionId, result.contextUpdates || {});
      this.logInteraction(sessionId, "assistant", result.message);
      return result;
    } catch (error: any) {
      Logger.error(`[${sessionId}] AI error: ${error.message}`);
      // Graceful error recovery with actionable CTA
      return this.formatResponse(
        "Hmm, looks like something went wrong. Let's try that again.",
        undefined,
        [{ label: "Retry", action: "retry_last", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Get session context from in-memory store
   * Auto-initializes a new session if none exists
   * Fetches the current state of the user's signup flow
   * PHASE 2: Now with Supabase persistence
   * 
   * @param sessionId - Unique session identifier
   * @returns Current session context object
   */
  async getContext(sessionId: string): Promise<SessionContext> {
    // Check in-memory first (fast path)
    if (this.sessions[sessionId]) {
      return this.sessions[sessionId];
    }

    // Try to load from Supabase
    const userId = extractUserIdFromJWT(this.sessions[sessionId]?.user_jwt);
    const dbContext = await loadSessionFromDB(sessionId, userId || undefined);
    
    if (dbContext) {
      this.sessions[sessionId] = dbContext;
      Logger.info(`[Context Loaded from DB] ${sessionId}`);
      return dbContext;
    }

    // Initialize new session
    this.sessions[sessionId] = {};
    Logger.info(`[Context Created] New session ${sessionId}`);
    return this.sessions[sessionId];
  }

  /**
   * Update session context with new data
   * Merges updates into existing context
   * PHASE 2: Now with Supabase persistence
   * 
   * @param sessionId - Unique session identifier
   * @param updates - Partial context updates to merge
   */
  async updateContext(sessionId: string, updates: Partial<SessionContext>): Promise<void> {
    const existing = await this.getContext(sessionId);
    this.sessions[sessionId] = { 
      ...existing, 
      ...updates 
    };
    
    // Single consolidated log instead of 3-4 separate calls
    Logger.info(`[Context Updated] ${sessionId}`, {
      updates,
      fullContext: this.sessions[sessionId]
    });
    
    // PHASE 2: Persist to Supabase
    const userId = extractUserIdFromJWT(this.sessions[sessionId]?.user_jwt);
    await saveSessionToDB(sessionId, this.sessions[sessionId], userId || undefined);
  }

  /**
   * Search for programs using Three-Pass Extractor
   * Calls scp.find_programs and formats results as cards
   * Now uses message templates for consistent parent-friendly communication
   */
  private async handleProgramSearch(
    intentCategory: string,
    sessionId: string
  ): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    // Validate we have credentials and provider
    if (!context.credential_id) {
      return this.formatResponse(
        "I need your login credentials first. Let me get those set up.",
        [],
        [{ label: "Connect Account", action: "connect_account", variant: "accent" }],
        {}
      );
    }
    
    if (!context.provider?.orgRef) {
      return this.formatResponse(
        "I'm not sure which provider to search. Can you tell me which organization?",
        [],
        [],
        {}
      );
    }
    
    // Use template: ASSISTANT__LOADING_STATUS
    const loadingMessage = getMessageForState("loading");
    Logger.info(`[handleProgramSearch] ${loadingMessage}`);
    Logger.info(`[handleProgramSearch] Fetching ${intentCategory} programs for ${context.provider.name}`);
    
    try {
      // Call scp.find_programs tool
      const result = await this.callTool('scp.find_programs', {
        credential_id: context.credential_id,
        session_token: context.provider_session_token,
        org_ref: context.provider.orgRef,
        user_jwt: context.user_jwt,
        category: intentCategory
      });
      
      // Check for session expiration or login errors
      if (!result.success) {
        Logger.error('[handleProgramSearch] Tool returned error:', result.error);
        
        if (result.error?.includes('session') || result.error?.includes('login')) {
          const sessionExpiredMsg = getMessageForState("session_expired", {
            provider_name: context.provider.name
          });
          return this.formatResponse(
            sessionExpiredMsg,
            [],
            [{ label: "Reconnect", action: "connect_account", variant: "accent" }],
            {}
          );
        }
        
        // Generic error
        const errorMsg = getMessageForState("error", {
          provider_name: context.provider.name
        });
        return this.formatResponse(
          errorMsg,
          [],
          [{ label: "Retry", action: "retry_program_search", variant: "accent" }],
          {}
        );
      }
      
      const programs = result.data?.programs || [];
      
      if (programs.length === 0) {
        const noProgramsMsg = getMessageForState("no_programs", {
          provider_name: context.provider.name
        });
        return this.formatResponse(
          noProgramsMsg,
          [],
          [{ label: "Try Again", action: "retry_program_search", variant: "accent" }],
          {}
        );
      }
      
      // Store session token for next steps
      if (result.session_token) {
        await this.updateContext(sessionId, { 
          provider_session_token: result.session_token 
        } as any);
      }
      
      // Format programs as cards with selection buttons
      const programCards = programs.slice(0, 5).map((program: any) => ({
        title: program.title,
        description: `${program.schedule || ''} • ${program.age_range || ''} • ${program.price || ''}`,
        metadata: { 
          program_ref: program.program_ref,
          program_id: program.id 
        },
        buttons: [{
          label: "Select This Program",
          action: "select_program",
          variant: "accent"
        }]
      }));
      
      await this.updateContext(sessionId, {
        availablePrograms: programs,
        step: FlowStep.PROGRAM_SELECTION
      });
      
      // Use template: ASSISTANT__PROGRAMS_READY
      const programsReadyMsg = getMessageForState("programs_ready", {
        provider_name: context.provider.name,
        counts: { total: programs.length }
      });
      
      return this.formatResponse(
        programsReadyMsg,
        programCards,
        [],
        {}
      );
      
    } catch (error: any) {
      Logger.error('[handleProgramSearch] Failed:', error);
      const errorMsg = getMessageForState("error", {
        provider_name: context.provider?.name
      });
      return this.formatResponse(
        errorMsg,
        [],
        [{ label: "Retry", action: "retry_program_search", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * TOOL_CALL__FIND_PROGRAMS_AUTO
   * 
   * Automatically discover and display grouped programs after login
   * Called immediately after credentials_submitted without user prompt
   * 
   * @param sessionId - Current session identifier
   * @returns OrchestratorResponse with grouped program cards
   */
  private async handleAutoProgramDiscovery(sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    if (!context.provider) {
      throw new Error("Provider context missing for auto-discovery");
    }
    
    const providerName = context.provider.name;
    Logger.info(`[handleAutoProgramDiscovery] Starting auto-discovery for ${providerName}`);
    
    try {
      // FIX: Pass session_token and user_jwt to enable credential lookup and session reuse
      const result = await this.callTool('scp.find_programs', {
        credential_id: context.credential_id,
        session_token: context.provider_session_token,  // Reuse existing session if available
        org_ref: context.provider.orgRef,
        user_jwt: context.user_jwt,  // CRITICAL: Required for lookupCredentialsById()
        category: "all"  // Auto-discovery fetches all programs
      });
      
      // Handle errors
      if (!result.success) {
        Logger.error('[handleAutoProgramDiscovery] Tool error:', result.error);
        
        // Check for timeout specifically
        if ((result as any).timeout) {
          Logger.warn('[handleAutoProgramDiscovery] Page readiness timeout detected');
          const timeoutMsg = getMessageForState("program_discovery_error", {
            provider_name: providerName
          });
          
          // Store retry count in context
          const retryCount = (context as any).discovery_retry_count || 0;
          await this.updateContext(sessionId, { 
            discovery_retry_count: retryCount + 1 
          } as any);
          
          return this.formatResponse(
            timeoutMsg,
            [],
            [{ label: "Retry Now", action: "retry_program_discovery", variant: "accent" }],
            {}
          );
        }
        
        if (result.error?.includes('session') || result.error?.includes('login')) {
          const sessionExpiredMsg = getMessageForState("session_expired", {
            provider_name: providerName
          });
          return this.formatResponse(
            sessionExpiredMsg,
            [],
            [{ label: "Reconnect", action: "connect_account", variant: "accent" }],
            {}
          );
        }
        
        throw new Error(result.error || "Program discovery failed");
      }
      
      // Store session token for future use
      if (result.session_token) {
        await this.updateContext(sessionId, { 
          provider_session_token: result.session_token 
        } as any);
      }
      
      const programs = result.data?.programs || [];
      
      // Handle empty results
      if (programs.length === 0) {
        const noProgramsMsg = getMessageForState("no_programs", {
          provider_name: providerName
        });
        return this.formatResponse(
          noProgramsMsg,
          [],
          [{ label: "Search Other Providers", action: "retry_search", variant: "accent" }],
          {}
        );
      }
      
      // Group programs using the grouping module
      const { groupProgramsByTheme } = await import('../lib/programGrouping.js');
      const groupedResult = await groupProgramsByTheme(programs, 4);
      
      Logger.info(`[handleAutoProgramDiscovery] ✅ ${programs.length} programs found, grouped into ${groupedResult.groups.length} themes`);
      
      // Build UI payload using card payload builder
      const cardsPayload = buildGroupedCardsPayload(groupedResult.groups, 4);
      
      // Store programs in context
      await this.updateContext(sessionId, {
        availablePrograms: programs,
        step: FlowStep.PROGRAM_SELECTION
      });
      
      // Use V2 programs-ready message
      const programsReadyMsg = getMessageForState("programs_ready_v2", {
        provider_name: providerName,
        counts: { total: programs.length, by_theme: groupedResult.counts.by_theme }
      });
      
      // Return grouped cards response
      // Map CTAChip[] to CTASpec[] format
      const ctaSpecs: CTASpec[] = (cardsPayload.cta?.options || []).map(chip => ({
        label: chip.label,
        action: chip.payload.intent,
        variant: "outline" as const
      }));
      
      return {
        message: programsReadyMsg,
        cards: [],
        cta: ctaSpecs,
        contextUpdates: {},
        componentType: "cards-grouped",
        componentPayload: cardsPayload
      };
      
    } catch (error: any) {
      Logger.error('[handleAutoProgramDiscovery] Failed:', error);
      throw error; // Re-throw to be caught by credentials_submitted handler
    }
  }

  /**
   * Parse program intent from user text message
   * Detects keywords to categorize user's program interest
   * 
   * @param text - User's message text
   * @returns Detected intent category or null
   */
  private parseIntentFromText(text: string): "lessons" | "membership" | "camp" | "race" | "private" | null {
    const normalized = text.toLowerCase().trim();
    
    // Define keyword mappings for each intent category
    const intentPatterns: Array<{ keywords: string[], category: "lessons" | "membership" | "camp" | "race" | "private" }> = [
      { keywords: ["lesson", "class", "instruction", "learn"], category: "lessons" },
      { keywords: ["membership", "member", "join", "enroll"], category: "membership" },
      { keywords: ["camp", "summer", "week"], category: "camp" },
      { keywords: ["race", "racing", "team", "competition"], category: "race" },
      { keywords: ["private", "1-on-1", "one on one", "individual"], category: "private" },
    ];
    
    // Check each pattern for matches
    for (const pattern of intentPatterns) {
      if (pattern.keywords.some(kw => normalized.includes(kw))) {
        return pattern.category;
      }
    }
    
    return null; // No clear intent detected
  }

  /**
   * Override the system prompt temporarily for tone testing
   * @param sessionId - Session for which to override prompt
   * @param newPrompt - The new prompt text
   */
  overridePrompt(sessionId: string, newPrompt: string): void {
    const oldPrompt = this.systemPrompt;
    this.systemPrompt = newPrompt;
    
    logToneChange({
      sessionId,
      aspect: 'system_prompt',
      oldValue: oldPrompt.substring(0, 50),
      newValue: newPrompt.substring(0, 50),
      timestamp: new Date().toISOString()
    });
    
    Logger.info(`[AIOrchestrator] Prompt overridden for session ${sessionId}`);
  }

  /**
   * Reset to production prompt
   */
  resetPrompt(): void {
    this.systemPrompt = PRODUCTION_SYSTEM_PROMPT;
    Logger.info(`[AIOrchestrator] Prompt reset to production version ${PROMPT_VERSION}`);
  }

  /**
   * Reset session context
   * Clears all stored data for a session (useful for debugging or new signups)
   * 
   * @param sessionId - Session to reset
   */
  resetContext(sessionId: string): void {
    delete this.sessions[sessionId];
    Logger.info(`[Context Reset] ${sessionId}`);
  }

  /**
   * Handle card action (NEW: Context-Aware Action Handler)
   * Processes user interactions with cards and advances flow
   * 
   * @param action - Action identifier from card button
   * @param payload - Action payload (provider, program, etc.)
   * @param sessionId - Session identifier
   * @returns Promise resolving to next OrchestratorResponse
   */
  async handleAction(action: string, payload: any, sessionId: string, userJwt?: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    // Store JWT in context if provided
    if (userJwt) {
      await this.updateContext(sessionId, { user_jwt: userJwt } as any);
    }
    
    this.logAction("card_action", { action, sessionId, currentStep: context.step });
    
    console.log(`[FLOW] Action received: ${action}`, payload);
    
    // PHASE 1: Log all actions to audit trail
    const userId = extractUserIdFromJWT(userJwt || context.user_jwt);
    if (userId) {
      await logAudit({
        user_id: userId,
        action: `action_${action}`,
        provider: payload.provider || context.provider?.orgRef,
        org_ref: payload.orgRef || context.provider?.orgRef,
        program_ref: payload.program_ref || context.program?.id,
        metadata: { action, payload, sessionId }
      });
    }
    
    try {
      switch (action) {
        case "select_provider":
          // Step 3 → Step 4: Provider selected, move to login
          await this.updateContext(sessionId, {
            provider: payload,
            step: FlowStep.LOGIN
          });
          return this.formatResponse(
            `Great, we'll use **${payload.name}**! Now let's connect your account securely. ${SECURITY_NOTE}`,
            [{
              title: `Connect to ${payload.name}`,
              subtitle: "Secure login required",
              description: AUDIT_REMINDER,
              metadata: { provider: 'skiclubpro', orgRef: payload.orgRef },
              buttons: [
                { label: `Connect Account`, action: "connect_account", variant: "accent" }
              ]
            }],
            undefined,
            {}
          );

        case "reject_provider":
          // User rejected provider, ask for clarification
          await this.updateContext(sessionId, { step: FlowStep.PROVIDER_SEARCH });
          return this.formatResponse(
            "No problem! Let's try a different search. What's the name of your provider?",
            undefined,
            [{ label: "Search Again", action: "retry_search", variant: "accent" }],
            {}
          );

        case "connect_account":
          // Check if user is authenticated
          const currentContext = await this.getContext(sessionId);
          
          if (!currentContext.user_jwt) {
            return this.formatResponse(
              "⚠️ Please log in to connect your account.",
              undefined,
              [{ label: "Log In", action: "redirect_to_auth", variant: "accent" }],
              {}
            );
          }
          
          // First, check if credentials already exist for this provider
          const userId = extractUserIdFromJWT(currentContext.user_jwt);
          const existingCred = await this.lookupStoredCredential(userId, payload.provider, payload.orgRef);
          
          if (existingCred) {
            console.log(`[orchestrator] Retrieved credential_id=${existingCred.id} for ${payload.provider}`);
            
            // Store credential in context
            await this.updateContext(sessionId, {
              credentials: {
                [payload.provider]: {
                  id: existingCred.id,
                  credential_id: existingCred.id
                }
              },
              loginCompleted: true,
              step: FlowStep.PROGRAM_SELECTION
            });
            
            return this.formatResponse(
              `✅ Your ${payload.orgRef} account is already connected! Let's check available programs.`,
              undefined,
              [{ label: "View Programs", action: "check_programs", variant: "accent" }],
              {}
            );
          }
          
          // Store pending login info for credential collection
          await this.updateContext(sessionId, {
            pendingLogin: {
              provider: payload.provider,
              orgRef: payload.orgRef
            },
            step: FlowStep.LOGIN
          });
          
          return this.formatResponse(
            `To connect your ${payload.orgRef} account, please provide your credentials. Click the button below to securely log in.`,
            undefined,
            [{ 
              label: "Enter Credentials", 
              action: "show_login_dialog", 
              variant: "accent" 
            }],
            { requiresCredentials: true }
          );

        case "select_program":
          // Step 5 → Step 6: Program selected, check prerequisites
          await this.updateContext(sessionId, {
            program: payload,
            step: FlowStep.PREREQUISITE_CHECK
          });
          return this.formatResponse(
            `Perfect choice — **${payload.title}**! Let me check a few prerequisites before we continue.`,
            undefined,
            [{ label: "Check Prerequisites", action: "check_prereqs", variant: "accent" }],
            {}
          );

        case "check_programs":
          // After credential confirmation, move to program selection
          await this.updateContext(sessionId, {
            step: FlowStep.PROGRAM_SELECTION
          });
          return this.handleProgramSelection("", sessionId);

        case "check_prereqs":
          // Check prerequisites and move to confirmation
          return this.handlePrerequisiteCheck("", sessionId);

        case "complete_prereqs":
          // Prerequisites completed, show confirmation
          await this.updateContext(sessionId, { step: FlowStep.CONFIRMATION });
          return this.handleConfirmation("", sessionId);

        case "confirm_registration":
          // Step 7 → Step 8: Final confirmation
          await this.updateContext(sessionId, {
            confirmed: true,
            step: FlowStep.COMPLETED
          });
          this.logAction("registration_completed", { sessionId, program: context.program?.name });
          
          // PHASE 1: Log successful registration
          if (userId) {
            await logAudit({
              user_id: userId,
              action: 'registration_completed',
              provider: context.provider?.orgRef,
              org_ref: context.provider?.orgRef,
              program_ref: context.program?.id,
              metadata: { sessionId, program: context.program?.name }
            });
          }
          
          return this.formatResponse(
            `🎉 Registration submitted successfully! ${context.child?.name || 'Your child'} is enrolled in **${context.program?.name}** at **${context.provider?.name}**.\n\nYou'll receive a confirmation email shortly. ${AUDIT_REMINDER}`,
            undefined,
            undefined,
            {}
          );

        case "reconnect_login": {
          console.log('[handleAction] User requested secure reconnection');
          
          // Clear old mandate and session
          await this.updateContext(sessionId, {
            mandate_jws: undefined,
            mandate_id: undefined,
            session_token: undefined,
            loginCompleted: false
          } as any);
          
          // Return to login step
          return {
            message: "Let's get you reconnected securely. I'll need your login credentials again.",
            cards: [{
              title: "🔐 Secure Login",
              description: "Your credentials are encrypted and never stored by SignupAssist.",
              buttons: [{
                label: "Enter Credentials",
                action: "show_credentials_card",
                variant: "accent" as const
              }]
            }],
            contextUpdates: {
              step: FlowStep.LOGIN,
              pendingLogin: context.provider
            }
          };
        }

        case "cancel_registration":
        case "cancel":
          // User cancelled, polite acknowledgement
          await this.updateContext(sessionId, { step: FlowStep.PROVIDER_SEARCH });
          return this.formatResponse(
            "No worries! Feel free to start over whenever you're ready.",
            undefined,
            [{ label: "Start Over", action: "reset", variant: "accent" }],
            {}
          );

        case "credentials_submitted":
          // Handle callback after user enters credentials
          const { credential_id, cookies } = payload;
          
          // Login first to get session_token
          console.log('[credentials_submitted] Performing login to get session token...');
          const loginResult = await this.callTool('scp.login', {
            credential_id,
            org_ref: context.provider?.orgRef || 'blackhawk-ski',
            user_jwt: context.user_jwt ?? userJwt
          });
          
          if (!loginResult.success) {
            return this.formatResponse(
              `❌ Login failed: ${loginResult.error || 'Unknown error'}. Please try again.`,
              undefined,
              [{ label: "Retry Login", action: "show_credentials_card", variant: "accent" }],
              {}
            );
          }
          
          console.log('[credentials_submitted] Login successful, session_token:', loginResult.session_token);
          
          // FIX: Preserve provider, user_jwt, and session_token in context before auto-discovery
          await this.updateContext(sessionId, {
            provider: context.provider || { name: 'Blackhawk Ski Club', orgRef: 'blackhawk-ski' },
            user_jwt: context.user_jwt ?? userJwt,  // Preserve JWT from parameter or context
            credential_id,
            session_token: loginResult.session_token,  // Store session token for reuse
            provider_cookies: cookies || [],
            loginCompleted: true,
            step: FlowStep.PROGRAM_SELECTION  // Skip INTENT_CAPTURE
          });
          
          // Audit logging
          const credentialUserId = extractUserIdFromJWT(context.user_jwt);
          if (credentialUserId && credential_id) {
            await logAudit({
              user_id: credentialUserId,
              action: 'credentials_submitted',
              provider: context.provider?.orgRef,
              org_ref: context.provider?.orgRef,
              credential_id,
              metadata: { sessionId }
            });
          }
          
          const providerName = context.provider?.name || "your provider";
          const hasSessionToken = !!context.provider_session_token;
          console.log(`[credentials_submitted] Auto-triggering program discovery for: ${providerName}`);
          console.log(`[credentials_submitted] ${hasSessionToken ? '✅ Reusing session from token' : '🔁 New session will be created'}`);
          
          // Use V2 post-login message
          const postLoginMessage = getMessageForState("post_login_v2", { 
            provider_name: providerName 
          });
          
          // Immediately trigger program discovery (no user input required)
          try {
            const discoveryResult = await this.handleAutoProgramDiscovery(sessionId);
            
            // Return combined response: post-login message + discovery results
            return {
              message: postLoginMessage + "\n\n" + discoveryResult.message,
              cards: discoveryResult.cards,
              cta: discoveryResult.cta,
              contextUpdates: discoveryResult.contextUpdates,
              componentType: discoveryResult.componentType,
              componentPayload: discoveryResult.componentPayload
            };
            
          } catch (error: any) {
            Logger.error('[credentials_submitted] Auto-discovery failed:', error);
            
            // Store retry count
            const retryCount = (context as any).discovery_retry_count || 0;
            await this.updateContext(sessionId, { 
              discovery_retry_count: retryCount + 1 
            } as any);
            
            // Return error with retry option
            const errorMsg = getMessageForState("program_discovery_error", {
              provider_name: providerName
            });
            
            return this.formatResponse(
              postLoginMessage + "\n\n" + errorMsg,
              [],
              [{ label: "Retry", action: "retry_program_discovery", variant: "accent" }],
              {}
            );
          }
        
        // Removed intent button handlers - now using text-based intent parsing

        case "view_category":
          // User clicked a category card, show filtered programs
          const viewCategory = payload.category;
          const programIds = payload.programIds || [];
          
          // Retrieve full program list from context
          const allPrograms = context.availablePrograms || [];
          const filteredPrograms = allPrograms.filter((p: any) => 
            programIds.includes(p.id)
          );
          
          if (filteredPrograms.length === 0) {
            return this.formatResponse(
              `Hmm, I couldn't find programs in that category. Let's try viewing all programs.`,
              undefined,
              [{ label: "View All Programs", action: "view_all_programs", variant: "accent" }],
              {}
            );
          }
          
          // Show 5-7 programs from this category
          const displayPrograms = filteredPrograms.slice(0, 7);
          const cards = this.buildProgramCards(displayPrograms);
          
          const moreCount = filteredPrograms.length - displayPrograms.length;
          const message = moreCount > 0
            ? `Here are ${displayPrograms.length} ${viewCategory} programs (${moreCount} more available) 👇`
            : `Here are all ${displayPrograms.length} ${viewCategory} programs 👇`;
          
          return this.formatResponse(
            message,
            cards,
            moreCount > 0 
              ? [{ label: `Show ${moreCount} More ${viewCategory}`, action: "view_more_programs", variant: "outline" }]
              : undefined,
            { 
              currentCategory: viewCategory,
              displayedProgramIds: displayPrograms.map((p: any) => p.id),
              remainingProgramIds: filteredPrograms.slice(7).map((p: any) => p.id)
            }
          );

        case "view_all_programs":
          // Show all programs without categorization
          const allProgs = context.availablePrograms || [];
          const allCards = this.buildProgramCards(allProgs.slice(0, 10));
          
          return this.formatResponse(
            `Here are the first 10 programs (${allProgs.length} total) 👇`,
            allCards,
            allProgs.length > 10 
              ? [{ label: "Show More", action: "view_more_programs", variant: "outline" }]
              : undefined,
            {}
          );

        case "view_more_programs":
          // Load next batch of programs from current category or all programs
          const displayed = context.displayedProgramIds || [];
          const remaining = context.remainingProgramIds || [];
          
          if (remaining.length === 0) {
            return this.formatResponse(
              "✅ You've seen all available programs!",
              undefined,
              [{ label: "Back to Categories", action: "back_to_categories", variant: "accent" }],
              {}
            );
          }
          
          const allProgsForMore = context.availablePrograms || [];
          const nextBatch = allProgsForMore
            .filter((p: any) => remaining.includes(p.id))
            .slice(0, 7);
          
          const moreCards = this.buildProgramCards(nextBatch);
          const stillRemaining = remaining.length - nextBatch.length;
          
          return this.formatResponse(
            `Here are ${nextBatch.length} more programs ${stillRemaining > 0 ? `(${stillRemaining} remaining)` : ""} 👇`,
            moreCards,
            stillRemaining > 0
              ? [{ label: `Show ${stillRemaining} More`, action: "view_more_programs", variant: "outline" }]
              : undefined,
            {
              displayedProgramIds: [...displayed, ...nextBatch.map((p: any) => p.id)],
              remainingProgramIds: remaining.slice(7)
            }
          );

        case "back_to_categories":
          // Return to category view
          const categorySummary = context.programSummary;
          if (!categorySummary) {
            return this.formatResponse(
              "Let's reload the programs.",
              undefined,
              [{ label: "Reload Programs", action: "check_programs", variant: "accent" }],
              {}
            );
          }
          
          const catCards = this.buildCategoryCards(categorySummary.categories);
          return this.formatResponse(
            "Here are the program categories again 👇",
            catCards,
            undefined,
            { showingCategories: true }
          );

        case "select_program":
          const { program_ref, program_id } = payload || {};
          
          if (!program_ref && !program_id) {
            return this.formatResponse(
              "I'm not sure which program you selected. Can you try again?",
              [],
              [],
              {}
            );
          }
          
          // Find the program name from context for acknowledgement
          const selectedProgramData = context.availablePrograms?.find(
            (p: any) => p.id === program_ref || p.id === program_id || p.program_ref === program_ref
          );
          const programName = selectedProgramData?.title || "this program";
          
          await this.updateContext(sessionId, {
            selectedProgram: program_ref || program_id,
            step: FlowStep.FIELD_PROBE
          });
          
          // Use template: ASSISTANT__ACK_SELECTION (Block 12)
          const ackMessage = getMessageForState("selection_ack", {
            program_name: programName
          });
          
          // Show acknowledgement before proceeding to field probe
          // The actual field probe will happen on next interaction or automatically
          return this.formatResponse(
            ackMessage,
            undefined,
            [{ label: "Continue", action: "continue_to_field_probe", variant: "accent" }],
            {}
          );
        
        case "continue_to_field_probe":
          // Proceed with field discovery after acknowledgement
          const selectedProg = context.selectedProgram;
          if (!selectedProg) {
            return this.formatResponse(
              "I'm not sure which program to proceed with. Can you select one again?",
              [],
              [],
              {}
            );
          }
          return this.handleFieldProbe(selectedProg, sessionId);
        
      case "retry_program_search":
        const ctx = await this.getContext(sessionId);
        const retryCategory = ctx.programIntent?.category || "lessons";
        return this.handleProgramSearch(retryCategory, sessionId);

        case "retry_program_discovery":
          // User clicked retry after auto-discovery failed
          const retryCount = (context as any).discovery_retry_count || 0;
          const MAX_RETRIES = 2;
          
          // Check if max retries exceeded
          if (retryCount >= MAX_RETRIES) {
            Logger.warn(`[retry_program_discovery] Max retries (${MAX_RETRIES}) exceeded`);
            return this.formatResponse(
              `I've tried a few times but the page isn't loading properly. Let's reconnect to make sure we have a fresh session.`,
              [],
              [{ label: "Reconnect", action: "connect_account", variant: "accent" }],
              { discovery_retry_count: 0 }
            );
          }
          
          // Add 5-second delay before retry (simulated with immediate execution + message)
          Logger.info(`[retry_program_discovery] Retry attempt ${retryCount + 1}/${MAX_RETRIES}`);
          
          try {
            const retryResult = await this.handleAutoProgramDiscovery(sessionId);
            
            // Reset retry count on success
            await this.updateContext(sessionId, { discovery_retry_count: 0 } as any);
            
            return retryResult;
          } catch (error: any) {
            const errorMsg = getMessageForState("program_discovery_error", {
              provider_name: context.provider?.name
            });
            
            // Increment retry count
            await this.updateContext(sessionId, { 
              discovery_retry_count: retryCount + 1 
            } as any);
            
            return this.formatResponse(
              errorMsg,
              [],
              [{ label: "Try Again", action: "retry_program_discovery", variant: "accent" }],
              {}
            );
          }

        case "reset":
        case "retry_search":
        case "retry_programs":
        case "retry_prereqs":
        case "retry_last":
          // Reset to provider search
          this.resetContext(sessionId);
          return this.formatResponse(
            "Let's start fresh! What provider are you looking for?",
            undefined,
            undefined,
            { step: FlowStep.PROVIDER_SEARCH }
          );

        default:
          // Unknown action
          Logger.warn(`Unknown action: ${action}`);
          return this.formatResponse(
            "Hmm, I'm not sure what to do with that. Let's start over.",
            undefined,
            [{ label: "Restart", action: "reset", variant: "accent" }],
            {}
          );
      }
    } catch (error: any) {
      Logger.error(`Action handler failed: ${error.message}`);
      return this.formatResponse(
        "Oops, something went wrong while processing that. Let's try again securely.",
        undefined,
        [{ label: "Retry", action: "retry_last", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Call a tool/helper function
   * PHASE 3: Real MCP integration with retry and timeout
   * 
   * Integrates with MCP tools like:
   * - scp.check_prerequisites
   * - scp.discover_required_fields
   * - scp.submit_registration
   * 
   * @param toolName - Name of the tool to invoke
   * @param args - Arguments to pass to the tool
   * @returns Promise resolving to tool execution result
   */
  async callTool(toolName: string, args: Record<string, any>, sessionId?: string): Promise<any> {
    const cacheKey = `${toolName}-${JSON.stringify(args)}`;
    if (this.isCacheValid(cacheKey)) {
      Logger.info(`Cache hit for ${cacheKey}`);
      return this.getFromCache(cacheKey).value;
    }

    // ======= MANDATE ENFORCEMENT =======
    const isProtectedTool = [
      'scp.login',
      'scp.find_programs',
      'scp.register',
      'scp.pay',
      'scp.discover_required_fields'
    ].includes(toolName);
    
    if (isProtectedTool && sessionId) {
      try {
        // Step 1: Ensure mandate present
        await this.ensureMandatePresent(sessionId, toolName);
        
        // Step 2: Attach mandate to args
        args = this.attachMandateToArgs(sessionId, args);
        
        console.log('[Orchestrator] 🔒 Protected tool call with mandate:', toolName);
      } catch (mandateError: any) {
        console.error('[Orchestrator] ❌ Mandate enforcement failed:', mandateError);
        
        // Return user-friendly error instead of throwing
        return {
          success: false,
          error: 'mandate_verification_failed',
          message: '🔐 Unable to verify authorization. Let\'s reconnect securely.',
          recovery_action: 'reconnect_login'
        };
      }
    }

    // PHASE 3: Real MCP HTTP endpoint integration
    const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8080';
    const USE_REAL_MCP = process.env.USE_REAL_MCP === 'true';

    // Map internal tool names to MCP tool names
    const mcpToolMapping: Record<string, string> = {
      'search_provider': 'scp.search_providers',
      'find_programs': 'scp.get_programs',
      'check_prerequisites': 'scp.check_prerequisites',
      'discover_fields': 'scp.discover_required_fields',
      'submit_registration': 'scp.submit_registration',
      'program_field_probe': 'scp.program_field_probe'
    };

    const mcpToolName = mcpToolMapping[toolName];

    // If MCP integration enabled and tool is mapped, use real MCP
    if (USE_REAL_MCP && mcpToolName) {
      try {
        Logger.info(`[MCP] Calling real tool: ${mcpToolName}`, this.sanitize(args));
        
        // PHASE 5: Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch(`${MCP_SERVER_URL}/tools/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool: mcpToolName,
            args
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        
        // Check for mandate expiry in response
        if (result.error && typeof result.error === 'string' && 
            (result.error.includes('Mandate') || result.error.includes('mandate')) && 
            (result.error.includes('expired') || result.error.includes('verification failed')) &&
            sessionId) {
          console.log('[Orchestrator] 🔄 Mandate expired during call, retrying once...');
          
          // Force refresh mandate
          await this.updateContext(sessionId, { mandate_jws: undefined, mandate_id: undefined } as any);
          await this.ensureMandatePresent(sessionId, toolName);
          
          // Retry once
          args = this.attachMandateToArgs(sessionId, args);
          const retryResponse = await fetch(`${MCP_SERVER_URL}/tools/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: mcpToolName,
              args
            })
          });
          
          const retryResult = await retryResponse.json();
          this.saveToCache(cacheKey, retryResult);
          return retryResult;
        }
        
        this.saveToCache(cacheKey, result);
        Logger.info(`[MCP] Tool ${mcpToolName} succeeded`);
        return result;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          Logger.error(`[MCP] Tool ${mcpToolName} timed out after 30 seconds`);
          throw new Error('This is taking longer than expected. Please try again.');
        }
        Logger.error(`[MCP] Tool ${mcpToolName} failed:`, error.message);
        // PHASE 5: Fall through to mock tools for development
        Logger.warn(`[MCP] Falling back to mock tool for ${toolName}`);
      }
    }

    // Call MCP tools through the server if available, otherwise use fallback
    if (!this.mcpToolCaller) {
      Logger.warn(`[callTool] No MCP tool caller configured, using fallback for: ${toolName}`);
      return this.callToolFallback(toolName, args);
    }

    try {
      Logger.info(`Calling MCP tool: ${toolName}`, this.sanitize(args));
      Logger.info(`[Audit] Tool call`, { toolName, args: this.sanitize(args) });
      
      // Try calling the tool once to check if it exists
      const result = await this.mcpToolCaller!(toolName, args);
      this.saveToCache(cacheKey, result);
      Logger.info(`Tool ${toolName} succeeded.`);
      return result;
    } catch (error: any) {
      // If tool not found in MCP registry, immediately use fallback (don't retry)
      if (error.message && error.message.includes('Unknown MCP tool')) {
        Logger.info(`Tool ${toolName} not in MCP registry, using fallback`);
        return this.callToolFallback(toolName, args);
      }
      
      // For other errors (network, etc.), retry with exponential backoff
      Logger.warn(`Tool ${toolName} failed, retrying...`, error.message);
      try {
        const result = await this.withRetry(() => this.mcpToolCaller!(toolName, args), 3);
        this.saveToCache(cacheKey, result);
        Logger.info(`Tool ${toolName} succeeded after retry.`);
        return result;
      } catch (retryError: any) {
        Logger.error(`Tool ${toolName} failed permanently:`, retryError);
        throw retryError;
      }
    }
  }

  /**
   * Fallback tool implementation for when MCP server is not available
   */
  private async callToolFallback(toolName: string, args: any = {}): Promise<any> {
    // Stubbed tools - for local development when MCP not available
    const tools: Record<string, Function> = {
      search_provider: async ({ name, location, userCoords }: any) => {
        try {
          Logger.info("[search_provider] Starting search", { name, location, hasCoords: !!userCoords });
          
          const cacheKey = `provider-${name}-${location || ""}-${userCoords ? `${userCoords.lat},${userCoords.lng}` : ""}`;
          if (this.isCacheValid(cacheKey)) {
            Logger.info("[search_provider] Cache hit", { name, location, hasCoords: !!userCoords });
            return this.getFromCache(cacheKey).value;
          }

          // Try local first
          Logger.info("[search_provider] Checking local providers...");
          const local = await lookupLocalProvider(name);
          if (local) {
            Logger.info("[search_provider] ✅ Found locally:", local.name);
            this.saveToCache(cacheKey, [local]);
            return [local];
          }
          Logger.info("[search_provider] Not found locally, trying Google API...");

          // Try Google API
          const googleResults = await googlePlacesSearch(name, location, userCoords);
          Logger.info("[search_provider] Google API returned", { count: googleResults.length });

          if (googleResults.length) {
            Logger.info("[search_provider] ✅ Found via Google", { count: googleResults.length, hasDistances: !!googleResults[0]?.distance });
            this.saveToCache(cacheKey, googleResults);
            return googleResults;
          }

          Logger.warn("[search_provider] No results found");
          return [];
          
        } catch (error: any) {
          Logger.error("[search_provider] ERROR:", {
            message: error.message,
            stack: error.stack?.split('\n')[0],
            name, 
            location, 
            hasCoords: !!userCoords
          });
          throw error;
        }
      },
      find_programs: async ({ provider }: any) => [
        { name: "Beginner Ski Class – Saturdays", id: "prog1" },
        { name: "Intermediate Ski Class – Sundays", id: "prog2" },
      ],
      check_prerequisites: async () => ({ membership: "ok", payment: "ok" }),
    };

    const tool = tools[toolName];
    if (!tool) {
      Logger.error(`Unknown tool: ${toolName}`);
      throw new Error(`Unknown tool: ${toolName}`);
    }

    Logger.info(`Calling fallback tool: ${toolName}`, this.sanitize(args));
    const result = await this.withRetry(() => tool(args), 3);
    Logger.info(`Fallback tool ${toolName} succeeded.`);
    return result;
  }

  /**
   * Get prompt template for specific signup step
   * 
   * @param step - Name of the step (providerSearch, programSelection, etc.)
   * @returns Template string for that step
   */
  getPromptTemplate(step: string): string {
    return this.promptTemplates[step] || "";
  }

  /**
   * Log interaction for debugging and monitoring
   * Truncates long messages and avoids logging sensitive data
   * 
   * @param sessionId - Session identifier
   * @param role - user or assistant
   * @param content - Message content
   */
  private logInteraction(sessionId: string, role: string, content: string): void {
    const preview = content.length > 120 ? content.slice(0, 120) + "…" : content;
    console.log(`[${sessionId}] ${role}: ${preview}`);
  }

  /**
   * Log full context snapshot for debugging
   * Visualizes current session state
   * 
   * @param sessionId - Session identifier
   */
  private logContext(sessionId: string): void {
    Logger.info(`[Context Snapshot] ${sessionId}`, this.sessions[sessionId]);
  }

  /**
   * Cache management helpers
   */
  private getFromCache(key: string) {
    return this.cache[key];
  }

  private saveToCache(key: string, value: any, ttlMs = 300000) { // 5 min default
    this.cache[key] = { value, expires: Date.now() + ttlMs };
  }

  private isCacheValid(key: string): boolean {
    const item = this.cache[key];
    return !!item && item.expires > Date.now();
  }

  /**
   * Lookup stored credentials for a provider
   * Retrieves credential_id from Supabase for use with scp.login
   * 
   * @param userId - User ID from JWT
   * @param provider - Provider slug (e.g., 'skiclubpro')
   * @param orgRef - Organization reference (e.g., 'blackhawk-ski')
   * @returns Promise resolving to credential record or null
   */
  private async lookupStoredCredential(
    userId: string | undefined, 
    provider: string, 
    orgRef: string
  ): Promise<{ id: string; alias: string } | null> {
    if (!userId) {
      Logger.warn("[orchestrator] No user_id provided for credential lookup");
      return null;
    }

    try {
      // Import Supabase client from sessionPersistence (already configured there)
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.SB_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY || '';
      
      if (!supabaseUrl || !supabaseKey) {
        Logger.warn("[orchestrator] Supabase credentials not configured - cannot lookup stored credentials");
        return null;
      }
      
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      Logger.info(`[orchestrator] Looking up credentials for user=${userId}, provider=${provider}, org=${orgRef}`);
      
      const { data, error } = await supabase
        .from('stored_credentials')
        .select('id, alias')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found - user hasn't connected account yet
          Logger.info(`[orchestrator] No stored credentials found for user=${userId}, provider=${provider}`);
          return null;
        }
        Logger.error("[orchestrator] Supabase error looking up credentials:", error);
        return null;
      }
      
      if (!data) {
        Logger.info(`[orchestrator] No credentials found for user=${userId}, provider=${provider}`);
        return null;
      }
      
      Logger.info(`[orchestrator] Retrieved credential_id=${data.id} for ${provider}`);
      return data;
    } catch (error) {
      Logger.error("[orchestrator] Failed to lookup credentials:", error);
      return null;
    }
  }

  // ============= Mandate Enforcement Methods =============

  /**
   * Ensure a valid mandate exists in context, creating one if needed
   */
  private async ensureMandatePresent(sessionId: string, toolName?: string): Promise<void> {
    const context = await this.getContext(sessionId);
    
    // Check if we have a mandate_jws in context
    if (context.mandate_jws) {
      // Verify it's still valid
      try {
        const { verifyMandate } = await import('../lib/mandates.js');
        await verifyMandate(
          context.mandate_jws,
          'scp:authenticate', // Basic scope check
          { now: new Date() }
        );
        console.log('[Orchestrator] ✅ Existing mandate valid');
        return; // Mandate is good
      } catch (err) {
        console.log('[Orchestrator] 🔄 Existing mandate expired, refreshing...');
        // Fall through to create new one
      }
    }
    
    // No valid mandate - create one
    if (!context.user_jwt) {
      throw new Error('Cannot create mandate: user_jwt missing from context');
    }
    
    if (!context.provider?.orgRef) {
      throw new Error('Cannot create mandate: provider not selected');
    }
    
    // Extract user_id from JWT
    const userId = extractUserIdFromJWT(context.user_jwt);
    if (!userId) {
      throw new Error('Cannot create mandate: invalid user_jwt');
    }
    
    // Get tool-specific scopes
    const { getScopesForTool, MANDATE_SCOPES, createOrRefreshMandate } = await import('../lib/mandates.js');
    const requiredScopes = getScopesForTool(toolName || '') || [
      MANDATE_SCOPES.AUTHENTICATE,
      MANDATE_SCOPES.READ_LISTINGS
    ];
    
    // Import Supabase client
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create/refresh mandate
    const { mandate_id, mandate_jws } = await createOrRefreshMandate(
      supabase,
      userId,
      'skiclubpro',
      context.provider.orgRef,
      requiredScopes,
      {
        childId: context.child?.id,
        programRef: context.program?.id,
        maxAmountCents: 50000 // $500 default cap
      }
    );
    
    // Store in context
    await this.updateContext(sessionId, {
      mandate_id,
      mandate_jws
    } as any);
    
    console.log('[Orchestrator] ✅ Mandate created and stored in context');
  }

  /**
   * Attach mandate to tool arguments
   */
  private attachMandateToArgs(sessionId: string, args: any): any {
    const context = this.sessions[sessionId];
    
    return {
      ...args,
      mandate_id: context?.mandate_id,
      mandate_jws: context?.mandate_jws,
      user_jwt: context?.user_jwt
    };
  }

  /**
   * Sanitize sensitive data before logging
   * Strips PII and payment information to prevent accidental leakage
   * 
   * @param obj - Object to sanitize
   * @returns Sanitized copy of the object
   */
  private sanitize(obj: Record<string, any>): Record<string, any> {
    const clone = JSON.parse(JSON.stringify(obj));
    if (clone.password) clone.password = "***";
    if (clone.cardNumber) clone.cardNumber = "***";
    if (clone.ssn) clone.ssn = "***";
    if (clone.apiKey) clone.apiKey = "***";
    return clone;
  }

  /**
   * Format standardized response object (NEW: Card-Native Structure)
   * Ensures consistent UI payload structure across all handlers
   * 
   * @param message - Assistant message to display
   * @param cards - Optional array of cards to render
   * @param cta - Optional call-to-action buttons
   * @param updates - Context updates to apply
   * @returns Standardized OrchestratorResponse object
   */
  private formatResponse(
    message: string,
    cards?: CardSpec[],
    cta?: CTASpec[],
    updates: Record<string, any> = {}
  ): OrchestratorResponse {
    return {
      message,
      cards,
      cta,
      // Legacy support for backward compatibility
      uiPayload: cards ? { type: "cards", cards, cta } : { type: "message" },
      contextUpdates: updates,
    };
  }

  /**
   * Log audit action for responsible delegation
   * 
   * @param action - Action type
   * @param data - Action metadata (sanitized)
   */
  private logAction(action: string, data: Record<string, any>): void {
    const sanitized = this.sanitize(data);
    Logger.info(`[Audit] ${action}`, sanitized);
  }

  /**
   * Log context snapshot for debugging
   * 
   * @param sessionId - Session identifier
   */
  private async logContextSnapshot(sessionId: string): Promise<void> {
    const context = await this.getContext(sessionId);
    console.log('[CONTEXT]', JSON.stringify({
      sessionId,
      step: context.step,
      provider: context.provider?.name,
      program: context.program?.name,
      loginCompleted: context.loginCompleted,
      confirmed: context.confirmed
    }, null, 2));
  }

  /**
   * Build provider selection cards
   * Displays search results with clear selection options
   * 
   * @param results - Array of provider search results
   * @returns Array of CardSpec objects
   */
  private buildProviderCards(results: any[]): CardSpec[] {
    return results.map(provider => {
      let subtitle = provider.city ? `${provider.city}, ${provider.state || ''}` : provider.address || '';
      // Add distance if available
      if (provider.distance !== undefined) {
        subtitle += ` • ${provider.distance}km away`;
      }
      return {
        title: provider.name,
        subtitle,
        metadata: { 
          name: provider.name,
          orgRef: provider.orgRef, 
          source: provider.source, 
          distance: provider.distance,
          city: provider.city,
          state: provider.state
        },
        buttons: [
          { label: "Yes", action: "select_provider", variant: "accent" as const },
          { label: "Show Me Others", action: "reject_provider", variant: "outline" as const }
        ]
      };
    });
  }

  /**
   * Build program selection cards (carousel)
   * Shows available programs with enrollment options
   * 
   * @param programs - Array of program objects
   * @returns Array of CardSpec objects
   */
  private buildProgramCards(programs: any[]): CardSpec[] {
    return programs.map(program => ({
      title: program.name,
      subtitle: program.schedule || 'Schedule TBD',
      description: program.description || '',
      metadata: { id: program.id, price: program.price },
      buttons: [
        { label: "Enroll", action: "select_program", variant: "accent" as const }
      ]
    }));
  }

  /**
   * Summarize and categorize a large list of programs using AI
   * Groups programs by type (Lessons, Teams, Events, Memberships)
   * Returns category summary with representative examples
   * 
   * @param programs - Array of program objects
   * @returns Promise resolving to category summary
   */
  private async summarizePrograms(programs: any[]): Promise<{
    categories: Array<{
      name: string;
      count: number;
      examples: string[];
      programIds: string[];
    }>;
  }> {
    try {
      // Prepare simplified program data for AI (avoid token bloat)
      const simplifiedPrograms = programs.slice(0, 50).map(p => ({
        name: p.name || p.title,
        id: p.id,
        price: p.price
      }));

      const completion = await this.openai.chat.completions.create({
        model: "gpt-5-mini-2025-08-07",  // Reasoning capability for flow accuracy
        messages: [
          {
            role: "system",
            content: `Analyze these programs and group them into categories like:
- Lessons (beginner, intermediate, advanced classes)
- Race Teams (competitive programs, BART, masters)
- Events (clinics, camps, special events)
- Memberships (season passes, family memberships)

Return JSON: {
  "categories": [
    {
      "name": "Lessons",
      "count": 20,
      "examples": ["First Flight", "Second Flight"],
      "programIds": ["id1", "id2", ...]
    }
  ]
}`
          },
          {
            role: "user",
            content: JSON.stringify(simplifiedPrograms)
          }
        ],
        response_format: { type: "json_object" }
      });

      let text = completion.choices[0]?.message?.content || '{"categories":[]}';
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '').trim();
      const result = JSON.parse(text);
      
      Logger.info('[AI Summarizer] Categorized programs', {
        inputCount: programs.length,
        categoryCount: result.categories?.length || 0
      });
      
      return result;
    } catch (error: any) {
      Logger.error('[AI Summarizer] Failed:', error.message);
      // Fallback: return all programs in one generic category
      return {
        categories: [{
          name: "Programs",
          count: programs.length,
          examples: programs.slice(0, 3).map(p => p.name || p.title),
          programIds: programs.map(p => p.id)
        }]
      };
    }
  }

  /**
   * Build category summary cards (for 10+ programs)
   * Shows high-level categories instead of individual programs
   * 
   * @param categories - Array of category objects
   * @returns Array of CardSpec objects
   */
  private buildCategoryCards(categories: Array<{
    name: string;
    count: number;
    examples: string[];
    programIds: string[];
  }>): CardSpec[] {
    return categories.map(cat => ({
      title: `${cat.name} (${cat.count})`,
      subtitle: `Examples: ${cat.examples.slice(0, 2).join(", ")}`,
      description: `${cat.count} ${cat.name.toLowerCase()} available`,
      metadata: { 
        category: cat.name, 
        programIds: cat.programIds 
      },
      buttons: [
        { 
          label: `View ${cat.name}`, 
          action: "view_category", 
          variant: "accent" as const 
        }
      ]
    }));
  }

  /**
   * Build confirmation card for final registration
   * Displays summary before submission
   * 
   * @param context - Current session context
   * @returns CardSpec object
   */
  private buildConfirmationCard(context: SessionContext): CardSpec {
    const provider = context.provider?.name || 'Provider';
    const program = context.program?.name || 'Program';
    const child = context.child?.name || 'Child';
    
    return {
      title: "Confirm Registration",
      subtitle: `${child} → ${program}`,
      description: `Provider: ${provider}\n${AUDIT_REMINDER}`,
      buttons: [
        { label: "✅ Confirm & Register", action: "confirm_registration", variant: "accent" as const },
        { label: "Cancel", action: "cancel_registration", variant: "outline" as const }
      ]
    };
  }

  /**
   * Generate security reminder message
   * Reassures users about data security during sensitive operations
   * 
   * @param provider - Optional provider name to personalize message
   * @returns Security reminder message string
   */
  private securityReminder(provider?: string): string {
    const source = provider ? provider : "your provider";
    return `🔒 Your data and payment info stay secure with ${source}; SignupAssist never stores card numbers.`;
  }

  /**
   * Validate Design DNA visual rhythm compliance
   * Ensures every response follows the message → card → CTA pattern
   * 
   * @param response - OrchestratorResponse to validate
   */
  private validateRhythm(response: OrchestratorResponse): void {
    const hasMessage = !!response.message;
    if (!hasMessage) {
      Logger.warn("[DesignDNA] Missing assistant message (message → card → CTA pattern violation).");
    }
    // Cards and CTAs are optional but recommended for interactive steps
  }

  /**
   * AI-assisted provider input parsing
   * Uses OpenAI to extract provider name and city from complex or misspelled queries
   * Falls back to heuristic parser on failure
   * 
   * @param userInput - Raw user input string
   * @returns Parsed provider information
   */
  private async aiParseProviderInput(userInput: string): Promise<ParsedProviderInput> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-5-mini-2025-08-07",  // Validation capability for key consistency
        messages: [
          { 
            role: "system", 
            content: "Extract provider name and city from input. Return JSON with 'name' and 'city' fields. If city is not mentioned, omit the city field." 
          },
          { role: "user", content: userInput }
        ],
        response_format: { type: "json_object" }
      });
      let text = completion.choices[0]?.message?.content || "{}";
      // Strip markdown code blocks even with json_object mode (OpenAI bug workaround)
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '').trim();
      const parsed = JSON.parse(text);
      return { raw: userInput, name: parsed.name || userInput, city: parsed.city };
    } catch (error) {
      Logger.warn("[AI Parser] Failed, falling back to heuristic parser:", error);
      return parseProviderInput(userInput);
    }
  }

  /**
   * Retry helper for handling transient errors
   * Uses exponential backoff with enhanced logging
   * 
   * @param fn - Async function to retry
   * @param retries - Number of retry attempts remaining
   * @param delay - Initial delay in milliseconds
   * @returns Promise resolving to function result
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries <= 0) {
        Logger.error("OpenAI call failed permanently:", error.message);
        throw error;
      }
      Logger.warn(`OpenAI error: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return this.withRetry(fn, retries - 1, delay * 2); // exponential backoff
    }
  }

  /**
   * Log error for debugging
   * 
   * @param sessionId - Session identifier
   * @param errorMessage - Error message to log
   */
  private logError(sessionId: string, errorMessage: string): void {
    Logger.error(`[${sessionId}] ERROR:`, errorMessage);
  }

  /**
   * Determine the current step of the signup flow
   * Returns the phase label based on what information is present in context
   * 
   * @param userMessage - User's current input
   * @param context - Current session context
   * @returns Step identifier string (provider_search, login, program_selection, etc.)
   */
  private determineStep(userMessage: string, context: Record<string, any>): string {
    if (!context.provider) return "provider_search";
    if (context.provider && !context.loginCompleted) return "login";
    if (context.provider && !context.program) return "program_selection";
    if (context.program && !context.prerequisites) return "prerequisite_check";
    if (context.program && context.prerequisites && !context.formAnswers) return "form_fill";
    if (context.formAnswers && !context.confirmed) return "confirmation";
    return "completed";
  }

  /**
   * Dispatch to the correct handler based on current signup step
   * Routes user interaction to the appropriate step-specific handler
   * 
   * @param step - Current step identifier
   * @param userMessage - User's input message
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse
   */
  private async handleStep(step: string, userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    switch (step) {
      case "provider_search":
        return await this.handleProviderSearch(userMessage, sessionId);
      case "login":
        return await this.handleLoginStep(userMessage, sessionId);
      case "intent_capture":
        return await this.handleIntentCapture(userMessage, sessionId);
      case "field_probe":
        return await this.handleFieldProbe(userMessage, sessionId);
      case "program_selection":
        return await this.handleProgramSelection(userMessage, sessionId);
      case "prerequisite_check":
        return await this.handlePrerequisiteCheck(userMessage, sessionId);
      case "form_fill":
        return await this.handleFormFill(userMessage, sessionId);
      case "confirmation":
        return await this.handleConfirmation(userMessage, sessionId);
      default:
        return this.formatResponse(
          "🎉 All steps complete!",
          [],
          []
        );
    }
  }

  /**
   * Handle provider search step (Step 3: Provider Discovery)
   * Searches for activity providers and returns cards
   * 
   * @param userMessage - User's search query
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with provider cards
   */
  private async handleProviderSearch(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    this.logAction("tool_invocation", { toolName: "search_provider", sessionId });
    
    // Cache parsed results to reduce API calls and latency
    const cacheKey = `parsed-${userMessage.toLowerCase()}`;
    let parsed: ParsedProviderInput;
    
    if (this.isCacheValid(cacheKey)) {
      Logger.info("Cache hit for parsed input");
      parsed = this.getFromCache(cacheKey).value;
    } else {
      parsed = await this.aiParseProviderInput(userMessage);
      this.saveToCache(cacheKey, parsed);
    }
    
    Logger.info(`[ProviderSearch] Parsed input`, parsed);
    
    // Validation guard - ensure we have a usable name
    if (!parsed.name) {
      return this.formatResponse(
        "Hmm, I couldn't tell which organization you meant. Could you type the name again with a city or keyword?",
        undefined,
        [{ label: "Try Again", action: "retry_search", variant: "outline" }],
        {}
      );
    }
    
    const name = parsed.name;
    const location = parsed.city;
    
    try {
      // Get userLocation from context if available
      const context = this.getContext(sessionId);
      const userCoords = (context as any).userLocation;
      
      const results = await this.callTool("search_provider", { name, location, userCoords });
      
      if (results.length === 0) {
        return this.formatResponse(
          `🤔 I couldn't find a provider named **${name}**${location ? " in " + location : ""}. Could you double-check the spelling or try a different search?`,
          undefined,
          [{ label: "Search Again", action: "retry_search", variant: "accent" }],
          { lastSearch: parsed }
        );
      }
      
      let message = results.length === 1 
        ? `🔍 Great! Is this what you're looking for?`
        : `🔍 I found ${results.length} matches. Which one is yours?`;
      
      // Add transparency note when location-based search is used
      if (userCoords) {
        message += `\n\n_Results are shown near your general area._`;
      }
      
      const cards = this.buildProviderCards(results);
      
      // Log location-based search for audit trail
      if (userCoords) {
        this.logAction("location_based_search", {
          sessionId,
          userProvided: true,
          method: 'gps',
          approximateLocation: `${userCoords.lat.toFixed(2)},${userCoords.lng.toFixed(2)}`
        });
      }
      
      return this.formatResponse(
        message,
        cards,
        undefined,
        { lastSearch: parsed, providerSearchResults: results }
      );
    } catch (error: any) {
      Logger.error(`[ProviderSearch] Failed for "${name}":`, error.message);
      
      // Provide specific error messages based on error type
      if (error.message.includes("API key") || error.message.includes("GOOGLE_PLACES_API_KEY")) {
        return this.formatResponse(
          "⚠️ Provider search is temporarily unavailable. Please try again in a moment.",
          undefined,
          [{ label: "Retry", action: "retry_search", variant: "accent" }],
          {}
        );
      }
      
      if (error.message.includes("timeout") || error.message.includes("ECONNREFUSED") || error.message.includes("network")) {
        return this.formatResponse(
          "🌐 Network issue detected. Let's try that search again.",
          undefined,
          [{ label: "Retry Search", action: "retry_search", variant: "accent" }],
          {}
        );
      }
      
      if (error.message.includes("Google API error")) {
        return this.formatResponse(
          "🔍 Search service temporarily unavailable. Please try again shortly.",
          undefined,
          [{ label: "Retry", action: "retry_search", variant: "accent" }],
          {}
        );
      }
      
      // Generic error
      return this.formatResponse(
        "Hmm, something went wrong with the search. Let's try again.",
        undefined,
        [{ label: "Try Again", action: "retry_search", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Handle login step - LCP-P1: Secure Credential Submission (Step 4)
   * Implements Assistant → Card → CTA pattern for provider login
   * 
   * @param userMessage - User's input (confirmation from provider selection)
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with login instructions
   */
  private async handleLoginStep(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    this.logAction("login_step_initiated", { sessionId, provider: context.provider?.name });
    
    const providerName = context.provider?.name || 'the provider';
    const orgRef = context.provider?.orgRef || '';
    
    // Security-first message with reassurance
    const message = `Great! Let's connect your ${providerName} account so I can check available programs. ${SECURITY_NOTE}`;
    
    const card: CardSpec = {
      title: `Connect to ${providerName}`,
      subtitle: "Secure login required",
      description: `You'll be redirected to ${providerName}'s login page. ${AUDIT_REMINDER}`,
      metadata: { provider: 'skiclubpro', orgRef },
      buttons: [
        { label: `Connect ${providerName} Account`, action: "connect_account", variant: "accent" }
      ]
    };
    
    return this.formatResponse(
      message,
      [card],
      undefined,
      { 
        step: 'awaiting_login',
        loginInitiatedAt: new Date().toISOString()
      }
    );
  }

  /**
   * Handle intent capture step (Step 4.5: Ask what type of program)
   * Parses natural language input into structured intent
   */
  private async handleIntentCapture(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    // If user typed something instead of clicking buttons, parse it
    if (userMessage.trim()) {
      const intent: any = { keywords: [] };
      const lower = userMessage.toLowerCase();
      
      // Category detection
      if (/lesson|class|instruction/.test(lower)) intent.category = "lessons";
      if (/member/.test(lower)) intent.category = "membership";
      if (/camp/.test(lower)) intent.category = "camp";
      if (/race|team|competitive/.test(lower)) intent.category = "race";
      if (/private/.test(lower)) intent.category = "private";
      
      // Day preference
      if (/weekend|saturday|sunday/.test(lower)) intent.day_pref = "weekend";
      if (/weekday|weeknight/.test(lower)) intent.day_pref = "weekday";
      
      // Time preference
      if (/morning/.test(lower)) intent.time_pref = "morning";
      if (/afternoon/.test(lower)) intent.time_pref = "afternoon";
      if (/evening/.test(lower)) intent.time_pref = "evening";
      
      // Level
      if (/beginner|never|first/.test(lower)) intent.level = "beginner";
      if (/intermediate/.test(lower)) intent.level = "intermediate";
      if (/advanced|expert/.test(lower)) intent.level = "advanced";
      
      // Extract keywords
      intent.keywords = userMessage.split(/\s+/).filter(w => w.length > 3);
      
      await this.updateContext(sessionId, {
        programIntent: intent,
        step: FlowStep.FIELD_PROBE
      });
      
      const readable = intent.category || "programs";
      return this.formatResponse(
        `Got it — I'll look for ${readable}. Checking what information is needed...`,
        undefined,
        [{ label: "Continue", action: "run_field_probe", variant: "accent" }],
        {}
      );
    }
    
    // Otherwise show buttons (same as credentials_submitted response)
    return this.formatResponse(
      `To tailor what I pull next, which type of program are you interested in?`,
      undefined,
      [
        { label: "Ski Lessons", action: "intent_lessons", variant: "outline" },
        { label: "Membership", action: "intent_membership", variant: "outline" },
        { label: "Camps", action: "intent_camp", variant: "outline" },
        { label: "Race Team", action: "intent_race", variant: "outline" },
        { label: "Private Lesson", action: "intent_private", variant: "outline" },
      ],
      {}
    );
  }

  /**
   * Handle field probe step (Step 4.7: Extract form fields via Three-Pass Extractor)
   * Opens new browser session (Session B), navigates to relevant form, extracts fields
   */
  private async handleFieldProbe(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    if (!context.programIntent) {
      return this.formatResponse(
        "I need to know what type of program you're interested in first.",
        undefined,
        [{ label: "Tell Me More", action: "back_to_intent", variant: "accent" }],
        {}
      );
    }
    
    this.logAction("tool_invocation", { 
      toolName: "program_field_probe", 
      sessionId, 
      intent: context.programIntent 
    });
    
    try {
      // Call MCP tool: scp.program_field_probe with cookies from Session A
      const result = await this.callTool("scp.program_field_probe", {
        org_ref: context.provider?.orgRef,
        cookies: context.provider_cookies,  // Pass cookies from Session A
        intent: context.programIntent,
        user_jwt: context.user_jwt,
      });
      
      if (!result.success) {
        throw new Error(result.error || "Field probe failed");
      }
      
      // Store extracted fields
      await this.updateContext(sessionId, {
        extractedFields: result.extractor,
        field_probe_run_id: result.run_id,
        step: FlowStep.PROGRAM_SELECTION  // STOP HERE - don't proceed further
      });
      
      const fieldCount = result.extractor?.programs?.length || 0;
      const category = context.programIntent.category || "program";
      
      return this.formatResponse(
        `🔎 I scanned ${context.provider?.name} for a ${category} form and found ${fieldCount} programs. Ready when you are!`,
        undefined,
        [{ label: "Continue", action: "check_programs", variant: "accent" }],
        { extractedFields: result.extractor }
      );
      
    } catch (error: any) {
      Logger.error(`[handleFieldProbe] Failed:`, error);
      return this.formatResponse(
        "I had trouble extracting the form fields. Let's try a different approach.",
        undefined,
        [{ label: "Retry", action: "run_field_probe", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Handle program selection step (Step 5: Program Discovery)
   * Uses smart filtering: show all if < 10, categorize if >= 10
   * 
   * @param userMessage - User's input
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with program carousel or categories
   */
  private async handleProgramSelection(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    const provider = context.provider?.name || userMessage;
    
    this.logAction("tool_invocation", { toolName: "find_programs", sessionId, provider });
    
    try {
      const programs = await this.callTool("find_programs", { provider });
      
      if (!programs || programs.length === 0) {
        return this.formatResponse(
          `Hmm, I couldn't find any programs currently available at ${provider}. This might be a temporary issue.`,
          undefined,
          [
            { label: "Try Different Provider", action: "change_provider", variant: "accent" },
            { label: "Contact Support", action: "contact_support", variant: "outline" }
          ],
          {}
        );
      }
      
      // Store full program list in context for later filtering
      await this.updateContext(sessionId, { availablePrograms: programs });
      
      // SMART FILTERING LOGIC
      if (programs.length < 10) {
        // Small list: Show all programs directly
        const message = `Perfect! Here are the ${programs.length} programs available at **${provider}** 👇`;
        const cards = this.buildProgramCards(programs);
        
        return this.formatResponse(message, cards, undefined, {});
      } else {
        // Large list: Summarize by category
        Logger.info(`[ProgramSelection] Large list detected (${programs.length} programs), running AI summarizer...`);
        
        const summary = await this.summarizePrograms(programs);
        const message = `I found **${programs.length} programs** at ${provider}. Here's a quick overview by category 👇`;
        const cards = this.buildCategoryCards(summary.categories);
        
        return this.formatResponse(
          message,
          cards,
          undefined,
          { 
            programSummary: summary,
            showingCategories: true 
          }
        );
      }
    } catch (error: any) {
      Logger.error("Program discovery failed:", error.message);
      return this.formatResponse(
        "Hmm, I had trouble loading programs. Let's try again.",
        undefined,
        [{ label: "Retry", action: "retry_programs", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Handle prerequisite check step (Step 6: Pre-Registration Checks)
   * Verifies membership, waivers, and payment methods
   * 
   * @param _ - User's input (unused)
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with status
   */
  private async handlePrerequisiteCheck(_: string, sessionId: string): Promise<OrchestratorResponse> {
    this.logAction("tool_invocation", { toolName: "check_prerequisites", sessionId });
    
    try {
      const prereqs = await this.callTool("check_prerequisites", {});
      const allGood = Object.values(prereqs).every((v: any) => v === "ok");
      
      if (allGood) {
        const message = "✅ Great news! All prerequisites are complete. Let's move forward with registration.";
        return this.formatResponse(
          message,
          undefined,
          [{ label: "Continue to Registration", action: "continue_registration", variant: "accent" }],
          { prerequisites: prereqs }
        );
      } else {
        const missing = Object.entries(prereqs)
          .filter(([_, status]) => status !== "ok")
          .map(([key, _]) => key);
        
        const message = `⚠️ Before we can register, we need to complete: ${missing.join(", ")}. Let me help you with that.`;
        
        return this.formatResponse(
          message,
          undefined,
          [
            { label: "Update Requirements", action: "update_prereqs", variant: "accent" },
            { label: "Cancel", action: "cancel", variant: "outline" }
          ],
          { prerequisites: prereqs, missingPrereqs: missing }
        );
      }
    } catch (error: any) {
      Logger.error("Prerequisite check failed:", error.message);
      return this.formatResponse(
        "Hmm, I had trouble checking prerequisites. Let's try again.",
        undefined,
        [{ label: "Retry", action: "retry_prereqs", variant: "accent" }],
        {}
      );
    }
  }

  /**
   * Handle form fill step
   * Collects remaining registration details from user
   * 
   * @param _ - User's input (unused)
   * @param __ - Session identifier (unused)
   */
  private async handleFormFill(_: string, __: string): Promise<OrchestratorResponse> {
    return this.formatResponse(
      "📝 Let's fill out the remaining registration details.",
      [],
      [],
      { formAnswers: {} }
    );
  }

  /**
   * Handle confirmation step (Step 6: Final Confirmation)
   * Presents final summary with card before submission
   * 
   * @param _ - User's input (unused)
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with confirmation card
   */
  private async handleConfirmation(_: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    this.logAction("confirmation_step", { sessionId, program: context.program?.name });
    
    const provider = context.provider?.name;
    const message = `✅ Almost there! Please review the details below and confirm when ready.\n\n${this.securityReminder(provider)}`;
    
    const card = this.buildConfirmationCard(context);
    
    return this.formatResponse(
      message,
      [card],
      undefined,
      { confirmed: false, awaitingConfirmation: true }
    );
  }
}

export default AIOrchestrator;
