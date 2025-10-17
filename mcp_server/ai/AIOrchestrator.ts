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

  /**
   * Initialize the AI orchestrator
   * Sets up OpenAI client, session storage, and system prompt
   */
  constructor() {
    // Initialize OpenAI client with API key from environment
    this.openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY! 
    });

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
   * Calls OpenAI API with conversation history and returns structured response
   * 
   * @param userMessage - The user's input text
   * @param sessionId - Unique session identifier for context tracking
   * @returns Promise resolving to OrchestratorResponse
   */
  async generateResponse(userMessage: string, sessionId: string): Promise<OrchestratorResponse> {
    const context = this.getContext(sessionId);
    
    // Log user message
    this.logInteraction(sessionId, "user", userMessage);

    // Build context summary for AI
    const contextSummary = JSON.stringify(context, null, 2);

    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.exampleMessages,
      { role: "assistant", content: `Current session context:\n${contextSummary}` },
      ...(context.conversationHistory || []),
      { role: "user", content: userMessage }
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages
      });

      const assistantMessage = completion.choices[0].message?.content || "";
      
      // Log assistant response
      this.logInteraction(sessionId, "assistant", assistantMessage);

      return { 
        assistantMessage, 
        uiPayload: {}, 
        contextUpdates: {} 
      };
    } catch (error) {
      console.error("OpenAI error:", error);
      const errorMessage = "🤖 Sorry, something went wrong.";
      this.logInteraction(sessionId, "assistant", errorMessage);
      
      return { 
        assistantMessage: errorMessage, 
        uiPayload: {}, 
        contextUpdates: {} 
      };
    }
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
      search_provider: async ({ name, location }: any) => {
        console.log(`[Tool] search_provider called: ${name}, ${location}`);
        return [{ name: "Blackhawk Ski Club", city: "Middleton, WI" }];
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
    const truncated = content.substring(0, 100);
    const suffix = content.length > 100 ? "..." : "";
    console.log(`[${sessionId}] ${role}: ${truncated}${suffix}`);
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
}

export default AIOrchestrator;
