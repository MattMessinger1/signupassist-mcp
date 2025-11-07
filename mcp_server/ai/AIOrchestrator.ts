import OpenAI from "openai";
import Logger from "../utils/logger.js";
import { callOpenAI_JSON } from "../lib/openaiHelpers.js";
import { parseProviderInput, ParsedProviderInput } from "../utils/parseInput.js";
import { lookupLocalProvider, googlePlacesSearch } from "../utils/providerSearch.js";
import type { Provider } from "../utils/providerSearch.js";
import { logAudit, extractUserIdFromJWT, logToneChange } from "../lib/auditLogger.js";
import { loadSessionFromDB, saveSessionToDB } from "../lib/sessionPersistence.js";
import { shouldReuseSession, getProgramCategory, TOOL_WORKFLOW, SESSION_REUSE_CONFIG } from "./toolGuidance.js";
import { getMessageForState } from "./messageTemplates.js";
import { buildGroupedCardsPayload, buildSimpleCardsFromGrouped } from "./cardPayloadBuilder.js";
import { parseIntent, buildIntentQuestion, filterByAge, classifyIntentStrength, pickLikelyProgram, type ParsedIntent, type ExtendedIntent } from "../lib/intentParser.js";
import { normalizeEmailWithAI, generatePersonalizedMessage } from "../lib/aiIntentParser.js";
import { singleFlight } from "../utils/singleflight.js";
import type { SessionContext } from "../types.js";
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types.js';

/**
 * Prompt version tracking for tone changes
 */
export const PROMPT_VERSION = "v1.0.0";

/**
 * PRODUCTION_SYSTEM_PROMPT
 * 
 * Orchestration System Prompt - Handles tool calling, session reuse, and flow logic
 * This is the primary prompt that guides the AI's decision-making for tool usage
 */
const PRODUCTION_SYSTEM_PROMPT = `
You orchestrate SignupAssist deterministically for Steps 3–6. Follow Design DNA:
- Chat-native rhythm: Assistant text → compact cards → clear CTA; explicit confirmation before writes. 
- Friendly, concise, parent-centric tone; short status chips; reassure about privacy when asking for credentials or charging. 
- Never proceed with payment or registration without an explicit "Confirm". 
- Be transparent about tools: "I'll log in to Blackhawk securely…" (we never store passwords). 
- If a step fails, apologize, explain next step, and recover. 
(Ref: Design DNA.) 

State & idempotency:
- Keep and reuse {org_ref, provider, activity/category, age, credential_id, session_token, session_issued_at, session_ttl_ms, mandate_jws, mandate_valid_until, login_status}.
- Idempotent tool calls: given the same context, produce the same calls, once.

Session & mandate reuse:
- If session_token exists, org_ref matches, and is fresh (issued < ttl-30s), DO NOT call scp.login.
- If a scp.login is already in progress for this {user_id, org_ref}, DO NOT start another; wait for it to complete (single-flight).
- For mandate: reuse if now < mandate_valid_until - 60s; only refresh when inside that 60s grace.

Pre-login narrowing (before any login/find):
- Ensure we have all three: {age, activity, provider}. 
  • activity → category mapping: lessons/classes → "lessons"; race team/events → "teams"; unknown → "all".
  • If any missing, ask only once, concisely; if user declines, proceed with best-effort defaults (category="all"), and say so.
- Once present (or user declined), proceed.

Program discovery:
- Prefer category-scoped fetch (scp.find_programs {category}) to avoid over-scrape. If empty, retry once with category="all".
- Pre-filter DOM snippets: prefer section containers by theme (e.g., "Lessons & Classes"); include rows with a register/details link OR probable program text (title/date/price patterns). Exclude headers.

Extraction:
- Use the compacted text snippets (no attributes/scripts/boilerplate).
- Enforce strict JSON schema (ProgramExtraction) and drop junk rows. 
- Parallelize in small batches; merge; then validate/dedupe.

Age filter & presentation:
- Apply conservative age overlap (allow on uncertainty). 
- Surface 6–12 top cards grouped: Lessons & Classes / Race Team & Events / Other.
- Sort: Open/Register > Waitlist > Full/Sold Out/Closed > others; then lower price; then title A→Z. 
- Cap 4 per group; offer "Show more".

Anti-bot:
- If anti-bot waits > 6.5s without progress: navigate to /registration immediately (fast-path). 
- Persist cookies/localStorage on first success; on reuse, skip anti-bot waits and jump to registration.

Credentials_submitted:
- If login_status === "success" OR a fresh session_token exists: treat as NO-OP. Never re-login needlessly.

Failure handling:
- If age filter yields zero → show unfiltered with a friendly note and let user adjust. 
- On tool errors: concise apology + actionable next step; never expose stack traces.

Always produce stable, minimal tool calls; never re-ask the same question twice.
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
    payload?: any;  // TASK 2: Support payload for button actions (e.g., schedule filters)
  }>;
}

/**
 * CTA (Call-to-Action) specification
 */
interface CTASpec {
  label: string;
  action: string;
  variant?: "accent" | "outline";
  payload?: any;  // Quick Win #5: Support payload for view_program actions
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
  private supabase?: SupabaseClient<Database>;

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
    
    // Initialize Supabase client for cache queries
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient<Database>(supabaseUrl, supabaseKey);
    }

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
  async generateResponse(userMessage: string, sessionId: string, userLocation?: {lat: number, lng: number}, userJwt?: string, mandateInfo?: { mandate_jws?: string; mandate_id?: string }): Promise<OrchestratorResponse> {
    try {
      const context = await this.getContext(sessionId);
      // Store userLocation and JWT in context for tool calls
      if (userLocation) {
        await this.updateContext(sessionId, { userLocation } as any);
      }
      if (userJwt) {
        await this.updateContext(sessionId, { user_jwt: userJwt } as any);
      }
      // Store mandate in context if provided
      if (mandateInfo?.mandate_jws || mandateInfo?.mandate_id) {
        await this.updateContext(sessionId, {
          mandate_jws: mandateInfo.mandate_jws,
          mandate_id: mandateInfo.mandate_id
        } as any);
      }
      
      // Feature flag: Upfront intent capture
      const FEATURE_INTENT_UPFRONT = process.env.FEATURE_INTENT_UPFRONT === "true";
      
      // Check for missing intent on first turn (before provider search)
      if (FEATURE_INTENT_UPFRONT) {
        const intentQuestion = await this.checkAndRequestMissingIntent(userMessage, sessionId);
        if (intentQuestion) {
          Logger.info(`[Intent Question] ${sessionId}: ${intentQuestion}`);
          return this.formatResponse(intentQuestion, undefined, undefined, {});
        }
        
        // SAFETY CHECK: Verify intent is actually complete before proceeding
        const context = await this.getContext(sessionId);
        const intent = context.partialIntent;
        
        if (!intent?.provider || !intent?.category || !intent?.childAge) {
          Logger.warn('[Intent Incomplete] checkAndRequestMissingIntent returned null but intent incomplete', { 
            sessionId, 
            intent,
            missing: {
              provider: !intent?.provider,
              category: !intent?.category,
              childAge: !intent?.childAge
            }
          });
          const emergencyQuestion = buildIntentQuestion(intent || { hasIntent: false });
          if (emergencyQuestion) {
            return this.formatResponse(emergencyQuestion, undefined, undefined, {});
          }
        }
        
        // Intent is complete! If we have partialIntent.provider but not context.provider,
        // we need to do a provider search to get the full provider object
        if (intent?.provider && !context.provider) {
          Logger.info('[Intent Complete] Converting partial intent to provider object', { 
            sessionId, 
            partialProvider: intent.provider 
          });
          // Search for the provider to get full details (name, orgRef, etc.)
          return await this.handleProviderSearch(intent.provider, sessionId);
        }
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
   * Check and request missing intent upfront (Pre-login Intent Gate)
   * Parses user message for provider, category, and child age
   * Returns a question if any required intent is missing
   * Handles user declining with best-effort defaults
   * 
   * @param userMessage - User's input text
   * @param sessionId - Session identifier
   * @returns Question text if intent incomplete, null if complete or declined
   */
  async checkAndRequestMissingIntent(userMessage: string, sessionId: string): Promise<string | null> {
    const context = await this.getContext(sessionId);
    
    // Skip if we've already confirmed a provider or we're past initial discovery
    if (context.provider?.orgRef || context.loginCompleted || context.step && context.step > FlowStep.PROVIDER_SEARCH) {
      return null;
    }
    
    // Import isIntentDeclined helper
    const { isIntentDeclined } = await import("../lib/intentParser.js");
    
    // Check if user is declining to provide more info
    if (isIntentDeclined(userMessage)) {
      Logger.info(`[Intent Declined] ${sessionId}: User declined, using defaults`);
      await this.updateContext(sessionId, {
        partialIntent: {
          ...context.partialIntent,
          category: context.partialIntent?.category || 'all',
          hasIntent: true
        },
        category: context.partialIntent?.category || 'all'
      });
      return null; // Proceed with defaults
    }
    
    // Context-aware fallback: if last question was about age and user typed a standalone number
    let contextAge: number | undefined;
    if (context.lastQuestionType === 'age') {
      const ageMatch = userMessage.match(/^\s*(\d{1,2})\s*$/);
      if (ageMatch) {
        const age = parseInt(ageMatch[1], 10);
        if (age >= 3 && age <= 18) {
          contextAge = age;
          Logger.info(`[Context-Aware Age] ${sessionId}: Extracted age ${age} from standalone number`);
        }
      }
    }
    
    // Merge new intent with existing partial intent (uses OpenAI via parseIntent)
    const newIntent = await parseIntent(userMessage);
    
    Logger.info('[Intent Parsing Debug]', {
      sessionId,
      userMessage,
      contextAge,
      newIntent,
      existingPartialIntent: context.partialIntent
    });
    
    const mergedIntent: ParsedIntent = {
      hasIntent: newIntent.hasIntent || !!context.partialIntent?.hasIntent || !!contextAge,
      provider: newIntent.provider || context.partialIntent?.provider,
      category: newIntent.category || context.partialIntent?.category,
      childAge: contextAge || newIntent.childAge || context.partialIntent?.childAge
    };
    
    Logger.info('[Intent Merged]', { sessionId, mergedIntent });
    
    // Phase 2: Classify intent strength and pick likely program for fast-path
    const intentStrength = classifyIntentStrength(mergedIntent, userMessage);
    const targetProgram = intentStrength === "high" ? pickLikelyProgram(mergedIntent) : null;
    
    Logger.info('[Intent Classification]', { 
      sessionId, 
      intentStrength, 
      targetProgram,
      fastPathEligible: !!(intentStrength === "high" && targetProgram && targetProgram.confidence >= 0.75)
    });
    
    // Store merged intent with strength and target program
    const updates: any = { 
      partialIntent: mergedIntent,
      category: mergedIntent.category,
      childAge: mergedIntent.childAge,
      intentStrength,
      targetProgram
    };
    
    if (contextAge || newIntent.hasIntent) {
      updates.lastQuestionType = undefined; // Clear after successful extraction
    }
    
    await this.updateContext(sessionId, updates);
    
    // Build question for missing parts (concise one-turn format)
    const question = buildIntentQuestion(mergedIntent);
    
    if (question) {
      // Track what type of question we're asking for context-aware parsing
      const questionLower = question.toLowerCase();
      if (questionLower.includes("child's age") || questionLower.includes("age?")) {
        await this.updateContext(sessionId, { lastQuestionType: 'age' });
      } else if (questionLower.includes('lessons') || questionLower.includes('team')) {
        await this.updateContext(sessionId, { lastQuestionType: 'category' });
      } else if (questionLower.includes('provider') || questionLower.includes('club')) {
        await this.updateContext(sessionId, { lastQuestionType: 'provider' });
      }
      
      Logger.info(`[Missing Intent] ${sessionId}`, { mergedIntent, question, lastQuestionType: context.lastQuestionType });
      return question;
    }
    
    // SAFETY CHECK: Verify all required fields are actually present before returning null
    if (!mergedIntent.provider || !mergedIntent.category || !mergedIntent.childAge) {
      Logger.warn('[Intent Bug] buildIntentQuestion returned null but fields still missing', { 
        sessionId, 
        mergedIntent,
        missing: {
          provider: !mergedIntent.provider,
          category: !mergedIntent.category,
          childAge: !mergedIntent.childAge
        }
      });
      // Build emergency question
      const emergencyQuestion = buildIntentQuestion(mergedIntent) || "Which provider or club?";
      return emergencyQuestion;
    }
    
    // Intent is complete! No need to return confirmation message here - 
    // the orchestrator will handle the next step and confirm naturally
    Logger.info(`[Intent Complete] ${sessionId}`, { mergedIntent });
    return null;
  }

  /**
   * Parse user intent (provider + activity + age) using AI
   * Implements Prompt A: First-turn Intent extraction
   * 
   * @param userMessage - Raw user input
   * @returns Structured intent or follow-up question
   */
  async parseUserIntent(userMessage: string): Promise<{
    intent?: { provider: string; category: string; age: number };
    followUpQuestion?: string;
    needsMoreInfo: boolean;
  }> {
    const systemPrompt = `You are a setup assistant. Parse the user's free text for three fields:
- provider (e.g., "Blackhawk Ski Club")
- activity/category (e.g., "ski lessons", "race team", "math tutoring")
- child's age or age range

If any of the three are missing, ask ONE concise follow-up that requests all missing items in a single question.
Do NOT ask if all three are already present. Never ask more than one follow-up.

When all are known, write a compact JSON intent:
{"provider":"...", "category":"lessons|teams|other|unknown", "age": 8}

Category mapping:
- "lesson", "class", "clinic", "private" → "lessons"
- "team", "race", "league" → "teams"
- anything else → "other"

Example follow-up (only when needed):
"Great—what's your child's age, and which activity/provider do you have in mind?"`;

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      const content = response.choices[0]?.message?.content?.trim() || "";
      
      // Try to parse as JSON first (complete intent)
      const jsonMatch = content.match(/\{[^}]+\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.provider && parsed.category && parsed.age) {
            Logger.info(`[Intent Parsed] provider="${parsed.provider}" category="${parsed.category}" age=${parsed.age}`);
            return {
              intent: {
                provider: parsed.provider,
                category: parsed.category,
                age: typeof parsed.age === 'number' ? parsed.age : parseInt(parsed.age, 10)
              },
              needsMoreInfo: false
            };
          }
        } catch (e) {
          // Not valid JSON, treat as follow-up question
        }
      }

      // Otherwise, it's a follow-up question
      Logger.info(`[Intent Incomplete] AI asks: "${content}"`);
      return {
        followUpQuestion: content,
        needsMoreInfo: true
      };
    } catch (error) {
      Logger.error("parseUserIntent failed:", error);
      // Fallback to generic follow-up
      return {
        followUpQuestion: "Could you tell me which provider, what type of activity, and your child's age?",
        needsMoreInfo: true
      };
    }
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
  /**
   * Handle credential submission without double-login
   * Reuses session_token if available, otherwise performs login
   */
  private async handleAction_credentials_submitted(ctx: SessionContext, payload: any, sessionId?: string): Promise<OrchestratorResponse> {
    // TASK 1: Enhanced session reuse check - verify both token and expiry
    const targetOrg = ctx?.provider?.orgRef ?? "blackhawk-ski";
    const now = Date.now();
    const sessionTTL = ctx.session_ttl_ms || 300000; // Default 5 min
    
    // Check if session_token is still valid before attempting login
    const hasValidSession = 
      ctx.session_token &&
      ctx.org_ref === targetOrg &&
      ctx.session_token_expires_at &&
      now < ctx.session_token_expires_at - 30000; // 30s grace period
    
    if (hasValidSession) {
      Logger.info("[orchestrator] ✅ Reusing valid session_token - skipping login entirely");
      Logger.info(`[orchestrator] Session valid until: ${new Date(ctx.session_token_expires_at!).toISOString()}`);
      
      // Mark login as complete without calling scp.login
      await this.updateContext(sessionId, {
        login_status: "success",
        loginCompleted: true
      });
      
      // Get fresh context after update
      const updatedCtx = await this.getContext(sessionId);
      return await this.handleAutoProgramDiscovery(updatedCtx, { mandate_jws: ctx.mandate_jws }, sessionId);
    }
    
    // No valid session - need to login
    Logger.info("[orchestrator] No valid session found - performing login to obtain session_token…");
    
    // Update context with payload data
    ctx.provider_cookies = payload?.cookies ? Object.values(payload.cookies) : ctx.provider_cookies;
    ctx.credential_id = payload?.credential_id ?? ctx.credential_id;

    const mandate_jws = ctx.mandate_jws ?? process.env.DEV_MANDATE_JWS;
    
    // Single-flight guard: ensure at most one login per {user_id, org_ref} at a time
    const loginKey = `login:${extractUserIdFromJWT(ctx.user_jwt)}:${targetOrg}`;
    const loginRes = await singleFlight(loginKey, async () => {
      return await this.callTool("scp.login", {
        credential_id: ctx.credential_id,
        org_ref: targetOrg,
        user_jwt: ctx.user_jwt,
        mandate_jws,
        destination: process.env.SKICLUBPRO_LOGIN_GOTO_DEST || "/registration"
      }, sessionId);
    });

    if (!loginRes?.session_token) throw new Error("Login did not return session_token");
    
    // Persist session token with proper expiry tracking
    const expiresAt = Date.now() + sessionTTL;
    await this.updateContext(sessionId, {
      session_token: loginRes.session_token,
      session_issued_at: Date.now(),
      session_token_expires_at: expiresAt,
      session_ttl_ms: sessionTTL,
      org_ref: targetOrg,
      login_status: "success",
      loginCompleted: true
    });
    
    Logger.info(`[orchestrator] ✅ Login successful - session valid until ${new Date(expiresAt).toISOString()}`);
    
    // Get fresh context after persistence
    const updatedCtx = await this.getContext(sessionId);
    return await this.handleAutoProgramDiscovery(updatedCtx, { mandate_jws }, sessionId);
  }

  /**
   * Handle automatic program discovery after login
   * Always passes session_token to avoid creating new sessions
   * Phase 3: Added program caching for faster subsequent calls
   */
  private async handleAutoProgramDiscovery(ctx: SessionContext, extras?: { mandate_jws?: string }, sessionId?: string): Promise<OrchestratorResponse> {
    if (!ctx?.provider?.orgRef) throw new Error("Provider context missing for auto-discovery");
    
    // TASK 2: Check if we need to prompt for schedule preferences
    const SCHEDULE_FILTER_ENABLED = process.env.FEATURE_SCHEDULE_FILTER !== 'false'; // Default enabled
    
    if (SCHEDULE_FILTER_ENABLED && !ctx.schedulePreference && !ctx.scheduleDeclined) {
      Logger.info('[Schedule Filter] Prompting user for schedule preferences');
      return this.buildScheduleFilterPrompt(sessionId);
    }
    
    // TASK 4: Check database cache first (before in-memory cache)
    const cacheKey = `programs:${ctx.provider.orgRef}:${ctx.category || 'all'}`;
    
    // Try database cache first
    const dbCachedPrograms = await this.checkDatabaseCache(ctx.provider.orgRef, ctx.category || 'all');
    if (dbCachedPrograms && Object.keys(dbCachedPrograms).length > 0) {
      Logger.info(`[DB Cache Hit] ${ctx.provider.orgRef}:${ctx.category || 'all'}`, {
        themes: Object.keys(dbCachedPrograms).length
      });
      
      // Also store in session cache for subsequent requests
      if (!ctx.cache) ctx.cache = {};
      ctx.cache[cacheKey] = dbCachedPrograms;
      
      return await this.presentProgramsAsCards(ctx, dbCachedPrograms);
    }
    
    // Fallback to in-memory session cache
    const cachedPrograms = ctx.cache?.[cacheKey];
    if (cachedPrograms) {
      console.log(`[handleAutoProgramDiscovery] ✅ Using session cached programs (${Object.keys(cachedPrograms).length} themes)`);
      return await this.presentProgramsAsCards(ctx, cachedPrograms);
    }
    
    Logger.info(`[Cache Miss] ${ctx.provider.orgRef}:${ctx.category || 'all'} - proceeding with live scrape`);
    
    // Phase 2: Check for high-intent fast-path eligibility
    const isHighIntent = ctx.intentStrength === "high";
    const hasTargetProgram = !!ctx.targetProgram;
    const highConfidence = (ctx.targetProgram?.confidence ?? 0) >= 0.75;
    const fastPathEligible = isHighIntent && hasTargetProgram && highConfidence;
    
    Logger.info('[Fast-Path Check]', {
      sessionId,
      isHighIntent,
      hasTargetProgram,
      targetProgram: ctx.targetProgram?.program_ref,
      confidence: ctx.targetProgram?.confidence,
      fastPathEligible
    });
    
    // Quick Win #2: Use category from context if provided
    const args: any = {
      org_ref: ctx.provider.orgRef,
      session_token: ctx.session_token,            // <<< critical
      category: ctx.category || "all",              // <<< Use intent category
      user_jwt: ctx.user_jwt,
      mandate_jws: extras?.mandate_jws ?? process.env.DEV_MANDATE_JWS,
      credential_id: ctx.credential_id             // fallback if token missing
    };
    
    // TASK 2: Add schedule preferences for filtering if provided
    if (ctx.schedulePreference) {
      if (ctx.schedulePreference.dayOfWeek && ctx.schedulePreference.dayOfWeek !== "any") {
        args.filter_day = ctx.schedulePreference.dayOfWeek;
      }
      if (ctx.schedulePreference.timeOfDay && ctx.schedulePreference.timeOfDay !== "any") {
        args.filter_time = ctx.schedulePreference.timeOfDay;
      }
      
      Logger.info('[Schedule Filter Applied]', {
        sessionId,
        dayOfWeek: args.filter_day,
        timeOfDay: args.filter_time
      });
    }
    
    // Phase 2: Add fast-path parameters if eligible
    if (fastPathEligible) {
      args.filter_program_ref = ctx.targetProgram!.program_ref;
      args.filter_mode = "single";
      args.fallback_to_full = true; // Enable fallback if target not found
      
      Logger.info('[Fast-Path Enabled]', {
        sessionId,
        targetRef: args.filter_program_ref,
        confidence: ctx.targetProgram!.confidence
      });
    }
    
    const res = await this.callTool("scp.find_programs", args, sessionId);
    
    // Phase C: Persist session token if refreshed during discovery
    if (res?.session_token) {
      await this.updateContext(sessionId, {
        session_token: res.session_token,
        session_token_expires_at: Date.now() + (ctx.session_ttl_ms || 300000)
      });
      
      // Refresh context reference
      ctx = await this.getContext(sessionId);
    }
    
    // Phase 2: Validate fast-path result
    const programs = res?.programs_by_theme || {};
    const programCount = Object.values(programs).flat().length;
    
    if (fastPathEligible && programCount === 0) {
      // Fast-path failed to find target program - retry with full scrape
      Logger.warn('[Fast-Path Failed] Target program not found, falling back to full scrape', {
        sessionId,
        targetRef: ctx.targetProgram!.program_ref
      });
      
      // Retry without fast-path params
      const fallbackArgs = { ...args };
      delete fallbackArgs.filter_program_ref;
      delete fallbackArgs.filter_mode;
      delete fallbackArgs.fallback_to_full;
      
      const fallbackRes = await this.callTool("scp.find_programs", fallbackArgs, sessionId);
      if (fallbackRes?.session_token) ctx.session_token = fallbackRes.session_token;
      
      const fallbackPrograms = fallbackRes?.programs_by_theme || {};
      
      // Cache fallback result
      if (Object.keys(fallbackPrograms).length > 0) {
        if (!ctx.cache) ctx.cache = {};
        ctx.cache[cacheKey] = fallbackPrograms;
        console.log(`[handleAutoProgramDiscovery] 📦 Cached ${Object.keys(fallbackPrograms).length} program themes (fallback)`);
      }
      
      return await this.presentProgramsAsCards(ctx, fallbackPrograms);
    }
    
    // TASK 4: Cache programs in database and session (15 min TTL)
    if (Object.keys(programs).length > 0) {
      // Store in session cache
      if (!ctx.cache) ctx.cache = {};
      ctx.cache[cacheKey] = programs;
      
      // Store in database cache
      await this.upsertDatabaseCache(
        ctx.provider.orgRef,
        ctx.category || 'all',
        programs,
        {
          scrape_type: fastPathEligible ? "fast-path" : "full",
          program_count: Object.values(programs).flat().length,
          themes: Object.keys(programs)
        }
      );
      
      const scrapeType = fastPathEligible ? "fast-path" : "full";
      console.log(`[handleAutoProgramDiscovery] 📦 Cached ${Object.keys(programs).length} program themes (${scrapeType}) in DB and session`);
    }
    
    // Return the result from presentProgramsAsCards
    return await this.presentProgramsAsCards(ctx, programs);
  }

  /**
   * Handle extractor test action
   * TASK 4: Added database cache lookup for faster subsequent calls
   */
  private async handleAction_run_extractor_test(ctx: SessionContext, sessionId?: string): Promise<OrchestratorResponse> {
    // TASK 4: Check database cache first
    const orgRef = ctx?.provider?.orgRef ?? "blackhawk-ski";
    const category = "all";
    const cacheKey = `programs:${orgRef}:${category}`;
    
    const dbCachedPrograms = await this.checkDatabaseCache(orgRef, category);
    if (dbCachedPrograms && Object.keys(dbCachedPrograms).length > 0) {
      Logger.info(`[DB Cache Hit - Extractor Test] ${orgRef}:${category}`, {
        themes: Object.keys(dbCachedPrograms).length
      });
      
      // Also store in session cache
      if (!ctx.cache) ctx.cache = {};
      ctx.cache[cacheKey] = dbCachedPrograms;
      
      return await this.presentProgramsAsCards(ctx, dbCachedPrograms);
    }
    
    // Fallback to session cache
    const cachedPrograms = ctx.cache?.[cacheKey];
    if (cachedPrograms) {
      console.log(`[handleAction_run_extractor_test] ✅ Using session cached programs (${Object.keys(cachedPrograms).length} themes)`);
      return await this.presentProgramsAsCards(ctx, cachedPrograms);
    }
    
    const args = {
      org_ref: ctx?.provider?.orgRef ?? "blackhawk-ski",
      session_token: ctx.session_token,
      category: "all",
      mandate_jws: ctx.mandate_jws ?? process.env.DEV_MANDATE_JWS
    };
    
    const startMs = Date.now();
    let res = await this.callTool("scp.find_programs", args, sessionId);
    
    // Quick Win #6: Category fallback - if category-scoped results are empty, retry with "all"
    if (args.category !== "all" && (!res?.programs_by_theme || Object.keys(res.programs_by_theme).length === 0)) {
      Logger.info(`[orchestrator] Category "${args.category}" yielded zero results, retrying with "all"`);
      args.category = "all";
      res = await this.callTool("scp.find_programs", args, sessionId);
    }
    
    if (res?.session_token) {
      await this.updateContext(sessionId, {
        session_token: res.session_token,
        session_token_expires_at: Date.now() + (ctx.session_ttl_ms || 300000)
      });
      
      // Refresh context reference
      ctx = await this.getContext(sessionId);
    }
    
    // Quick Win #7: Metrics logging
    const extractionMs = Date.now() - startMs;
    const numItems = res?.metadata?.items_extracted || Object.values(res?.programs_by_theme || {}).flat().length;
    Logger.info('[metrics]', {
      flow: 'program_discovery',
      org_ref: ctx?.provider?.orgRef,
      category: args.category,
      child_age: ctx.childAge,
      extraction_ms: extractionMs,
      items: numItems
    });
    
    // TASK 4: Cache programs in database and session (15 min TTL)
    const programs = res?.programs_by_theme || {};
    if (Object.keys(programs).length > 0) {
      // Store in session cache
      if (!ctx.cache) ctx.cache = {};
      ctx.cache[cacheKey] = programs;
      
      // Store in database cache
      await this.upsertDatabaseCache(
        orgRef,
        category,
        programs,
        {
          scrape_type: "full",
          program_count: Object.values(programs).flat().length,
          themes: Object.keys(programs),
          source: "extractor_test"
        }
      );
      
      console.log(`[handleAction_run_extractor_test] 📦 Cached ${Object.keys(programs).length} program themes in DB and session`);
    }
    
    return await this.presentProgramsAsCards(ctx, programs);
  }

  /**
   * Present programs as grouped cards
   * Quick Win #3: Filter by child age before building cards
   */
  private async presentProgramsAsCards(ctx: SessionContext, themed: Record<string, any[]>): Promise<OrchestratorResponse> {
    // Quick Win #3: Apply age filtering if childAge is in context
    const filterByAge = (programs: any[], childAge?: number) => {
      if (!childAge) return programs;
      
      return programs.filter(p => {
        if (!p.age_range) return true; // Include if no age restriction
        
        const ageMatch = p.age_range.match(/(\d+)[\s-]+(\d+)/);
        if (ageMatch) {
          const minAge = parseInt(ageMatch[1], 10);
          const maxAge = parseInt(ageMatch[2], 10);
          return childAge >= minAge && childAge <= maxAge;
        }
        
        const singleMatch = p.age_range.match(/(\d+)/);
        if (singleMatch) {
          return childAge === parseInt(singleMatch[1], 10);
        }
        
        return true; // Include if can't parse
      });
    };
    
    // Filter programs by age if childAge is present
    const allPrograms = Object.values(themed).flat();
    const filteredThemed = Object.fromEntries(
      Object.entries(themed).map(([theme, progs]) => [
        theme,
        filterByAge(progs, ctx.childAge)
      ])
    );
    
    const groups = Object.entries(filteredThemed).filter(([_, arr]) => (arr?.length || 0) > 0);
    
    // Quick Win #7: Age filter fallback - if filtering yields zero results, show unfiltered with note
    if (ctx.childAge && groups.length === 0 && allPrograms.length > 0) {
      Logger.info(`[orchestrator] Age ${ctx.childAge} filter yielded zero results, showing all programs with note`);
      const allGroups = Object.entries(themed).filter(([_, arr]) => (arr?.length || 0) > 0);
      const cards = allGroups.flatMap(([theme, progs]) => {
        const header = { title: `${theme}`, subtitle: "Programs", isHeader: true };
        const set = progs.slice(0, 12).map((p) => ({
          title: p.title,
          subtitle: [p.schedule, p.price].filter(Boolean).join(" • "),
          metadata: { programRef: p.program_ref || p.id, orgRef: p.org_ref, theme },
          buttons: [
            { label: "Details", action: "view_program", payload: { program_ref: p.program_ref || p.id, org_ref: p.org_ref } },
            { label: "Register", action: "start_registration", variant: "accent" as const, payload: { program_ref: p.program_ref || p.id, org_ref: p.org_ref } }
          ]
        }));
        return [header, ...set];
      });
      
      return {
        message: `We couldn't find programs specifically for age ${ctx.childAge}, but here are all available programs:`,
        cards,
        uiPayload: { type: "cards" },
        contextUpdates: {}
      };
    }
    
    if (!groups.length) {
      return {
        message: "Hmm — I couldn't find any open programs right now. Want me to check another category or date?",
        uiPayload: { type: "message" },
        cards: [],
        contextUpdates: {}
      };
    }

    const cards = groups.flatMap(([theme, progs]) => {
      const header = { title: `${theme}`, subtitle: "Programs", isHeader: true };
      const set = progs.slice(0, 12).map((p) => ({
        title: p.title,
        subtitle: [p.schedule, p.price].filter(Boolean).join(" • "),
        metadata: { programRef: p.program_ref || p.id, orgRef: p.org_ref, theme },
        buttons: [
          { label: "Details", action: "view_program", payload: { program_ref: p.program_ref || p.id, org_ref: p.org_ref } },
          { label: "Register", action: "start_registration", variant: "accent" as const, payload: { program_ref: p.program_ref || p.id, org_ref: p.org_ref } }
        ]
      }));
      return [header, ...set];
    });

    return {
      message: ctx.childAge 
        ? `✅ I found programs for age ${ctx.childAge}, sorted by theme.`
        : "✅ I sorted the programs by theme so it's easy to browse.",
      cards,
      uiPayload: { type: "cards" },
      contextUpdates: {}
    };
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
  async handleAction(action: string, payload: any, sessionId: string, userJwt?: string, mandateInfo?: { mandate_jws?: string; mandate_id?: string }): Promise<OrchestratorResponse> {
    const context = await this.getContext(sessionId);
    
    // Store JWT in context if provided
    if (userJwt) {
      await this.updateContext(sessionId, { user_jwt: userJwt } as any);
    }
    // Store mandate in context if provided
    if (mandateInfo?.mandate_jws || mandateInfo?.mandate_id) {
      await this.updateContext(sessionId, {
        mandate_jws: mandateInfo.mandate_jws,
        mandate_id: mandateInfo.mandate_id
      } as any);
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
            
            // Store credential and provider context at top level for auto-discovery
            await this.updateContext(sessionId, {
              credential_id: existingCred.id, // Store at top level for handleAutoProgramDiscovery
              credentials: {
                [payload.provider]: {
                  id: existingCred.id,
                  credential_id: existingCred.id
                }
              },
              provider: currentContext.provider || { 
                name: payload.provider, 
                orgRef: payload.orgRef 
              },
              loginCompleted: true,
              step: FlowStep.PROGRAM_SELECTION
            });
            
            // Auto-trigger program discovery immediately (no button click needed)
            console.log(`[orchestrator] Auto-triggering program discovery for existing credentials`);
            
            // Get fresh context after update
            const updatedContext = await this.getContext(sessionId);
            return this.handleAutoProgramDiscovery(updatedContext, undefined, sessionId);
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
          // Delegate to new action handler
          return await this.handleAction_credentials_submitted(context, payload, sessionId);

        case "run_extractor_test":
          // Delegate to extractor test handler
          return await this.handleAction_run_extractor_test(context, sessionId);
        
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
        
        
        case "set_schedule_filter":
          // TASK 2: User selected their schedule preferences
          const { dayOfWeek, timeOfDay } = payload || {};
          
          Logger.info('[Schedule Filter] User selected preferences', { dayOfWeek, timeOfDay });
          
          await this.updateContext(sessionId, {
            schedulePreference: { dayOfWeek, timeOfDay },
            scheduleDeclined: false
          });
          
          // Proceed with program discovery now that we have preferences
          const ctxWithSchedule = await this.getContext(sessionId);
          return await this.handleAutoProgramDiscovery(ctxWithSchedule, { mandate_jws: context.mandate_jws }, sessionId);
        
        case "skip_schedule_filter":
          // TASK 2: User declined to set schedule preferences
          Logger.info('[Schedule Filter] User skipped schedule filter');
          
          await this.updateContext(sessionId, {
            scheduleDeclined: true
          });
          
          // Proceed with program discovery without schedule filter
          const ctxNoSchedule = await this.getContext(sessionId);
          return await this.handleAutoProgramDiscovery(ctxNoSchedule, { mandate_jws: context.mandate_jws }, sessionId);
        
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
            const retryResult = await this.handleAutoProgramDiscovery(context, undefined, sessionId);
            
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

        case "start_registration":
          // Map to select_program logic for registration flow
          return this.handleAction("select_program", payload, sessionId);

        case "view_program":
          // Quick Win #5: Handle view_program action - call scp.program_field_probe
          const { program_ref: progRef, org_ref: orgRef } = payload || {};
          
          if (!progRef || !orgRef) {
            return this.formatResponse(
              "I'm not sure which program you want to view. Can you try again?",
              undefined,
              undefined,
              {}
            );
          }
          
          Logger.info(`[view_program] Fetching details for program_ref=${progRef}, org_ref=${orgRef}`);
          
          try {
            // Call scp.program_field_probe to get program details
            const result = await this.callTool("scp.program_field_probe", {
              org_ref: orgRef,
              program_ref: progRef,
              session_token: context.session_token,
              cookies: context.provider_cookies || [],
              credential_id: context.credential_id
            }, sessionId);
            
            if (result && result.fields) {
              // Build a description from the extracted fields
              const fieldDescriptions = result.fields.map((f: any) => 
                `**${f.label || f.name}**: ${f.type || 'text'}`
              ).join('\n');
              
              return this.formatResponse(
                `📋 **Program Registration Form**\n\nRequired fields:\n${fieldDescriptions}`,
                undefined,
                [{ label: "Start Registration", action: "select_program", variant: "accent", payload: { program_ref: progRef, org_ref: orgRef } }],
                {}
              );
            } else {
              return this.formatResponse(
                "I found the program but couldn't extract its registration details. Would you like to try again?",
                undefined,
                [{ label: "Try Again", action: "view_program", variant: "accent", payload: { program_ref: progRef, org_ref: orgRef } }],
                {}
              );
            }
          } catch (error: any) {
            Logger.error(`[view_program] Failed to probe program fields:`, error);
            return this.formatResponse(
              `⚠️ I couldn't load the program details. ${error.message || 'Please try again.'}`,
              undefined,
              [{ label: "Retry", action: "view_program", variant: "accent", payload: { program_ref: progRef, org_ref: orgRef } }],
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
        
        // Phase E: Auto-inject session_token if available and fresh
        const ctx = await this.getContext(sessionId);
        if (ctx.session_token && ctx.session_token_expires_at) {
          const now = Date.now();
          if (now < ctx.session_token_expires_at - 30000) {
            args.session_token = ctx.session_token;
            Logger.info('[callTool] 🔁 Injecting persisted session token');
          }
        }
        
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
        
        // PACK-C: Check for tool failure before claiming success
        if (result?.error) {
          Logger.error(`[MCP] Tool ${mcpToolName} returned error: ${result.error}`);
          throw new Error(result.error);
        }
        
        if (result?.success === false) {
          Logger.error(`[MCP] Tool ${mcpToolName} returned success=false`);
          throw new Error(`Tool ${mcpToolName} returned success=false`);
        }
        
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
          
          // PACK-C: Check retry result too
          if (retryResult?.error) {
            throw new Error(retryResult.error);
          }
          if (retryResult?.success === false) {
            throw new Error(`Tool ${mcpToolName} returned success=false on retry`);
          }
          
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
      
      // PACK-C: Check for tool failure before claiming success
      if (result?.error) {
        Logger.error(`[ToolError] ${toolName}: ${result.error}`);
        throw new Error(result.error);
      }
      
      if (result?.success === false) {
        Logger.error(`[ToolError] ${toolName} returned success=false`);
        throw new Error(`Tool ${toolName} returned success=false`);
      }
      
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
        
        // PACK-C: Check retry result too
        if (result?.error) {
          throw new Error(result.error);
        }
        if (result?.success === false) {
          throw new Error(`Tool ${toolName} returned success=false after retry`);
        }
        
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
   * PACK-B: Ensure a valid mandate exists with required scopes
   * Creates new mandate if missing or refreshes if insufficient scopes
   */
  private async ensureMandatePresent(sessionId: string, toolName?: string): Promise<void> {
    const context = await this.getContext(sessionId);
    
    // Determine required scopes for the tool
    const { MANDATE_SCOPES } = await import('../lib/mandates.js');
    let requiredScopes: string[] = [MANDATE_SCOPES.AUTHENTICATE];
    
    // PACK-B: Explicit scope requirements per tool
    if (toolName === 'scp.find_programs') {
      requiredScopes = [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.READ_LISTINGS];
    } else if (toolName === 'scp.discover_required_fields') {
      requiredScopes = [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.DISCOVER_FIELDS];
    } else if (toolName === 'scp.register') {
      requiredScopes = [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.REGISTER];
    } else if (toolName === 'scp.pay') {
      requiredScopes = [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.PAY];
    }
    
    // Phase D: Check if session is still valid (for session reuse optimization)
    const now = Date.now();
    const sessionValid = context.session_token 
      && context.session_token_expires_at 
      && now < context.session_token_expires_at - 30000; // 30s grace
    
    // Quick Win #5: Mandate reuse - check if mandate is still valid WITH GRACE PERIOD
    const MANDATE_GRACE_MS = 60_000; // 60s buffer to prevent expiry during operations
    const mandateValid = context.mandate_jws 
      && context.mandate_valid_until 
      && Date.now() < (context.mandate_valid_until - MANDATE_GRACE_MS);
    
    // Phase D: If both session and mandate are valid, verify scopes and potentially skip re-auth
    if (sessionValid && mandateValid) {
      // PACK-B: Verify it has required scopes
      try {
        const { verifyMandate } = await import('../lib/mandates.js');
        await verifyMandate(context.mandate_jws, requiredScopes);
        Logger.info('[mandate] ✅ Reusing valid session + mandate with correct scopes, skipping re-auth');
        return; // Mandate is good with correct scopes
      } catch (err: any) {
        if (err.code === 'ERR_SCOPE_MISSING') {
          console.log('[Orchestrator] 🔄 Mandate missing required scopes, refreshing...', err.message);
        } else {
          console.log('[Orchestrator] 🔄 Mandate verification failed, refreshing...', err.message);
        }
        // Fall through to create new one with required scopes
      }
    } else if (context.mandate_jws && !mandateValid) {
      console.log('[Orchestrator] 🔄 Mandate expired, creating new one with scopes:', requiredScopes);
    } else {
      console.log('[Orchestrator] No mandate in context; creating one with scopes:', requiredScopes);
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
    
    // PACK-B: Use new createMandate helper
    const { createMandate } = await import('../lib/mandates.js');
    const extraScopes = requiredScopes.filter(s => s !== MANDATE_SCOPES.AUTHENTICATE);
    const mandate_jws = await createMandate(userId, 'skiclubpro', extraScopes);
    
    // Calculate mandate expiration (default 5 minutes)
    const mandateTTL = 5 * 60 * 1000; // 5 minutes in ms
    const mandate_valid_until = Date.now() + mandateTTL;
    
    // Store in context
    await this.updateContext(sessionId, {
      mandate_jws,
      mandate_valid_until
    } as any);
    
    console.log('[Orchestrator] ✅ Mandate created with scopes:', requiredScopes);
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

      const result = await callOpenAI_JSON({
        model: "gpt-5-mini-2025-08-07",
        useResponsesAPI: false, // Use Chat Completions for JSON responses
        system: `Analyze these programs and group them into categories like:
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
}`,
        user: simplifiedPrograms
      });
      
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
   * TASK 2: Build schedule filter prompt UI
   * Prompts user for preferred day and time of week
   * Uses carousel component type for horizontal options
   */
  private buildScheduleFilterPrompt(sessionId?: string): OrchestratorResponse {
    const dayOptions = [
      { label: "Weekdays", value: "weekday", emoji: "📅" },
      { label: "Weekends", value: "weekend", emoji: "🎉" },
      { label: "Any Day", value: "any", emoji: "✨" }
    ];
    
    const timeOptions = [
      { label: "Mornings", value: "morning", emoji: "☀️" },
      { label: "Afternoons", value: "afternoon", emoji: "🌤️" },
      { label: "Evenings", value: "evening", emoji: "🌙" },
      { label: "Any Time", value: "any", emoji: "⏰" }
    ];

    // Build cards as carousel for horizontal scrolling
    const cards: CardSpec[] = [
      {
        title: "📅 Preferred Days",
        description: "When would you like classes?",
        buttons: dayOptions.map(opt => ({
          label: `${opt.emoji} ${opt.label}`,
          action: "set_schedule_filter",
          variant: "outline" as const,
          payload: { dayOfWeek: opt.value, timeOfDay: "any" }
        }))
      },
      {
        title: "⏰ Preferred Time",
        description: "What time works best?",
        buttons: timeOptions.map(opt => ({
          label: `${opt.emoji} ${opt.label}`,
          action: "set_schedule_filter",
          variant: "outline" as const,
          payload: { dayOfWeek: "any", timeOfDay: opt.value }
        }))
      }
    ];

    return this.formatResponse(
      "Quick question — when would you prefer classes? (This helps me show the most relevant programs first) 🗓️",
      cards,
      [{ 
        label: "Skip — Show All", 
        action: "skip_schedule_filter", 
        variant: "outline" 
      }],
      {}
    );
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
      const parsed = await callOpenAI_JSON({
        model: "gpt-5-mini-2025-08-07",
        useResponsesAPI: false, // Use Chat Completions for JSON responses
        system: "Extract provider name and city from input. Return JSON with 'name' and 'city' fields. If city is not mentioned, omit the city field.",
        user: userInput
      });
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
    // When FEATURE_INTENT_UPFRONT is enabled, check partialIntent first
    const FEATURE_INTENT_UPFRONT = process.env.FEATURE_INTENT_UPFRONT === "true";
    const hasProvider = context.provider || (FEATURE_INTENT_UPFRONT && context.partialIntent?.provider);
    
    if (!hasProvider) return "provider_search";
    if (hasProvider && !context.loginCompleted) return "login";
    if (hasProvider && !context.program) return "program_selection";
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

  /**
   * TASK 4: Check database cache for programs
   * Queries Supabase cached_programs table via find_programs_cached RPC
   * 
   * @param orgRef - Organization reference (e.g., "blackhawk-ski")
   * @param category - Program category (e.g., "lessons", "all")
   * @param maxAgeHours - Maximum cache age in hours (default: 24)
   * @returns Cached programs grouped by theme, or null if cache miss
   */
  private async checkDatabaseCache(
    orgRef: string,
    category: string = 'all',
    maxAgeHours: number = 24
  ): Promise<Record<string, any[]> | null> {
    if (!this.supabase) {
      Logger.warn('[DB Cache] Supabase client not initialized, skipping cache check');
      return null;
    }

    try {
      const { data, error } = await this.supabase.rpc('find_programs_cached', {
        p_org_ref: orgRef,
        p_category: category,
        p_max_age_hours: maxAgeHours
      });

      if (error) {
        Logger.error('[DB Cache] Query failed', { error: error.message, orgRef, category });
        return null;
      }

      // RPC returns empty object {} on cache miss
      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      Logger.info('[DB Cache] Hit', {
        orgRef,
        category,
        themes: Object.keys(data).length,
        programCount: Object.values(data).flat().length
      });

      return data as Record<string, any[]>;
    } catch (error: any) {
      Logger.error('[DB Cache] Unexpected error', { error: error.message, orgRef, category });
      return null;
    }
  }

  /**
   * TASK 4: Upsert programs to database cache
   * Stores programs in Supabase cached_programs table via upsert_cached_programs RPC
   * 
   * @param orgRef - Organization reference (e.g., "blackhawk-ski")
   * @param category - Program category (e.g., "lessons", "all")
   * @param programsByTheme - Programs grouped by theme
   * @param metadata - Additional metadata about the cache entry
   * @param ttlHours - Time-to-live in hours (default: 24)
   */
  private async upsertDatabaseCache(
    orgRef: string,
    category: string,
    programsByTheme: Record<string, any[]>,
    metadata: Record<string, any> = {},
    ttlHours: number = 24
  ): Promise<void> {
    if (!this.supabase) {
      Logger.warn('[DB Cache] Supabase client not initialized, skipping cache upsert');
      return;
    }

    try {
      const { data, error } = await this.supabase.rpc('upsert_cached_programs', {
        p_org_ref: orgRef,
        p_category: category,
        p_programs_by_theme: programsByTheme,
        p_metadata: metadata,
        p_ttl_hours: ttlHours
      });

      if (error) {
        Logger.error('[DB Cache] Upsert failed', { 
          error: error.message, 
          orgRef, 
          category,
          themeCount: Object.keys(programsByTheme).length
        });
        return;
      }

      Logger.info('[DB Cache] Upserted', {
        orgRef,
        category,
        cacheId: data,
        themes: Object.keys(programsByTheme).length,
        programCount: Object.values(programsByTheme).flat().length,
        ttlHours
      });
    } catch (error: any) {
      Logger.error('[DB Cache] Unexpected upsert error', { 
        error: error.message, 
        orgRef, 
        category 
      });
    }
  }
}

export default AIOrchestrator;
