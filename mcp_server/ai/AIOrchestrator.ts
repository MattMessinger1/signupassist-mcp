import OpenAI from "openai";

// 🔜 TODO:
// - Replace in-memory session store with Supabase persistence
//   using table: agentic_checkout_sessions
// - Add methods: loadContextFromDB(sessionId), saveContextToDB(sessionId)
// - Sync context automatically every few updates


/**
 * Session context structure - defines what's stored for each conversation
 */
export interface SessionContext {
  provider?: { name: string; orgRef: string };
  program?: { name: string; id: string };
  child?: { name: string; birthdate?: string };
  prerequisites?: Record<string, "ok" | "required" | "missing">;
  formAnswers?: Record<string, any>;
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * Standardized orchestrator response structure
 */
interface OrchestratorResponse {
  assistantMessage: string;
  uiPayload?: Record<string, any>;
  contextUpdates?: Record<string, any>;
}

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
  private readonly systemPrompt: string;
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

    // System prompt defining SignupAssist's personality and behavior (Design DNA)
    this.systemPrompt = `
You are SignupAssist — a friendly, concise assistant helping parents register their kids for activities.
Always:
- Keep responses short, clear, and encouraging.
- Use emojis sparingly (✅, 🎉, 🔍) to signal context.
- Follow this rhythm: message → card/options → confirmation.
- Confirm before any write or payment.
- Remind users that their info and payments stay secure with the provider.
- Be polite, warm, and parent-friendly at all times.
`;

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
   * Uses manual orchestration to route to correct step handler
   * 
   * @param userMessage - The user's input text
   * @param sessionId - Unique session identifier for context tracking
   * @returns Promise resolving to OrchestratorResponse
   */
  async generateResponse(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = this.getContext(sessionId);
    const step = this.determineStep(userMessage, context);
    
    // Debug logging for flow visibility
    console.log(`🧭 Flow Step: ${step}`);
    console.log("🧩 Context:", this.getContext(sessionId));
    
    this.logInteraction(sessionId, "user", userMessage);
    const result = await this.handleStep(step, userMessage, sessionId);
    this.updateContext(sessionId, result.contextUpdates || {});
    this.logInteraction(sessionId, "assistant", result.assistantMessage);
    return result;
  }

  /**
   * Get session context from in-memory store
   * Auto-initializes a new session if none exists
   * Fetches the current state of the user's signup flow
   * 
   * @param sessionId - Unique session identifier
   * @returns Current session context object
   */
  getContext(sessionId: string): SessionContext {
    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {};
      console.log(`[Context Created] New session ${sessionId}`);
    }
    // TODO: Add Supabase persistence for agentic_checkout_sessions table
    return this.sessions[sessionId];
  }

  /**
   * Update session context with new data
   * Merges updates into existing context
   * 
   * @param sessionId - Unique session identifier
   * @param updates - Partial context updates to merge
   */
  updateContext(sessionId: string, updates: Partial<SessionContext>): void {
    const existing = this.getContext(sessionId);
    this.sessions[sessionId] = { 
      ...existing, 
      ...updates 
    };
    console.log(`[Context Updated] ${sessionId}:`, updates);
    this.logContext(sessionId);
    // TODO: Add Supabase persistence for agentic_checkout_sessions table
  }

  /**
   * Reset session context
   * Clears all stored data for a session (useful for debugging or new signups)
   * 
   * @param sessionId - Session to reset
   */
  resetContext(sessionId: string): void {
    delete this.sessions[sessionId];
    console.log(`[Context Reset] ${sessionId}`);
  }

  /**
   * Call a tool/helper function
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
    // Stubbed tools - will be replaced with real MCP integrations
    const tools: Record<string, Function> = {
      search_provider: async ({ name }: any) => {
        console.log(`[Tool] search_provider called: ${name}`);
        return [
          { name: "Blackhawk Ski Club", city: "Middleton, WI" },
          { name: "Madison Nordic Club", city: "Madison, WI" },
        ];
      },
      find_programs: async ({ provider }: any) => {
        console.log(`[Tool] find_programs called for: ${provider}`);
        return [
          { name: "Beginner Ski Class – Saturdays", id: "prog1" },
          { name: "Intermediate Ski Class – Sundays", id: "prog2" },
        ];
      },
      check_prerequisites: async () => {
        console.log(`[Tool] check_prerequisites called`);
        return { membership: "ok", payment: "ok" };
      }
    };

    const tool = tools[toolName];
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return await tool(args);
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
    console.log(`[Context Snapshot] ${sessionId}:`, JSON.stringify(this.sessions[sessionId], null, 2));
  }

  /**
   * Retry helper for handling transient errors
   * Uses exponential backoff to retry failed operations
   * 
   * @param fn - Async function to retry
   * @param retries - Number of retry attempts remaining
   * @param delay - Initial delay in milliseconds
   * @returns Promise resolving to function result
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries <= 0) throw error;
      console.warn(`Retrying after error (${3 - retries + 1}/3):`, error.message);
      await new Promise(r => setTimeout(r, delay * (4 - retries))); // exponential backoff
      return this.withRetry(fn, retries - 1, delay);
    }
  }

  /**
   * Log error for debugging
   * 
   * @param sessionId - Session identifier
   * @param errorMessage - Error message to log
   */
  private logError(sessionId: string, errorMessage: string): void {
    console.error(`[${sessionId}] ERROR:`, errorMessage);
  }

  /**
   * Determine the current step of the signup flow
   * Returns the phase label based on what information is present in context
   * 
   * @param userMessage - User's current input
   * @param context - Current session context
   * @returns Step identifier string (provider_search, program_selection, etc.)
   */
  private determineStep(userMessage: string, context: Record<string, any>): string {
    if (!context.provider) return "provider_search";
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
      case "program_selection":
        return await this.handleProgramSelection(userMessage, sessionId);
      case "prerequisite_check":
        return await this.handlePrerequisiteCheck(userMessage, sessionId);
      case "form_fill":
        return await this.handleFormFill(userMessage, sessionId);
      case "confirmation":
        return await this.handleConfirmation(userMessage, sessionId);
      default:
        return { assistantMessage: "🎉 All steps complete!", uiPayload: {}, contextUpdates: {} };
    }
  }

  /**
   * Handle provider search step
   * Searches for activity providers based on user input
   * 
   * @param userMessage - User's search query
   * @param sessionId - Session identifier
   * @returns Promise resolving to OrchestratorResponse with provider options
   */
  private async handleProviderSearch(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const providerQuery = userMessage;
    const results = await this.callTool("search_provider", { name: providerQuery });
    const message = `🔍 I found these providers for "${providerQuery}": ${results
      .map((r: any) => r.name + " (" + r.city + ")")
      .join(", ")}. Please confirm which one is correct.`;
    return { 
      assistantMessage: message, 
      uiPayload: { type: "cards", options: results }, 
      contextUpdates: { providerSearchResults: results } 
    };
  }

  /**
   * Handle program selection step
   * Retrieves available programs from the provider
   * 
   * @param userMessage - User's input
   * @param sessionId - Session identifier
   */
  private async handleProgramSelection(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = this.getContext(sessionId);
    const provider = context.provider?.name || userMessage;
    const programs = await this.callTool("find_programs", { provider });
    const message = `Here are the upcoming programs for ${provider}: ${programs.map((p: any) => p.name).join(", ")}. Which would you like to choose?`;
    return { 
      assistantMessage: message, 
      uiPayload: { type: "cards", options: programs }, 
      contextUpdates: { availablePrograms: programs } 
    };
  }

  /**
   * Handle prerequisite check step
   * Verifies membership, waivers, and payment methods
   * 
   * @param _ - User's input (unused)
   * @param sessionId - Session identifier
   */
  private async handlePrerequisiteCheck(_: string, sessionId: string): Promise<OrchestratorResponse> {
    const prereqs = await this.callTool("check_prerequisites", {});
    const allGood = Object.values(prereqs).every((v: any) => v === "ok");
    const message = allGood
      ? "✅ All prerequisites are complete! Let's continue to the registration form."
      : "⚠️ Some prerequisites are missing. Please update your membership or payment method before continuing.";
    return { 
      assistantMessage: message, 
      uiPayload: {}, 
      contextUpdates: { prerequisites: prereqs } 
    };
  }

  /**
   * Handle form fill step
   * Collects remaining registration details from user
   * 
   * @param _ - User's input (unused)
   * @param __ - Session identifier (unused)
   */
  private async handleFormFill(_: string, __: string): Promise<OrchestratorResponse> {
    return { 
      assistantMessage: "📝 Let's fill out the remaining registration details.", 
      uiPayload: {}, 
      contextUpdates: { formAnswers: {} } 
    };
  }

  /**
   * Handle confirmation step
   * Presents final summary and confirms registration submission
   * 
   * @param _ - User's input (unused)
   * @param __ - Session identifier (unused)
   */
  private async handleConfirmation(_: string, __: string): Promise<OrchestratorResponse> {
    return { 
      assistantMessage: "✅ Ready to confirm registration. Shall I proceed?", 
      uiPayload: { type: "confirmation" }, 
      contextUpdates: { confirmed: true } 
    };
  }
}

export default AIOrchestrator;
