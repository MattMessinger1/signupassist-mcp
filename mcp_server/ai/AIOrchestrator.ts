import OpenAI from "openai";

/**
 * Session context structure
 */
interface SessionContext {
  sessionId: string;
  userId?: string;
  conversationHistory: Array<{ role: string; content: string }>;
  currentStep?: string;
  credentials?: any;
  selectedPrograms?: any[];
  metadata?: Record<string, any>;
  lastUpdated: Date;
}

/**
 * Response structure from AI orchestrator
 */
interface OrchestratorResponse {
  assistantMessage: string;
  uiPayload?: {
    type: "card" | "options" | "confirmation" | "form" | "summary";
    data?: any;
  };
  contextUpdates?: Partial<SessionContext>;
}

/**
 * AIOrchestrator - The brain of SignupAssist
 * 
 * Handles all AI-driven interactions including:
 * - Conversational flow management
 * - Context persistence across sessions
 * - Tool calling for signup automation
 * - UI card/action suggestions
 */
export class AIOrchestrator {
  private openai: OpenAI;
  private contextCache: Map<string, SessionContext>;
  private systemPrompt: string;

  /**
   * Initialize the AI orchestrator
   * Sets up OpenAI client, context cache, and system prompt
   */
  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });

    this.contextCache = new Map();

    // System prompt defining SignupAssist's personality and behavior
    this.systemPrompt = `You are SignupAssist — a friendly, parent-focused automation assistant.

Your voice and style:
- Keep replies short and clear (2-3 sentences max)
- Use emojis sparingly (✅, 🎉, 🔍, ⚠️) to set context
- Always explain next steps clearly
- Speak in active voice ("I'll check..." not "The system will...")

Your core principles:
- Privacy first: Remind users their info stays secure with the provider
- Confirm before any irreversible action (payments, submissions)
- Guide users step-by-step through the signup process
- If something fails, explain clearly and offer alternatives

Conversation rhythm:
1. Assistant message (brief, actionable)
2. UI card/options (visual confirmation)
3. User response
4. Repeat

Key behaviors:
- When checking prerequisites: "🔍 Let me verify your account..."
- When finding programs: "I found 3 programs that match..."
- Before payment: "⚠️ Ready to pay $X.XX? I'll need your confirmation."
- After success: "✅ All set! [Child] is registered for [Program]."
- On error: "Hmm, [brief explanation]. Let's try [alternative]."

Never:
- Ask for credentials directly in chat
- Make assumptions about program selection
- Skip payment confirmations
- Use technical jargon`;
  }

  /**
   * Generate AI response for user message
   * 
   * @param userMessage - The user's input text
   * @param sessionId - Unique session identifier
   * @returns Structured response with message, UI payload, and context updates
   */
  async generateResponse(
    userMessage: string,
    sessionId: string
  ): Promise<OrchestratorResponse> {
    try {
      // Get current session context
      const context = this.getContext(sessionId);

      // Build conversation messages
      const messages = [
        { role: "system", content: this.systemPrompt },
        ...context.conversationHistory,
        { role: "user", content: userMessage },
      ];

      console.log(`[AIOrchestrator] Generating response for session ${sessionId}`);

      // Call OpenAI API
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages as any,
        temperature: 0.7,
        max_tokens: 500,
      });

      const assistantMessage = completion.choices[0]?.message?.content || "I'm not sure how to help with that.";

      // Update conversation history
      const updatedHistory = [
        ...context.conversationHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
      ];

      // Determine if we need UI components (stub for now)
      const uiPayload = this.determineUIPayload(assistantMessage, context);

      return {
        assistantMessage,
        uiPayload,
        contextUpdates: {
          conversationHistory: updatedHistory,
          lastUpdated: new Date(),
        },
      };
    } catch (error) {
      console.error(`[AIOrchestrator] Error generating response:`, error);
      return {
        assistantMessage: "I encountered an issue. Please try again.",
        contextUpdates: {
          lastUpdated: new Date(),
        },
      };
    }
  }

  /**
   * Get session context from cache
   * Creates new context if session doesn't exist
   * 
   * @param sessionId - Unique session identifier
   * @returns Current session context
   */
  getContext(sessionId: string): SessionContext {
    if (!this.contextCache.has(sessionId)) {
      // Initialize new session context
      const newContext: SessionContext = {
        sessionId,
        conversationHistory: [],
        lastUpdated: new Date(),
      };
      this.contextCache.set(sessionId, newContext);
      console.log(`[AIOrchestrator] Created new context for session ${sessionId}`);
    }

    return this.contextCache.get(sessionId)!;
  }

  /**
   * Update session context with new data
   * 
   * @param sessionId - Unique session identifier
   * @param updates - Partial context updates to merge
   */
  updateContext(sessionId: string, updates: Partial<SessionContext>): void {
    const currentContext = this.getContext(sessionId);
    const updatedContext = {
      ...currentContext,
      ...updates,
      lastUpdated: new Date(),
    };
    this.contextCache.set(sessionId, updatedContext);
    console.log(`[AIOrchestrator] Updated context for session ${sessionId}`, updates);
  }

  /**
   * Call a tool/helper function
   * 
   * This will integrate with MCP tools like:
   * - scp.check_prerequisites
   * - scp.discover_required_fields
   * - scp.submit_registration
   * 
   * @param toolName - Name of the tool to invoke
   * @param args - Arguments to pass to the tool
   * @returns Tool execution result
   */
  async callTool(toolName: string, args: any): Promise<any> {
    console.log(`[AIOrchestrator] Calling tool: ${toolName}`, args);

    // Stub implementation - will integrate with actual MCP tools later
    switch (toolName) {
      case "check_prerequisites":
        return { success: true, message: "Prerequisites checked" };
      
      case "discover_fields":
        return { success: true, fields: [] };
      
      case "submit_registration":
        return { success: true, confirmationId: "STUB-123" };
      
      default:
        console.warn(`[AIOrchestrator] Unknown tool: ${toolName}`);
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  /**
   * Determine what UI component should be shown (if any)
   * Based on assistant message content and current context
   * 
   * @param message - Assistant's response message
   * @param context - Current session context
   * @returns UI payload or undefined
   */
  private determineUIPayload(
    message: string,
    context: SessionContext
  ): OrchestratorResponse["uiPayload"] {
    // Stub implementation - will add intelligent detection later
    
    // Example: If message mentions payment, show confirmation card
    if (message.toLowerCase().includes("pay")) {
      return {
        type: "confirmation",
        data: { action: "payment", requiresConfirmation: true },
      };
    }

    // Example: If message lists programs, show options card
    if (message.toLowerCase().includes("found") && message.toLowerCase().includes("program")) {
      return {
        type: "options",
        data: { programs: context.selectedPrograms || [] },
      };
    }

    return undefined;
  }

  /**
   * Clear session context (useful for testing or logout)
   * 
   * @param sessionId - Session to clear
   */
  clearContext(sessionId: string): void {
    this.contextCache.delete(sessionId);
    console.log(`[AIOrchestrator] Cleared context for session ${sessionId}`);
  }

  /**
   * Get all active sessions (for monitoring/debugging)
   */
  getActiveSessions(): string[] {
    return Array.from(this.contextCache.keys());
  }
}
