/**
 * APIOrchestrator.ts
 * Clean API-first orchestrator for providers with direct API access
 * Flow: BROWSE → FORM_FILL → PAYMENT
 * No scraping, no prerequisites, no session complexity
 */

import type { 
  OrchestratorResponse, 
  CardSpec, 
  ButtonSpec 
} from "./types.js";
import Logger from "../utils/logger.js";
import * as bookeoProvider from "../providers/bookeo.js";

// Simple flow steps for API-first providers
enum FlowStep {
  BROWSE = "BROWSE",           // User browses programs
  FORM_FILL = "FORM_FILL",     // User fills signup form
  PAYMENT = "PAYMENT"          // User confirms payment
}

// Minimal context for API-first flow
interface APIContext {
  step: FlowStep;
  orgRef?: string;
  selectedProgram?: any;
  formData?: Record<string, any>;
  childInfo?: {
    name: string;
    age?: number;
    dob?: string;
  };
}

/**
 * APIOrchestrator
 * Handles conversation flow for API-first providers (Bookeo, future API integrations)
 */
export default class APIOrchestrator {
  private sessions: Map<string, APIContext> = new Map();

  constructor() {
    Logger.info("APIOrchestrator initialized - API-first mode");
  }

  /**
   * Main entry point: process user message or action
   */
  async generateResponse(
    input: string,
    sessionId: string,
    action?: string,
    payload?: any
  ): Promise<OrchestratorResponse> {
    try {
      const context = this.getContext(sessionId);
      
      // Handle explicit actions (button clicks)
      if (action) {
        return await this.handleAction(action, payload, sessionId, context);
      }

      // Handle natural language messages
      return await this.handleMessage(input, sessionId, context);
    } catch (error) {
      Logger.error("APIOrchestrator error:", error);
      return this.formatError("Sorry, something went wrong. Please try again.");
    }
  }

  /**
   * Handle action (button click)
   */
  private async handleAction(
    action: string,
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    switch (action) {
      case "search_programs":
        return await this.searchPrograms(payload.orgRef || "aim-design", sessionId);

      case "select_program":
        return await this.selectProgram(payload, sessionId, context);

      case "submit_form":
        return await this.submitForm(payload, sessionId, context);

      case "confirm_payment":
        return await this.confirmPayment(payload, sessionId, context);

      default:
        return this.formatError(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle natural language message
   */
  private async handleMessage(
    input: string,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const inputLower = input.toLowerCase();

    // Detect provider mention (currently only AIM Design)
    if (inputLower.includes("aim") || inputLower.includes("design") || 
        inputLower.includes("class") || inputLower.includes("program")) {
      return await this.searchPrograms("aim-design", sessionId);
    }

    // Context-aware responses
    switch (context.step) {
      case FlowStep.FORM_FILL:
        return this.formatResponse(
          "Please fill out the signup form to continue.",
          undefined,
          [{ label: "Continue", action: "submit_form", variant: "accent" }]
        );

      case FlowStep.PAYMENT:
        return this.formatResponse(
          "Ready to complete your booking?",
          undefined,
          [{ label: "Confirm Payment", action: "confirm_payment", variant: "accent" }]
        );

      default:
        return this.formatResponse(
          "I can help you find classes from AIM Design. What are you looking for?",
          undefined,
          [{ label: "Show All Classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "secondary" }]
        );
    }
  }

  /**
   * Search and display programs from API provider
   */
  private async searchPrograms(
    orgRef: string,
    sessionId: string
  ): Promise<OrchestratorResponse> {
    try {
      Logger.info(`Searching programs for org: ${orgRef}`);

      // Call Bookeo provider
      const result = await bookeoProvider.findProgramsMultiBackend({ org_ref: orgRef });

      if (!result.success || !result.data?.programs) {
        return this.formatError("No programs found at this time.");
      }

      const programs = result.data.programs;
      
      // Store programs in context
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE,
        orgRef,
      });

      // Build program cards
      const cards: CardSpec[] = programs.map((prog: any) => ({
        title: prog.title || "Untitled Program",
        subtitle: prog.schedule || "",
        caption: prog.price || "Price varies",
        body: prog.description || "",
        actions: [
          {
            label: "Select this program",
            action: "select_program",
            payload: {
              program_ref: prog.ref,
              program_data: prog
            },
            variant: "accent"
          }
        ]
      }));

      return this.formatResponse(
        `Here are the available classes from **${orgRef === "aim-design" ? "AIM Design" : orgRef}**:`,
        cards
      );
    } catch (error) {
      Logger.error("Error searching programs:", error);
      return this.formatError("Failed to load programs. Please try again.");
    }
  }

  /**
   * Select a program and prepare signup form
   */
  private async selectProgram(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const programData = payload.program_data;
    const programName = programData?.title || "this program";

    // Update context
    this.updateContext(sessionId, {
      step: FlowStep.FORM_FILL,
      selectedProgram: programData
    });

    // Get signup form schema (from cached_provider_feed)
    const signupForm = programData?.signup_form || {
      fields: [
        { name: "child_name", label: "Child's Name", type: "text", required: true },
        { name: "child_age", label: "Child's Age", type: "number", required: true },
        { name: "parent_email", label: "Parent Email", type: "email", required: true },
        { name: "parent_phone", label: "Parent Phone", type: "tel", required: false }
      ]
    };

    return this.formatResponse(
      `Great! Let's sign you up for **${programName}**. Please provide the following information:`,
      undefined,
      [
        { 
          label: "Fill Form", 
          action: "submit_form", 
          payload: { signupForm },
          variant: "accent" 
        }
      ],
      { signupForm }
    );
  }

  /**
   * Process signup form submission
   */
  private async submitForm(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { formData } = payload;

    if (!formData || !context.selectedProgram) {
      return this.formatError("Missing form data or program selection.");
    }

    // Store form data
    this.updateContext(sessionId, {
      step: FlowStep.PAYMENT,
      formData
    });

    const programName = context.selectedProgram?.title || "Selected Program";
    const price = context.selectedProgram?.price || "Price varies";

    return this.formatResponse(
      `Perfect! Here's your booking summary:\n\n**Program:** ${programName}\n**Price:** ${price}\n\nReady to complete your booking?`,
      undefined,
      [
        { label: "Confirm & Pay", action: "confirm_payment", variant: "accent" },
        { label: "Go Back", action: "search_programs", payload: { orgRef: context.orgRef }, variant: "secondary" }
      ]
    );
  }

  /**
   * Confirm payment and complete booking
   */
  private async confirmPayment(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    try {
      // TODO: Call Bookeo API to create booking
      // For now, simulate success
      Logger.info("Processing payment for session:", sessionId);

      const programName = context.selectedProgram?.title || "program";

      // Reset context for new search
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE
      });

      return this.formatResponse(
        `🎉 Success! You're all signed up for **${programName}**.\n\nYou'll receive a confirmation email shortly with all the details.`,
        undefined,
        [
          { label: "Browse More Classes", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "secondary" }
        ]
      );
    } catch (error) {
      Logger.error("Payment error:", error);
      return this.formatError("Payment failed. Please try again or contact support.");
    }
  }

  /**
   * Format successful response
   */
  private formatResponse(
    message: string,
    cards?: CardSpec[],
    buttons?: ButtonSpec[],
    metadata?: any
  ): OrchestratorResponse {
    return {
      message,
      cards,
      cta: buttons ? { buttons } : undefined,
      metadata
    };
  }

  /**
   * Format error response
   */
  private formatError(message: string): OrchestratorResponse {
    return {
      message: `❌ ${message}`,
      cards: undefined,
      cta: undefined
    };
  }

  /**
   * Get session context (auto-initialize if needed)
   */
  private getContext(sessionId: string): APIContext {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        step: FlowStep.BROWSE
      });
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Update session context
   */
  private updateContext(sessionId: string, updates: Partial<APIContext>): void {
    const current = this.getContext(sessionId);
    this.sessions.set(sessionId, { ...current, ...updates });
  }

  /**
   * Reset session context
   */
  public resetContext(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
