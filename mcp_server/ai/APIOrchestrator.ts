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
  getPaymentAuthorizationMessage,
  getAPISuccessMessage,
  getAPIErrorMessage
} from "./apiMessageTemplates.js";
import { stripHtml } from "../lib/extractionUtils.js";
import { formatInTimeZone } from "date-fns-tz";

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
  user_id?: string;
  userTimezone?: string;  // User's IANA timezone (e.g., 'America/Chicago')
  selectedProgram?: any;
  formData?: Record<string, any>;
  numParticipants?: number;
  childInfo?: {
    name: string;
    age?: number;
    dob?: string;
  };
  schedulingData?: {
    scheduled_time: string;
    event_id: string;
    total_amount: string;
    program_fee: string;
    formData: any;
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
   * Get Supabase client for database operations
   * Creates client on-demand with service role key
   */
  private getSupabaseClient() {
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Format time for user's timezone
   * Uses user's IANA timezone from context, falls back to UTC
   */
  private formatTimeForUser(date: Date | string, context: APIContext): string {
    const timezone = context.userTimezone || 'UTC';
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    return formatInTimeZone(
      dateObj,
      timezone,
      'MMM d, yyyy \'at\' h:mm a zzz'
    );
  }

  /**
   * Main entry point: process user message or action
   * @param userTimezone - User's IANA timezone (e.g., 'America/Chicago')
   */
  async generateResponse(
    input: string,
    sessionId: string,
    action?: string,
    payload?: any,
    userTimezone?: string
  ): Promise<OrchestratorResponse> {
    try {
      const context = this.getContext(sessionId);
      
      // Store user timezone in context
      if (userTimezone && userTimezone !== context.userTimezone) {
        this.updateContext(sessionId, { userTimezone });
      }
      
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

      case "schedule_auto_registration":
        return await this.scheduleAutoRegistration(payload, sessionId, context);

      case "confirm_scheduled_registration":
        return await this.confirmScheduledRegistration(payload, sessionId, context);

      case "setup_payment_method":
        return await this.setupPaymentMethod(payload, sessionId, context);

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

      // Get context for timezone formatting
      const context = this.getContext(sessionId);

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

      // Build program cards with timing badges and cleaned descriptions
      const cards: CardSpec[] = sortedPrograms.map((prog: any) => {
        // Determine booking status at runtime (don't trust stale cached data)
        const determineBookingStatus = (program: any): string => {
          const hasAvailableSlots = program.next_available_slot || (program.available_slots && program.available_slots > 0);
          if (hasAvailableSlots) return 'open_now';
          if (program.booking_status === 'sold_out') return 'sold_out';
          return program.booking_status || 'open_now';
        };
        
        const bookingStatus = determineBookingStatus(prog);
        const earliestSlot = prog.earliest_slot_time ? new Date(prog.earliest_slot_time) : null;
        
        // Generate timing badge
        let timingBadge = '';
        let isDisabled = false;
        let buttonLabel = "Select this program";
        
        if (bookingStatus === 'sold_out') {
          timingBadge = '🚫 Sold Out';
          isDisabled = true;
          buttonLabel = "Waitlist (Coming Soon)";
        } else if (bookingStatus === 'opens_later' && earliestSlot) {
          timingBadge = `📅 Opens ${this.formatTimeForUser(earliestSlot, context)}`;
          buttonLabel = "Schedule Auto-Register";
        } else if (bookingStatus === 'open_now') {
          timingBadge = '✅ Register Now';
        }
        
        return {
          title: prog.title || "Untitled Program",
          subtitle: `${prog.schedule || ""} ${timingBadge ? `• ${timingBadge}` : ''}`.trim(),
          description: stripHtml(prog.description || ""),
          buttons: [
            {
              label: buttonLabel,
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
                  schedule: prog.schedule,
                  booking_status: bookingStatus,
                  earliest_slot_time: prog.earliest_slot_time,
                  event_id: prog.event_id || prog.program_ref
                }
              },
              variant: isDisabled ? "outline" : "accent",
              disabled: isDisabled
            }
          ]
        };
      });

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
    console.log('[selectProgram] 🔍 Starting with sessionId:', sessionId);
    console.log('[selectProgram] 🔍 Payload keys:', Object.keys(payload));
    console.log('[selectProgram] 🔍 Full payload:', JSON.stringify(payload, null, 2));
    
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
    
    console.log('[selectProgram] ✅ Context updated - selectedProgram stored:', {
      sessionId,
      program_ref: programRef,
      program_name: programName,
      has_selectedProgram_in_map: !!this.sessions.get(sessionId)?.selectedProgram
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

      // Determine registration timing and add transparency message
      // Runtime status check (don't trust stale cached data)
      const determineBookingStatus = (program: any): string => {
        const hasAvailableSlots = program?.next_available_slot || (program?.available_slots && program.available_slots > 0);
        if (hasAvailableSlots) return 'open_now';
        if (program?.booking_status === 'sold_out') return 'sold_out';
        return program?.booking_status || 'open_now';
      };
      
      const bookingStatus = determineBookingStatus(programData);
      const earliestSlot = programData?.earliest_slot_time ? new Date(programData.earliest_slot_time) : null;

      let timingMessage = '';
      if (bookingStatus === 'open_now') {
        timingMessage = '✅ Registration is currently open! Complete the form and you can register immediately.\n\n';
      } else if (bookingStatus === 'opens_later' && earliestSlot) {
        timingMessage = `📅 Registration opens on ${this.formatTimeForUser(earliestSlot, context)}.\n\n` +
                        `Fill out the form now and we'll automatically register you the moment it opens. ` +
                        `You'll only be charged if registration succeeds!\n\n`;
      }

      Logger.info('[selectProgram] Calling bookeo.discover_required_fields for audit compliance');
      const formDiscoveryResult = await this.invokeMCPTool('bookeo.discover_required_fields', {
        program_ref: programRef,
        org_ref: orgRef
      });

      Logger.info('[selectProgram] Form discovery raw response:', {
        success: formDiscoveryResult?.success,
        has_data: !!formDiscoveryResult?.data,
        has_program_questions: !!formDiscoveryResult?.data?.program_questions
      });
      
      // Use Design DNA-compliant message template with timing transparency
      let message = timingMessage + getAPIFormIntroMessage({
        program_name: programName,
        provider_name: "AIM Design"
      });
      
      message += "\n\n**As the Responsible Delegate**, you'll provide your information first, then details for each participant.";

      // Return form schema directly from MCP tool (two-tier structure from database)
      const formResponse: OrchestratorResponse = {
        message,
        metadata: {
          signupForm: formDiscoveryResult.data?.program_questions || {},
          program_ref: programRef,
          org_ref: orgRef,
          program_name: programName
        }
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
    } catch (error) {
      Logger.error('[selectProgram] Error:', error);
      return this.formatError(`Failed to load program form: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process signup form submission
   */
  private async submitForm(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    console.log('[submitForm] 🔍 Starting with sessionId:', sessionId);
    console.log('[submitForm] 🔍 Payload keys:', Object.keys(payload));
    console.log('[submitForm] 🔍 Context keys:', Object.keys(context));
    console.log('[submitForm] 🔍 Context step:', context.step);
    console.log('[submitForm] 🔍 Has selectedProgram in context:', !!context.selectedProgram);
    console.log('[submitForm] 🔍 Full context:', JSON.stringify(context, null, 2));
    
    const { formData } = payload;

    if (!formData || !context.selectedProgram) {
      console.log('[submitForm] ❌ VALIDATION FAILED:', {
        hasFormData: !!formData,
        hasSelectedProgram: !!context.selectedProgram,
        sessionId
      });
      return this.formatError("❌ Missing form data or program selection.");
    }

    // Extract structured data from two-tier form
    const numParticipants = formData.numParticipants || formData.participants?.length || 1;
    const participants = formData.participants || [];
    
    // Build participant names list
    const participantNames = participants.map((p: any) => 
      `${p.firstName || ''} ${p.lastName || ''}`.trim() || "participant"
    );
    
    // Format participant list for display
    const participantList = participantNames.length === 1 
      ? participantNames[0]
      : participantNames.map((name: string, idx: number) => `${idx + 1}. ${name}`).join('\n');

    // Store form data and participant count
    this.updateContext(sessionId, {
      step: FlowStep.PAYMENT,
      formData,
      numParticipants
    });

    const programName = context.selectedProgram?.title || "Selected Program";
    
    // Calculate total price based on number of participants
    const priceString = context.selectedProgram?.price || "0";
    
    // Validate pricing before proceeding
    if (priceString === "Price varies" || priceString === "0" || !priceString) {
      Logger.warn(`[APIOrchestrator] Invalid pricing for ${context.selectedProgram?.title}: "${priceString}"`);
      return this.formatError(
        `We're unable to calculate pricing for ${context.selectedProgram?.title}. Please contact support or try another program.`
      );
    }
    
    const basePrice = parseFloat(priceString.replace(/[^0-9.]/g, ''));
    
    if (isNaN(basePrice) || basePrice <= 0) {
      Logger.error(`[APIOrchestrator] Failed to parse price "${priceString}" for ${context.selectedProgram?.title}`);
      return this.formatError(
        `Pricing information is incomplete. Please try again or contact support.`
      );
    }
    
    const totalPrice = basePrice * numParticipants;
    const formattedTotal = `$${totalPrice.toFixed(2)}`;
    
    // Calculate grand total (program fee + $20 success fee)
    const successFee = 20.00;
    const grandTotal = `$${(totalPrice + successFee).toFixed(2)}`;

    // Use Design DNA-compliant dual-charge message template
    let message = getPaymentAuthorizationMessage({
      program_name: programName,
      participant_name: participantList,
      total_cost: formattedTotal, // This is the program fee only
      num_participants: numParticipants
    });
    
    // Add delegate authorization context
    if (formData.delegate?.delegate_firstName && formData.delegate?.delegate_lastName) {
      const delegateName = `${formData.delegate.delegate_firstName} ${formData.delegate.delegate_lastName}`;
      const relationship = formData.delegate.delegate_relationship || 'Responsible Delegate';
      message += `\n\n**Authorized by:** ${delegateName} (${relationship})`;
    }

    // Add security context (Design DNA requirement)
    message = addAPISecurityContext(message, "Bookeo");
    
    // Add Responsible Delegate footer (Design DNA requirement)
    message = addResponsibleDelegateFooter(message);

    // Check if this is a future booking (Set & Forget flow) or immediate registration
    // Runtime status check (don't trust stale cached data)
    const determineBookingStatus = (program: any): string => {
      const hasAvailableSlots = program?.next_available_slot || (program?.available_slots && program.available_slots > 0);
      if (hasAvailableSlots) return 'open_now';
      if (program?.booking_status === 'sold_out') return 'sold_out';
      return program?.booking_status || 'open_now';
    };
    
    const bookingStatus = determineBookingStatus(context.selectedProgram);
    const earliestSlot = context.selectedProgram?.earliest_slot_time 
      ? new Date(context.selectedProgram.earliest_slot_time) 
      : null;
    const isFutureBooking = bookingStatus === 'opens_later' && earliestSlot && earliestSlot > new Date();

    // Build conditional payment button
    let buttons: any[] = [];
    let paymentMessage = message;

    if (isFutureBooking && earliestSlot) {
      // Set & Forget flow: Show auto-register button
      paymentMessage += `\n\n📅 This class opens for booking on ${earliestSlot.toLocaleString()}. We can automatically register you the moment it opens!`;
      
      buttons = [
        { 
          label: `⏰ Auto-Register on ${earliestSlot.toLocaleDateString()}`, 
          action: "schedule_auto_registration",
          payload: {
            scheduled_time: earliestSlot.toISOString(),
            event_id: context.selectedProgram.event_id || context.selectedProgram.program_ref,
            total_amount: grandTotal,
            program_fee: formattedTotal,
            formData
          },
          variant: "accent" 
        },
        { label: "Go Back", action: "search_programs", payload: { orgRef: context.orgRef }, variant: "outline" }
      ];
    } else {
      // Immediate registration flow: Show confirm & pay button
      buttons = [
        { label: "Confirm & Pay", action: "confirm_payment", variant: "accent" },
        { label: "Go Back", action: "search_programs", payload: { orgRef: context.orgRef }, variant: "outline" }
      ];
    }

    const paymentResponse: OrchestratorResponse = {
      message: paymentMessage,
      cards: [{
        title: "Confirm Booking & Payment",
        subtitle: programName,
        description: `Participants:\n${participantList}\n\nCharges:\n• Program Fee: ${formattedTotal} (to provider)\n• SignupAssist Success Fee: $20.00 (only if booking succeeds)\n\nTotal: ${grandTotal}`,
        buttons: []
      }],
      cta: {
        buttons
      }
    };

    // Store form data in context for confirmPayment to access
    this.updateContext(sessionId, {
      step: FlowStep.PAYMENT,
      formData: {
        delegate_data: formData.delegate,
        participant_data: formData.participants,
        num_participants: numParticipants,
        event_id: context.selectedProgram?.event_id || context.selectedProgram?.program_ref
      }
    });

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
   * Confirm payment and complete immediate booking (Phase A implementation)
   * Orchestrates: 1) Verify payment method → 2) Book with Bookeo → 3) Charge success fee → 4) Return confirmation
   */
  private async confirmPayment(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    try {
      Logger.info("[confirmPayment] Starting immediate booking flow");

      // Get booking data from context (stored by submitForm)
      const formData = context.formData;
      
      // DEBUG: Log the entire formData object to see what we're working with
      Logger.info("[confirmPayment] 🔍 Full formData from context:", {
        formData: JSON.stringify(formData, null, 2),
        keys: formData ? Object.keys(formData) : []
      });
      
      const delegate_data = formData?.delegate_data;
      const participant_data = formData?.participant_data;
      const num_participants = formData?.num_participants;
      const event_id = formData?.event_id;
      
      const programName = context.selectedProgram?.title || "program";
      const programRef = context.selectedProgram?.program_ref;
      const orgRef = context.selectedProgram?.org_ref || context.orgRef;

      // Validation with detailed logging
      if (!delegate_data || !participant_data || !event_id || !programRef || !orgRef) {
        Logger.error("[confirmPayment] Missing required data", {
          has_formData: !!formData,
          has_delegate: !!delegate_data,
          has_participants: !!participant_data,
          has_event_id: !!event_id,
          has_program_ref: !!programRef,
          // Log what we actually have
          delegate_data_preview: delegate_data ? 'exists' : 'MISSING',
          participant_data_preview: participant_data ? 'exists' : 'MISSING'
        });
        return this.formatError("Missing required booking information. Please try again.");
      }

      Logger.info("[confirmPayment] Validated booking data", { 
        program_ref: programRef, 
        org_ref: orgRef,
        num_participants,
        delegate_email: delegate_data.email,
        num_participants_in_array: participant_data.length
      });

      // Map form field names to Bookeo API format (API-first, ChatGPT compliant)
      const mappedDelegateData = {
        firstName: delegate_data.delegate_firstName,
        lastName: delegate_data.delegate_lastName,
        email: delegate_data.delegate_email,
        phone: delegate_data.delegate_phone,
        dateOfBirth: delegate_data.delegate_dob,
        relationship: delegate_data.delegate_relationship
      };

      const mappedParticipantData = participant_data.map((p: any) => ({
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dob,  // Form uses 'dob', API expects 'dateOfBirth'
        grade: p.grade,
        allergies: p.allergies
      }));

      // Step 1: Book with Bookeo via MCP tool
      Logger.info("[confirmPayment] Calling bookeo.confirm_booking...");
      const bookingResponse = await this.invokeMCPTool('bookeo.confirm_booking', {
        event_id,
        program_ref: programRef,
        org_ref: orgRef,
        delegate_data: mappedDelegateData,
        participant_data: mappedParticipantData,
        num_participants
      });

      if (!bookingResponse.success || !bookingResponse.data?.booking_number) {
        Logger.error("[confirmPayment] Booking failed", bookingResponse);
        return this.formatError(
          bookingResponse.error?.display || "Failed to create booking. Please try again."
        );
      }

      const { booking_number, start_time } = bookingResponse.data;
      Logger.info("[confirmPayment] ✅ Booking confirmed:", { booking_number });

      // Step 2: Create mandate for success fee
      // TODO: Integrate mandate creation when mandate MCP tools are available
      const mandate_id = `temp_mandate_${Date.now()}`;
      Logger.info("[confirmPayment] Using temporary mandate ID:", mandate_id);

      // Step 3: Charge $20 success fee via MCP tool (audit-compliant)
      Logger.info("[confirmPayment] Charging success fee...");
      try {
        const feeResult = await this.invokeMCPTool('stripe.charge_success_fee', {
          booking_number,
          mandate_id,
          amount_cents: 2000 // $20 success fee
        });

        if (!feeResult.success) {
          Logger.warn("[confirmPayment] Success fee charge failed (non-fatal):", feeResult.error);
          // Don't fail the entire flow - booking was successful
        } else {
          Logger.info("[confirmPayment] ✅ Success fee charged:", feeResult.data?.charge_id);
        }
      } catch (feeError) {
        Logger.warn("[confirmPayment] Success fee exception (non-fatal):", feeError);
        // Continue - booking was successful even if fee failed
      }

      // Step 4: Reset context and return success
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE
      });

      // Use Design DNA-compliant success message
      const message = getAPISuccessMessage({
        program_name: programName,
        booking_number,
        start_time: start_time || "TBD"
      });

      const successResponse: OrchestratorResponse = {
        message,
        cta: {
          buttons: [
            { 
              label: "Browse More Classes", 
              action: "search_programs", 
              payload: { orgRef: orgRef || "aim-design" }, 
              variant: "outline" 
            }
          ]
        }
      };

      // Validate Design DNA compliance
      const validation = validateDesignDNA(successResponse, {
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
      Logger.info("[confirmPayment] ✅ Immediate booking flow complete");

      return successResponse;
    } catch (error) {
      Logger.error("[confirmPayment] Unexpected error:", error);
      return this.formatError("Booking failed due to unexpected error. Please contact support.");
    }
  }

  /**
   * Set up Stripe payment method (Phase 3: MCP-compliant payment setup)
   * Routes through Stripe MCP tools for audit compliance
   */
  private async setupPaymentMethod(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    try {
      Logger.info("[setupPaymentMethod] Starting payment setup flow");

      const { payment_method_id, user_id, email, user_jwt } = payload;

      // Validation
      if (!payment_method_id || !user_id || !email || !user_jwt) {
        Logger.error("[setupPaymentMethod] Missing required data", { 
          has_payment_method_id: !!payment_method_id,
          has_user_id: !!user_id,
          has_email: !!email,
          has_user_jwt: !!user_jwt
        });
        return this.formatError("Missing payment information. Please try again.");
      }

      Logger.info("[setupPaymentMethod] Validated payment setup data", { 
        payment_method_id,
        user_id,
        email: email.substring(0, 3) + '***' // Partial log for privacy
      });

      // Step 1: Create Stripe customer via MCP tool (audit-compliant)
      Logger.info("[setupPaymentMethod] Creating Stripe customer...");
      const customerResponse = await this.invokeMCPTool('stripe.create_customer', {
        user_id,
        email
      });

      if (!customerResponse.success || !customerResponse.data?.customer_id) {
        Logger.error("[setupPaymentMethod] Customer creation failed", customerResponse);
        return this.formatError(
          customerResponse.error?.display || "Failed to set up payment account. Please try again."
        );
      }

      const customer_id = customerResponse.data.customer_id;
      Logger.info("[setupPaymentMethod] ✅ Customer created:", customer_id);

      // Step 2: Save payment method via MCP tool (audit-compliant)
      Logger.info("[setupPaymentMethod] Saving payment method...");
      const saveResponse = await this.invokeMCPTool('stripe.save_payment_method', {
        payment_method_id,
        customer_id,
        user_jwt
      });

      if (!saveResponse.success) {
        Logger.error("[setupPaymentMethod] Payment method save failed", saveResponse);
        return this.formatError(
          saveResponse.error?.display || "Failed to save payment method. Please try again."
        );
      }

      Logger.info("[setupPaymentMethod] ✅ Payment method saved:", payment_method_id);

      // Step 3: Continue to scheduled registration confirmation
      // Store user_id in context for mandate creation
      this.updateContext(sessionId, { user_id });
      
      // The frontend should have stored schedulingData - retrieve from payload
      const schedulingData = payload.schedulingData || context.schedulingData;
      
      if (!schedulingData) {
        Logger.error("[setupPaymentMethod] No scheduling data found");
        return this.formatError("Scheduling information missing. Please try again.");
      }

      Logger.info("[setupPaymentMethod] ✅ Payment setup complete, proceeding to confirmation");

      // Call confirmScheduledRegistration directly
      return await this.confirmScheduledRegistration(
        { schedulingData }, 
        sessionId, 
        context
      );

    } catch (error) {
      Logger.error("[setupPaymentMethod] Unexpected error:", error);
      return this.formatError("Payment setup failed due to unexpected error. Please try again.");
    }
  }

  /**
   * Schedule auto-registration for future booking (Set & Forget)
   * Validates 31-day limit before proceeding
   */
  private async scheduleAutoRegistration(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { scheduled_time, event_id, total_amount, program_fee, formData } = payload;
    
    // Validate 31-day scheduling limit
    const scheduledDate = new Date(scheduled_time);
    const now = new Date();
    const daysUntilScheduled = Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilScheduled > 31) {
      Logger.warn(`[scheduleAutoRegistration] Rejected: ${daysUntilScheduled} days out (max 31 days)`);
      return this.formatError(
        `Auto-registration is only available up to 31 days in advance. ` +
        `This class opens in ${daysUntilScheduled} days. Please return closer to the registration date.`
      );
    }
    
    Logger.info(`[scheduleAutoRegistration] Validated: ${daysUntilScheduled} days out (within 31-day limit)`);
    
    // Store scheduling data in context for next step
    this.updateContext(sessionId, {
      schedulingData: {
        scheduled_time,
        event_id,
        total_amount,
        program_fee,
        formData
      }
    });
    
    // Trigger payment method setup
    return {
      message: `We'll automatically register you on ${scheduledDate.toLocaleString()}.\n\n` +
               `First, let's save your payment method securely. You'll only be charged if registration succeeds!`,
      metadata: {
        componentType: "payment_setup",
        next_action: "confirm_scheduled_registration",
        schedulingData: {
          scheduled_time,
          event_id,
          total_amount,
          program_fee,
          formData
        }
      }
    };
  }

  /**
   * Confirm and store scheduled registration after payment setup
   */
  private async confirmScheduledRegistration(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const schedulingData = context.schedulingData;
    
    if (!schedulingData) {
      return this.formatError("Scheduling data not found. Please start over.");
    }
    
    const { scheduled_time, event_id, total_amount, program_fee, formData } = schedulingData;
    const scheduledDate = new Date(scheduled_time);
    const programName = context.selectedProgram?.title || "Selected Program";
    
    try {
      // Calculate mandate valid_until (min of scheduled_time or now + 31 days)
      const maxValidUntil = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const mandateValidUntil = scheduledDate < maxValidUntil ? scheduledDate : maxValidUntil;
      
      // Step 1: Create mandate via MCP tool (audit-compliant)
      Logger.info("[confirmScheduledRegistration] Creating mandate...");
      const totalAmountCents = Math.round(parseFloat(total_amount.replace(/[^0-9.]/g, '')) * 100);
      
      const mandateResponse = await this.invokeMCPTool('mandates.create', {
        user_id: context.user_id,
        provider: 'bookeo',
        org_ref: context.selectedProgram.org_ref,
        scopes: ['bookeo:create_booking', 'platform:success_fee'],
        max_amount_cents: totalAmountCents,
        valid_until: mandateValidUntil.toISOString()
      });

      if (!mandateResponse.success || !mandateResponse.data?.mandate_id) {
        Logger.error("[confirmScheduledRegistration] Mandate creation failed", mandateResponse);
        return this.formatError("Failed to create authorization. Please try again.");
      }

      const mandateId = mandateResponse.data.mandate_id;
      Logger.info("[confirmScheduledRegistration] ✅ Mandate created:", mandateId);

      // Step 2: Store in scheduled_registrations table
      Logger.info("[confirmScheduledRegistration] Storing scheduled registration...");
      const supabase = this.getSupabaseClient();
      
      const { data: scheduledReg, error: insertError } = await supabase
        .from('scheduled_registrations')
        .insert({
          user_id: context.user_id,
          mandate_id: mandateId,
          org_ref: context.selectedProgram.org_ref,
          program_ref: context.selectedProgram.program_ref,
          program_name: programName,
          scheduled_time,
          event_id,
          delegate_data: formData.delegate,
          participant_data: formData.participants,
          status: 'pending'
        })
        .select()
        .single();

      if (insertError || !scheduledReg) {
        Logger.error("[confirmScheduledRegistration] Database insert failed", insertError);
        return this.formatError("Failed to schedule registration. Please try again.");
      }

      Logger.info("[confirmScheduledRegistration] ✅ Scheduled registration stored:", scheduledReg.id);

      // Step 3: Schedule the job via MCP tool (audit-compliant)
      Logger.info("[confirmScheduledRegistration] Scheduling job...");
      const scheduleResponse = await this.invokeMCPTool('scheduler.schedule_signup', {
        registration_id: scheduledReg.id,
        trigger_time: scheduled_time
      });

      if (!scheduleResponse.success) {
        Logger.error("[confirmScheduledRegistration] Job scheduling failed", scheduleResponse);
        return this.formatError("Failed to schedule auto-registration. Please try again.");
      }

      Logger.info("[confirmScheduledRegistration] ✅ Job scheduled successfully");
      
      // Reset context
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE
      });
      
      return {
        message: `✅ Auto-registration scheduled!\n\n` +
                 `We'll register you on ${scheduledDate.toLocaleString()} when booking opens.\n\n` +
                 `You'll be charged ${total_amount} **only if registration succeeds**.`,
        cards: [{
          title: '⏰ Scheduled',
          subtitle: programName,
          description: `Booking opens: ${scheduledDate.toLocaleString()}\nTotal: ${total_amount}`
        }],
        cta: {
          buttons: [
            { label: "Browse More Classes", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "outline" }
          ]
        }
      };
    } catch (error) {
      Logger.error("[confirmScheduledRegistration] Error:", error);
      return this.formatError("Failed to schedule auto-registration. Please try again.");
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
    const exists = this.sessions.has(sessionId);
    console.log('[getContext] 🔍', {
      sessionId,
      exists,
      action: exists ? 'retrieving existing' : 'creating new',
      currentStep: exists ? this.sessions.get(sessionId)?.step : 'none',
      hasSelectedProgram: exists ? !!this.sessions.get(sessionId)?.selectedProgram : false
    });
    
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
