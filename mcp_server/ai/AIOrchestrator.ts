import OpenAI from "openai";
import Logger from "../utils/logger.js";
import { parseProviderInput, ParsedProviderInput } from "../utils/parseInput.js";
import { lookupLocalProvider, googlePlacesSearch } from "../utils/providerSearch.js";
import type { Provider } from "../utils/providerSearch.js";
import { logAudit, extractUserIdFromJWT, logToneChange } from "../lib/auditLogger.js";
import { loadSessionFromDB, saveSessionToDB } from "../lib/sessionPersistence.js";

/**
 * Prompt version tracking for tone changes
 */
export const PROMPT_VERSION = "v1.0.0";

/**
 * Production System Prompt - Single source of truth for SignupAssist tone and behavior
 * This prompt defines the voice parents hear and ensures consistent Design DNA compliance
 */
const PRODUCTION_SYSTEM_PROMPT = `
Role & audience
You are SignupAssist, a friendly, efficient helper for parents.
Be concise, warm, and clear — use simple words (≈ 6–8th grade).
Use the child's name whenever known.

Conversational workflow (never skip):
1️⃣ Explain what you'll do in 1–2 sentences.
2️⃣ Show options as cards (short titles, key facts).
3️⃣ Ask the parent to confirm the next action (Yes/No).
4️⃣ After any "write" (registration or payment), restate what happened.

Tone rules:
• Friendly, concise, parent-first. One idea per sentence.
• Emoji sparingly (🎉 / ✅ where it adds clarity).
• Never scold or over-explain; if unclear, ask a simple follow-up.
• Always acknowledge ("Got it — thanks!") before the next step.

Security & transparency:
• When asking for login or payment, remind: "Credentials and card data stay with the provider; SignupAssist never stores card numbers."
• Before any charge or enrollment, summarize child, program, schedule, price, and payment method, then ask "Shall I proceed?"

Error & recovery style:
• Be calm and actionable: "Looks like your provider login expired. Let's reconnect securely."
• Offer one clear fix and a retry option; never show stack traces or raw codes.

Context use:
• Remember prior choices (provider, program, child details). Never ask twice.
• If context is missing, ask the smallest next question to proceed.

Output rules:
• Write only the assistant message. The app attaches cards / buttons from tool outputs.
• Always return one short, upbeat line before showing cards.
• If meta.tone_hints or security_note are present, blend them naturally.
• When a tool is needed, request it by name once; after it responds, summarize briefly and move to confirmation.

Never do:
• Never proceed with payments or registrations without explicit "Yes."
• Never ask for full card numbers or passwords in chat.
• Never dump long lists — prefer short, scannable bullets.

Stay consistent with SignupAssist's Design DNA: friendly, concise, secure.
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
    child?: { name: string; birthdate?: string };
    prerequisites?: Record<string, "ok" | "required" | "missing">;
    formAnswers?: Record<string, any>;
    conversationHistory?: Array<{ role: string; content: string }>;
    loginCompleted?: boolean;
    confirmed?: boolean;
    user_jwt?: string;
    credential_id?: string;
    credentials?: { [provider: string]: { id: string; credential_id: string } };
    pendingLogin?: { provider: string; orgRef: string };
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

  /**
   * Initialize the AI orchestrator
   * Sets up OpenAI client, session storage, and system prompt
   */
  constructor() {
    // Initialize OpenAI client with API key from environment
    this.openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY! 
    });

    // Model configuration
    // gpt-4o = best general-purpose model (May 2024)
    // gpt-4o-mini = cheaper/faster alternative
    this.model = process.env.OPENAI_MODEL || "gpt-4o";
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
    Logger.info(`[Context Updated] ${sessionId}`, updates);
    Logger.info(`[Audit] Context updated`, await this.getContext(sessionId));
    this.logContext(sessionId);
    this.logContextSnapshot(sessionId);
    
    // PHASE 2: Persist to Supabase
    const userId = extractUserIdFromJWT(this.sessions[sessionId]?.user_jwt);
    await saveSessionToDB(sessionId, this.sessions[sessionId], userId || undefined);
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
          const { credential_id } = payload;
          
          await this.updateContext(sessionId, {
            credential_id,
            loginCompleted: true,
            step: FlowStep.PROGRAM_SELECTION
          });
          
          // PHASE 1: Log credential submission
          if (userId && credential_id) {
            await logAudit({
              user_id: userId,
              action: 'credentials_submitted',
              provider: context.provider?.orgRef,
              org_ref: context.provider?.orgRef,
              credential_id,
              metadata: { sessionId }
            });
          }
          
          return this.handleProgramSelection("Show programs", sessionId);

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
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const cacheKey = `${toolName}-${JSON.stringify(args)}`;
    if (this.isCacheValid(cacheKey)) {
      Logger.info(`Cache hit for ${cacheKey}`);
      return this.getFromCache(cacheKey).value;
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
      'submit_registration': 'scp.submit_registration'
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
          throw error; // Re-throw so orchestrator can handle it
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

    try {
      Logger.info(`Calling tool: ${toolName}`, this.sanitize(args));
      Logger.info(`[Audit] Tool call`, { toolName, args: this.sanitize(args) });
      
      // PHASE 5: Add retry logic with exponential backoff
      const result = await this.withRetry(() => tool(args), 3);
      this.saveToCache(cacheKey, result);
      Logger.info(`Tool ${toolName} succeeded.`);
      return result;
    } catch (error: any) {
      Logger.error(`Tool ${toolName} failed:`, error.message);
      throw error;
    }
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
      // Note: This requires a Supabase client instance
      // For now, we'll use a placeholder that returns null
      // In production, you'd import and use the Supabase client here
      Logger.info(`[orchestrator] Would lookup credentials for user=${userId}, provider=${provider}, org=${orgRef}`);
      
      // TODO: Import createClient from '@supabase/supabase-js' and query stored_credentials table
      // const { data, error } = await supabase
      //   .from('stored_credentials')
      //   .select('id, alias')
      //   .eq('user_id', userId)
      //   .eq('provider', provider)
      //   .ilike('alias', `%${orgRef}%`)
      //   .single();
      // 
      // if (error || !data) return null;
      // return data;
      
      return null; // Placeholder until Supabase client is available in orchestrator
    } catch (error) {
      Logger.error("[orchestrator] Failed to lookup credentials:", error);
      return null;
    }
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
        model: "gpt-4o-mini",
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
   * Handle program selection step (Step 5: Program Discovery)
   * Retrieves and displays available programs as cards
   * 
   * @param userMessage - User's input
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with program carousel
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
      
      const message = `Perfect! Here are the available programs at **${provider}** this season 👇`;
      const cards = this.buildProgramCards(programs);
      
      return this.formatResponse(
        message,
        cards,
        undefined,
        { availablePrograms: programs }
      );
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
