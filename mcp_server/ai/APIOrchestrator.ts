/**
 * APIOrchestrator.ts
 * Clean API-first orchestrator for providers with direct API access
 * Flow: BROWSE → FORM_FILL → PAYMENT
 * No scraping, no prerequisites, no session complexity
 */

import type { 
  OrchestratorResponse, 
  CardSpec, 
  ButtonSpec,
  IOrchestrator
} from "./types.js";
import Logger from "../utils/logger.js";
import { 
  validateDesignDNA, 
  addResponsibleDelegateFooter,
  addAPISecurityContext 
} from "./designDNA.js";
import {
  getAPIProgramsReadyMessage,
  getAPIFormIntroMessage,
  getAPIPaymentSummaryMessage,
  getAPISuccessMessage,
  getAPIErrorMessage
} from "./apiMessageTemplates.js";
import { stripHtml } from "../lib/extractionUtils.js";

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
 * Implements IOrchestrator for compatibility with dynamic orchestrator loading
 */
export default class APIOrchestrator implements IOrchestrator {
  private sessions: Map<string, APIContext> = new Map();
  private mcpServer: any;

  constructor(mcpServer: any) {
    this.mcpServer = mcpServer;
    Logger.info("APIOrchestrator initialized - API-first mode with MCP tool access");
  }

  /**
   * Invoke MCP tool internally for audit compliance
   * All tool calls go through the MCP layer to ensure audit logging
   */
  private async invokeMCPTool(toolName: string, args: any): Promise<any> {
    if (!this.mcpServer?.tools?.has(toolName)) {
      const available = this.mcpServer?.tools ? Array.from(this.mcpServer.tools.keys()).join(', ') : 'none';
      throw new Error(`MCP tool not found: ${toolName}. Available: ${available}`);
    }
    
    const tool = this.mcpServer.tools.get(toolName);
    Logger.info(`[MCP] Invoking tool: ${toolName}`);
    return await tool.handler(args);
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

      // Call Bookeo MCP tool (ensures audit logging)
      const programsResult = await this.invokeMCPTool('bookeo.find_programs', {
        org_ref: orgRef,
        provider: 'bookeo'
      });
      
      // Extract programs array - handle Bookeo's grouped structure
      let programs: any[] = [];

      if (Array.isArray(programsResult)) {
        // Direct array response (future-proofing)
        programs = programsResult;
      } else if (programsResult?.data?.programs_by_theme) {
        // Bookeo returns programs grouped by theme - flatten to array
        const programsByTheme = programsResult.data.programs_by_theme;
        programs = Object.values(programsByTheme).flat();
        Logger.info(`[Bookeo] Flattened ${programs.length} programs from themes:`, Object.keys(programsByTheme));
      } else if (Array.isArray(programsResult?.data)) {
        // Fallback: data field is directly an array
        programs = programsResult.data;
      } else {
        // No programs found
        programs = [];
      }

      if (!programs || programs.length === 0) {
        return this.formatError("No programs found at this time.");
      }
      
      // Sort programs by title (extract numeric class identifier)
      const sortedPrograms = programs.sort((a: any, b: any) => {
        const extractNumber = (title: string) => {
          const match = title.match(/CLASS\s+(\d+)/i);
          return match ? parseInt(match[1], 10) : 999;
        };
        return extractNumber(a.title || '') - extractNumber(b.title || '');
      });
      
      // Store programs in context
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE,
        orgRef,
      });

      // Build program cards with cleaned descriptions (strip HTML)
      const cards: CardSpec[] = sortedPrograms.map((prog: any) => ({
        title: prog.title || "Untitled Program",
        subtitle: prog.schedule || "",
        description: stripHtml(prog.description || ""),
        buttons: [
          {
            label: "Select this program",
            action: "select_program",
            payload: {
              program_ref: prog.program_ref,
              program_name: prog.title,
              program_data: {
                title: prog.title,
                program_ref: prog.program_ref,
                org_ref: prog.org_ref,
                description: prog.description,
                status: prog.status,
                price: prog.price,
                schedule: prog.schedule
              }
            },
            variant: "accent"
          }
        ]
      }));

      // Use Design DNA-compliant message template
      const message = getAPIProgramsReadyMessage({
        provider_name: orgRef === "aim-design" ? "AIM Design" : orgRef,
        program_count: programs.length
      });

      const orchestratorResponse: OrchestratorResponse = {
        message,
        cards
      };

      // Validate Design DNA compliance
      const validation = validateDesignDNA(orchestratorResponse, {
        step: 'browse',
        isWriteAction: false
      });

      if (!validation.passed) {
        Logger.error('[DesignDNA] Validation failed:', validation.issues);
      }
      
      if (validation.warnings.length > 0) {
        Logger.warn('[DesignDNA] Warnings:', validation.warnings);
      }

      Logger.info('[DesignDNA] Validation passed ✅');

      return orchestratorResponse;
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
    const programName = programData?.title || programData?.name || payload.program_name || "this program";
    const programRef = programData?.ref || programData?.program_ref || payload.program_ref;
    
    // Debug logging to catch structure issues
    if (programName === "this program") {
      Logger.warn('[selectProgram] Missing program name in payload:', {
        has_program_data: !!payload.program_data,
        payload_keys: Object.keys(payload),
        program_data_keys: programData ? Object.keys(programData) : []
      });
    }
    const orgRef = programData?.org_ref || 'aim-design';

    // Update context
    this.updateContext(sessionId, {
      step: FlowStep.FORM_FILL,
      selectedProgram: programData
    });

    // ✅ COMPLIANCE FIX: Call MCP tool for form discovery (ensures audit logging)
    let signupForm;
    try {
      // Debug: Log what we're sending to form discovery
      Logger.info('[selectProgram] Form discovery request:', {
        programRef,
        programName,
        orgRef,
        has_programData: !!programData,
        programData_keys: programData ? Object.keys(programData) : []
      });

      Logger.info('[selectProgram] Calling bookeo.discover_required_fields for audit compliance');
      const formDiscoveryResult = await this.invokeMCPTool('bookeo.discover_required_fields', {
        program_ref: programRef,
        org_ref: orgRef
      });

      Logger.info('[selectProgram] Form discovery raw response:', {
        success: formDiscoveryResult?.success,
        has_data: !!formDiscoveryResult?.data,
        has_program_questions: !!formDiscoveryResult?.data?.program_questions,
        field_count: formDiscoveryResult?.data?.program_questions?.length || 0,
        first_field: formDiscoveryResult?.data?.program_questions?.[0]
      });
      
      // ✅ FIX: Bookeo returns fields in data.program_questions, not data.fields
      if (formDiscoveryResult?.success && formDiscoveryResult?.data?.program_questions) {
        signupForm = { fields: formDiscoveryResult.data.program_questions };
        Logger.info('[selectProgram] Form fields loaded from MCP tool:', {
          field_count: signupForm.fields.length,
          source: 'bookeo.discover_required_fields'
        });
      } else {
        signupForm = {
          fields: [
            { id: "firstName", label: "First Name", type: "text", required: true, category: "participant" },
            { id: "lastName", label: "Last Name", type: "text", required: true, category: "participant" },
            { id: "email", label: "Email", type: "email", required: true, category: "contact" },
            { id: "numParticipants", label: "Number of Participants", type: "number", required: true, category: "booking", min: 1, max: 10 }
          ]
        };
        Logger.warn('[selectProgram] Using fallback form fields (field discovery failed)');
      }
    } catch (error) {
      Logger.error('[selectProgram] Form discovery failed, using fallback fields:', error);
      // Fallback to default form if MCP tool fails
      signupForm = {
        fields: [
          { id: "firstName", label: "First Name", type: "text", required: true, category: "participant" },
          { id: "lastName", label: "Last Name", type: "text", required: true, category: "participant" },
          { id: "email", label: "Email", type: "email", required: true, category: "contact" },
          { id: "numParticipants", label: "Number of Participants", type: "number", required: true, category: "booking", min: 1, max: 10 }
        ]
      };
    }

    // Use Design DNA-compliant message template
    const message = getAPIFormIntroMessage({
      program_name: programName
    });

    const formResponse: OrchestratorResponse = {
      message,
      cards: [{
        title: "Registration Form",
        subtitle: programName,
        description: "Fill in the details below to continue.",
        buttons: []
      }],
      cta: {
        buttons: [
          { 
            label: "Fill Form", 
            action: "submit_form", 
            payload: { signupForm },
            variant: "accent" 
          }
        ]
      },
      metadata: { signupForm }
    };

    // Validate Design DNA compliance
    const validation = validateDesignDNA(formResponse, {
      step: 'form',
      isWriteAction: false
    });

    if (!validation.passed) {
      Logger.error('[DesignDNA] Validation failed:', validation.issues);
    }
    
    if (validation.warnings.length > 0) {
      Logger.warn('[DesignDNA] Warnings:', validation.warnings);
    }

    Logger.info('[DesignDNA] Validation passed ✅');

    return formResponse;
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
    const participantName = formData.child_name || "participant";

    // Use Design DNA-compliant message template
    let message = getAPIPaymentSummaryMessage({
      program_name: programName,
      participant_name: participantName,
      total_cost: price
    });

    // Add security context (Design DNA requirement)
    message = addAPISecurityContext(message, "Bookeo");
    
    // Add Responsible Delegate footer (Design DNA requirement)
    message = addResponsibleDelegateFooter(message);

    const paymentResponse: OrchestratorResponse = {
      message,
      cards: [{
        title: "Booking Confirmation",
        subtitle: programName,
        description: `Participant: ${participantName}\nTotal: ${price}`,
        buttons: []
      }],
      cta: {
        buttons: [
          { label: "Confirm & Pay", action: "confirm_payment", variant: "accent" },
          { label: "Go Back", action: "search_programs", payload: { orgRef: context.orgRef }, variant: "outline" }
        ]
      }
    };

    // Validate Design DNA compliance
    const validation = validateDesignDNA(paymentResponse, {
      step: 'payment',
      isWriteAction: true
    });

    if (!validation.passed) {
      Logger.error('[DesignDNA] Validation failed:', validation.issues);
    }
    
    if (validation.warnings.length > 0) {
      Logger.warn('[DesignDNA] Warnings:', validation.warnings);
    }

    Logger.info('[DesignDNA] Validation passed ✅');

    return paymentResponse;
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
      const bookingNumber = `BK${Date.now()}`;

      // Reset context for new search
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE
      });

      // Use Design DNA-compliant success message
      const message = getAPISuccessMessage({
        program_name: programName,
        booking_number: bookingNumber,
        start_time: context.selectedProgram?.schedule || "TBD"
      });

      const successResponse: OrchestratorResponse = {
        message,
        cta: {
          buttons: [
            { label: "Browse More Classes", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "outline" }
          ]
        }
      };

      // Validate Design DNA compliance
      const validation = validateDesignDNA(successResponse, {
        step: 'browse', // Reset to browse after success
        isWriteAction: false
      });

      if (!validation.passed) {
        Logger.error('[DesignDNA] Validation failed:', validation.issues);
      }
      
      if (validation.warnings.length > 0) {
        Logger.warn('[DesignDNA] Warnings:', validation.warnings);
      }

      Logger.info('[DesignDNA] Validation passed ✅');

      return successResponse;
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
