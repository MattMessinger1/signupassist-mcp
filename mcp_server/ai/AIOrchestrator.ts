import OpenAI from "openai";

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
  private sessions: Record<string, Record<string, any>> = {};
  private readonly systemPrompt: string;
  private promptTemplates: Record<string, string>;

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
  }

  /**
   * Generate AI response for user message
   * Calls OpenAI API with conversation history and returns structured response
   * 
   * @param userMessage - The user's input text
   * @param sessionId - Unique session identifier for context tracking
   * @returns Promise resolving to assistant's response
   */
  async generateResponse(userMessage: string, sessionId: string): Promise<any> {
    const context = this.getContext(sessionId);
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...(context.exampleMessages || []),
      { role: "user", content: userMessage }
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages
      });

      const assistantMessage = completion.choices[0].message?.content || "";
      return { 
        assistantMessage, 
        uiPayload: {}, 
        contextUpdates: {} 
      };
    } catch (error) {
      console.error("OpenAI error:", error);
      return { 
        assistantMessage: "🤖 Sorry, something went wrong.", 
        uiPayload: {}, 
        contextUpdates: {} 
      };
    }
  }

  /**
   * Get session context from in-memory store
   * Creates new context if session doesn't exist
   * 
   * @param sessionId - Unique session identifier
   * @returns Current session context object
   */
  getContext(sessionId: string): Record<string, any> {
    // TODO: Add Supabase persistence for agentic_checkout_sessions table
    return this.sessions[sessionId] || {};
  }

  /**
   * Update session context with new data
   * Merges updates into existing context
   * 
   * @param sessionId - Unique session identifier
   * @param updates - Partial context updates to merge
   */
  updateContext(sessionId: string, updates: Record<string, any>): void {
    // TODO: Add Supabase persistence for agentic_checkout_sessions table
    this.sessions[sessionId] = { 
      ...(this.sessions[sessionId] || {}), 
      ...updates 
    };
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
    // TODO: Route to appropriate MCP tool based on toolName
    // TODO: Handle tool responses and errors
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
}

export default AIOrchestrator;
