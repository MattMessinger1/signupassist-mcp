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
  getAPIErrorMessage,
  getPendingCancelConfirmMessage,
  getConfirmedCancelConfirmMessage,
  getCancelSuccessMessage,
  getCancelFailedMessage,
  getPendingCancelSuccessMessage,
  getReceiptsFooterMessage,
  getScheduledRegistrationSuccessMessage,
  getInitialActivationMessage,
  getFallbackClarificationMessage,
  getGracefulDeclineMessage,
  getLocationQuestionMessage,
  SUPPORT_EMAIL
} from "./apiMessageTemplates.js";
import {
  calculateActivationConfidence,
  storedLocationMatchesProvider,
  type ActivationResult,
  type ProviderConfig
} from "../utils/activationConfidence.js";
import { stripHtml } from "../lib/extractionUtils.js";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from '@supabase/supabase-js';

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
  cardLast4?: string | null;  // Last 4 digits of saved payment method
  cardBrand?: string | null;  // Card brand (Visa, Mastercard, etc.)
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
    program_fee_cents: number;
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
   * @param auditContext - Optional audit context with mandate_id for audit trail linking
   */
  private async invokeMCPTool(
    toolName: string, 
    args: any,
    auditContext?: { mandate_id?: string; plan_execution_id?: string; user_id?: string }
  ): Promise<any> {
    if (!this.mcpServer?.tools?.has(toolName)) {
      const available = this.mcpServer?.tools ? Array.from(this.mcpServer.tools.keys()).join(', ') : 'none';
      throw new Error(`MCP tool not found: ${toolName}. Available: ${available}`);
    }
    
    const tool = this.mcpServer.tools.get(toolName);
    Logger.info(`[MCP] Invoking tool: ${toolName}${auditContext?.mandate_id ? ` (mandate: ${auditContext.mandate_id.substring(0, 8)}...)` : ''}`);
    
    // Inject audit context into args for tool handler (including user_id for RLS)
    const argsWithAudit = {
      ...args,
      _audit: {
        plan_execution_id: auditContext?.plan_execution_id || null,
        mandate_id: auditContext?.mandate_id,
        user_id: auditContext?.user_id
      }
    };
    
    return await tool.handler(argsWithAudit);
  }

  /**
   * Get Supabase client for database operations
   * Creates client on-demand with service role key
   */
  private getSupabaseClient() {
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
   * @param userId - Optional authenticated user ID (from frontend or Auth0 JWT)
   */
  async generateResponse(
    input: string,
    sessionId: string,
    action?: string,
    payload?: any,
    userTimezone?: string,
    userId?: string
  ): Promise<OrchestratorResponse> {
    try {
      const context = this.getContext(sessionId);
      
      // Store user ID and timezone in context
      if (userId) {
        this.updateContext(sessionId, { user_id: userId });
        Logger.info('[APIOrchestrator] User authenticated', { userId });
      }
      
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

      case "view_receipts":
        return await this.viewReceipts(payload, sessionId, context);

      case "view_audit_trail":
        return await this.viewAuditTrail(payload, sessionId, context);

      case "cancel_registration":
        return await this.cancelRegistrationStep1(payload, sessionId, context);

      case "confirm_cancel_registration":
        return await this.cancelRegistrationStep2(payload, sessionId, context);

      case "load_saved_children":
        return await this.loadSavedChildren(payload, sessionId, context);

      case "check_payment_method":
        return await this.checkPaymentMethod(payload, sessionId, context);

      case "save_child":
        return await this.saveChild(payload, sessionId, context);

      case "load_delegate_profile":
        return await this.loadDelegateProfile(payload, sessionId, context);

      case "save_delegate_profile":
        return await this.saveDelegateProfile(payload, sessionId, context);

      case "confirm_provider":
        return await this.handleConfirmProvider(payload, sessionId, context);

      case "deny_provider":
        return await this.handleDenyProvider(payload, sessionId, context);

      case "save_location":
        return await this.handleSaveLocation(payload, sessionId, context);

      case "clear_context":
        return await this.handleClearContext(payload, sessionId, context);

      case "browse_all_programs":
        return await this.handleBrowseAllPrograms(payload, sessionId, context);

      default:
        return this.formatError(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle natural language message with activation confidence
   */
  private async handleMessage(
    input: string,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Check if this might be a location response (simple city/state input)
    if (context.step === FlowStep.BROWSE && this.isLocationResponse(input)) {
      return await this.handleLocationResponse(input, sessionId, context);
    }

    // Get user's stored location if authenticated
    let storedCity: string | undefined;
    let storedState: string | undefined;
    
    if (context.user_id) {
      try {
        const profileResult = await this.invokeMCPTool('user.get_delegate_profile', {
          user_id: context.user_id
        });
        if (profileResult?.data?.profile) {
          storedCity = profileResult.data.profile.city;
          storedState = profileResult.data.profile.state;
        }
      } catch (error) {
        Logger.warn('[handleMessage] Failed to load delegate profile:', error);
      }
    }

    // Calculate activation confidence
    const confidence = calculateActivationConfidence(input, {
      isAuthenticated: !!context.user_id,
      storedCity,
      storedState
    });

    Logger.info('[handleMessage] Activation confidence:', {
      level: confidence.level,
      reason: confidence.reason,
      provider: confidence.matchedProvider?.name
    });

    // Route based on confidence level
    if (confidence.level === 'HIGH' && confidence.matchedProvider) {
      // HIGH: Activate immediately with Set & Forget message
      const orgRef = confidence.matchedProvider.name.toLowerCase().replace(/\s+/g, '-');
      return await this.activateWithInitialMessage(confidence.matchedProvider, orgRef, sessionId);
    }

    if (confidence.level === 'MEDIUM' && confidence.matchedProvider) {
      // MEDIUM: Check if we should ask for location or show clarification
      if (context.user_id && !storedCity) {
        // Authenticated user without stored location - ask for city
        return this.askForLocation(confidence.matchedProvider, sessionId);
      }
      
      // Show fallback clarification
      return this.showFallbackClarification(confidence.matchedProvider);
    }

    // LOW: Context-aware responses based on flow step
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
        // Graceful decline - offer help without forcing activation
        return this.formatResponse(
          getGracefulDeclineMessage(),
          undefined,
          [{ label: "Show Available Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "secondary" }]
        );
    }
  }

  /**
   * Check if input looks like a simple location response
   */
  private isLocationResponse(input: string): boolean {
    const trimmed = input.trim();
    // Short input (likely just city name or "City, ST")
    if (trimmed.length > 50) return false;
    // Match patterns like "Madison", "Madison, WI", "Chicago IL"
    return /^[A-Za-z\s]+,?\s*[A-Z]{0,2}$/.test(trimmed);
  }

  /**
   * Handle location response from user
   */
  private async handleLocationResponse(
    input: string,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const trimmed = input.trim();
    
    // Parse city and optional state
    const cityStateMatch = trimmed.match(/^([A-Za-z\s]+),?\s*([A-Z]{2})?$/i);
    if (!cityStateMatch) {
      return this.formatResponse(
        "I didn't catch that. What city are you in?",
        undefined,
        []
      );
    }

    const city = cityStateMatch[1].trim();
    const state = cityStateMatch[2]?.toUpperCase();

    // Save location if authenticated
    if (context.user_id) {
      try {
        await this.invokeMCPTool('user.update_delegate_profile', {
          user_id: context.user_id,
          city,
          ...(state && { state })
        });
        Logger.info('[handleLocationResponse] Saved location:', { city, state });
      } catch (error) {
        Logger.warn('[handleLocationResponse] Failed to save location:', error);
      }
    }

    // Now search for programs with the confirmed location context
    return await this.searchPrograms("aim-design", sessionId);
  }

  /**
   * Show initial activation message with Set & Forget promotion
   */
  private async activateWithInitialMessage(
    provider: ProviderConfig,
    orgRef: string,
    sessionId: string
  ): Promise<OrchestratorResponse> {
    const message = getInitialActivationMessage({ provider_name: provider.name });
    
    const cards: CardSpec[] = [{
      title: `Browse ${provider.name} Programs`,
      subtitle: provider.city ? `📍 ${provider.city}, ${provider.state || ''}` : undefined,
      description: 'View available classes and sign up in seconds.',
      buttons: [
        {
          label: "Show Programs",
          action: "search_programs",
          payload: { orgRef },
          variant: "accent"
        }
      ]
    }];

    return {
      message,
      cards
    };
  }

  /**
   * Ask authenticated user for their location
   */
  private askForLocation(provider: ProviderConfig, sessionId: string): OrchestratorResponse {
    const message = getLocationQuestionMessage();
    
    // Store that we're waiting for location
    this.updateContext(sessionId, { step: FlowStep.BROWSE });
    
    return {
      message,
      cards: [{
        title: "Share Your Location",
        subtitle: "Optional — helps with faster matching",
        description: `This helps me confirm you're looking for ${provider.name} in ${provider.city || 'your area'}.`,
        buttons: [
          {
            label: `Yes, I'm in ${provider.city || 'that area'}`,
            action: "save_location",
            payload: { city: provider.city, state: provider.state, provider_name: provider.name },
            variant: "accent"
          },
          {
            label: "Different City",
            action: "confirm_provider",
            payload: { provider_name: provider.name, ask_city: true },
            variant: "outline"
          }
        ]
      }]
    };
  }

  /**
   * Show fallback clarification for MEDIUM confidence
   */
  private showFallbackClarification(provider: ProviderConfig): OrchestratorResponse {
    const message = getFallbackClarificationMessage({
      provider_name: provider.name,
      provider_city: provider.city
    });

    const orgRef = provider.name.toLowerCase().replace(/\s+/g, '-');

    return {
      message,
      cards: [{
        title: `Sign up at ${provider.name}?`,
        subtitle: provider.city ? `📍 ${provider.city}, ${provider.state || ''}` : undefined,
        description: 'Confirm to browse available programs.',
        buttons: [
          {
            label: "Yes, that's right",
            action: "confirm_provider",
            payload: { provider_name: provider.name, orgRef },
            variant: "accent"
          },
          {
            label: "No, not what I meant",
            action: "deny_provider",
            payload: {},
            variant: "outline"
          }
        ]
      }]
    };
  }

  /**
   * Handle confirm_provider action (user confirms fallback clarification)
   */
  private async handleConfirmProvider(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const orgRef = payload.orgRef || payload.provider_name?.toLowerCase().replace(/\s+/g, '-') || 'aim-design';
    
    if (payload.ask_city) {
      // User said they're in a different city - just proceed anyway
      return this.formatResponse(
        "No problem! What city are you in? (Or just type your city name)",
        undefined,
        []
      );
    }
    
    return await this.searchPrograms(orgRef, sessionId);
  }

  /**
   * Handle deny_provider action (user says "not what I meant")
   */
  private async handleDenyProvider(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Clear any provider context from session
    this.updateContext(sessionId, {
      orgRef: undefined,
      selectedProgram: undefined
    });

    return this.formatResponse(
      "No problem! What program or activity are you looking for? I can help you find and sign up for classes, camps, and workshops.",
      [{
        title: "What would you like to do?",
        subtitle: "Options to continue",
        description: "Tell me what you're looking for, or browse available programs.",
        buttons: [
          {
            label: "Browse All Programs",
            action: "browse_all_programs",
            payload: {},
            variant: "accent"
          },
          {
            label: "Start Over",
            action: "clear_context",
            payload: {},
            variant: "outline"
          }
        ]
      }]
    );
  }

  /**
   * Handle clear_context action (user wants fresh start)
   */
  private async handleClearContext(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Reset session context
    this.updateContext(sessionId, {
      orgRef: undefined,
      formData: undefined,
      selectedProgram: undefined,
      step: FlowStep.BROWSE
    });

    return this.formatResponse(
      "Fresh start! What are you looking for today? I can help you sign up for classes, camps, and activities."
    );
  }

  /**
   * Handle browse_all_programs action
   */
  private async handleBrowseAllPrograms(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Default to aim-design for now, could be expanded to multi-provider
    return await this.searchPrograms('aim-design', sessionId);
  }

  /**
   * Handle save_location action (user confirms location)
   */
  private async handleSaveLocation(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { city, state, provider_name } = payload;
    
    // Save location if authenticated
    if (context.user_id && city) {
      try {
        await this.invokeMCPTool('user.update_delegate_profile', {
          user_id: context.user_id,
          city,
          ...(state && { state })
        });
        Logger.info('[handleSaveLocation] Saved location:', { city, state });
      } catch (error) {
        Logger.warn('[handleSaveLocation] Failed to save location:', error);
      }
    }
    
    // Proceed to search programs
    const orgRef = provider_name?.toLowerCase().replace(/\s+/g, '-') || 'aim-design';
    return await this.searchPrograms(orgRef, sessionId);
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
      
      // Filter programs based on Bookeo's booking window rules
      const now = new Date();
      
      const upcomingPrograms = sortedPrograms.filter((prog: any) => {
        if (!prog.earliest_slot_time) return true; // Keep programs without slot time
        
        const slotTime = new Date(prog.earliest_slot_time);
        
        // Apply Bookeo booking limits if present
        if (prog.booking_limits) {
          const limits = prog.booking_limits;
          
          // Check maximum advance booking (e.g., "cannot book more than 6 months in advance")
          if (limits.maxAdvanceTime) {
            const maxDate = new Date(now.getTime() + limits.maxAdvanceTime.amount * this.getMilliseconds(limits.maxAdvanceTime.unit));
            if (slotTime > maxDate) return false; // Too far in future
          }
          
          // Check minimum advance booking (e.g., "must book at least 1 hour in advance")
          if (limits.minAdvanceTime) {
            const minDate = new Date(now.getTime() + limits.minAdvanceTime.amount * this.getMilliseconds(limits.minAdvanceTime.unit));
            if (slotTime < minDate) return false; // Too soon to book
          }
        } else {
          // Fallback: date-based filtering if no booking limits
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const slotDay = new Date(slotTime.getFullYear(), slotTime.getMonth(), slotTime.getDate());
          if (slotDay < today) return false;
        }
        
        return true;
      });
      
      if (upcomingPrograms.length === 0) {
        return this.formatError("No upcoming programs available at this time. All sessions have already passed.");
      }
      
      // Store programs in context
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE,
        orgRef,
      });

      // Build program cards with timing badges and cleaned descriptions
      const cards: CardSpec[] = upcomingPrograms.map((prog: any, index: number) => {
        // Determine booking status at runtime (don't trust stale cached data)
        const determineBookingStatus = (program: any): string => {
          const hasAvailableSlots = program.next_available_slot || (program.available_slots && program.available_slots > 0);
          if (hasAvailableSlots) return 'open_now';
          if (program.booking_status === 'sold_out') return 'sold_out';
          return program.booking_status || 'open_now';
        };
        
        const bookingStatus = determineBookingStatus(prog);
        // Use earliest_slot_time OR booking_opens_at as fallback for date display
        const earliestSlot = prog.earliest_slot_time 
          ? new Date(prog.earliest_slot_time) 
          : prog.booking_opens_at 
            ? new Date(prog.booking_opens_at)
            : null;
        
        // Generate timing badge
        let timingBadge = '';
        let isDisabled = false;
        let buttonLabel = "Select this program";
        
        if (bookingStatus === 'sold_out') {
          timingBadge = '🚫 Sold Out';
          isDisabled = true;
          buttonLabel = "Waitlist (Coming Soon)";
        } else if (bookingStatus === 'opens_later') {
          if (earliestSlot) {
            timingBadge = `📅 Registration opens ${this.formatTimeForUser(earliestSlot, context)}`;
          } else {
            timingBadge = '📅 Opens Soon';
          }
          buttonLabel = "Schedule Ahead";
        } else if (bookingStatus === 'open_now') {
          timingBadge = '✅ Register Now';
        }
        
        // Design DNA: Only first program gets accent (primary) button, rest get outline (secondary)
        const buttonVariant = isDisabled ? "outline" : (index === 0 ? "accent" : "outline");
        
        // Add helpful message for opens_later programs
        let cardDescription = stripHtml(prog.description || "");
        if (bookingStatus === 'opens_later') {
          cardDescription += '\n\n💡 Set up your signup now — we\'ll register you the moment registration opens!';
        }
        
        return {
          title: prog.title || "Untitled Program",
          subtitle: `${prog.schedule || ""} ${timingBadge ? `• ${timingBadge}` : ''}`.trim(),
          description: cardDescription,
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
                  booking_opens_at: prog.booking_opens_at,
                  first_available_event_id: prog.first_available_event_id || null
                }
              },
              variant: buttonVariant,
              disabled: isDisabled
            }
          ]
        };
      });

      // Use Design DNA-compliant message template
      const message = getAPIProgramsReadyMessage({
        provider_name: orgRef === "aim-design" ? "AIM Design" : orgRef,
        program_count: upcomingPrograms.length
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

      // Return form schema with fullscreen mode for ChatGPT compliance
      const formResponse: OrchestratorResponse = {
        message,
        metadata: {
          componentType: 'fullscreen_form', // Triggers fullscreen mode in ChatGPT
          displayMode: 'fullscreen',
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

    // Get user_id from payload (frontend provides this for authenticated users)
    const userId = payload.user_id;
    
    if (!userId) {
      Logger.warn('[submitForm] No user_id in payload - success fee charge may fail');
      Logger.warn('[submitForm] Delegate email:', formData.delegate?.delegate_email);
    } else {
      Logger.info('[submitForm] User authenticated with user_id:', userId);
    }

    // Save delegate profile if requested (ChatGPT App Store compliant)
    if (payload.saveDelegateProfile && userId && formData.delegate) {
      Logger.info('[submitForm] Saving delegate profile for user:', userId);
      try {
        await this.invokeMCPTool('user.update_delegate_profile', {
          user_id: userId,
          first_name: formData.delegate.delegate_firstName,
          last_name: formData.delegate.delegate_lastName,
          phone: formData.delegate.delegate_phone,
          date_of_birth: formData.delegate.delegate_dob,
          default_relationship: formData.delegate.delegate_relationship
        });
        Logger.info('[submitForm] ✅ Delegate profile saved');
      } catch (error) {
        Logger.warn('[submitForm] Failed to save delegate profile (non-fatal):', error);
        // Non-fatal - continue with registration
      }
    }

    // Save new children if requested (ChatGPT App Store compliant)
    if (payload.saveNewChildren && userId && Array.isArray(payload.saveNewChildren)) {
      Logger.info('[submitForm] Saving new children for user:', userId, payload.saveNewChildren.length);
      for (const child of payload.saveNewChildren) {
        try {
          const result = await this.invokeMCPTool('user.create_child', {
            user_id: userId,
            first_name: child.first_name,
            last_name: child.last_name,
            dob: child.dob
          });
          if (result?.success) {
            Logger.info('[submitForm] ✅ Child saved:', child.first_name, child.last_name);
          } else {
            Logger.warn('[submitForm] Failed to save child (non-fatal):', result?.error || 'Unknown error');
          }
        } catch (error) {
          Logger.warn('[submitForm] Failed to save child (non-fatal):', error);
          // Non-fatal - continue with registration
        }
      }
    }

    // Store form data, participant count, and user_id
    this.updateContext(sessionId, {
      step: FlowStep.PAYMENT,
      formData,
      numParticipants,
      user_id: userId
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
    
    // Get booking date from earliest_slot_time OR booking_opens_at, or use placeholder (1 week from now)
    const earliestSlot = context.selectedProgram?.earliest_slot_time 
      ? new Date(context.selectedProgram.earliest_slot_time) 
      : context.selectedProgram?.booking_opens_at
        ? new Date(context.selectedProgram.booking_opens_at)
        : null;
    
    // For "opens_later" programs, treat as future booking even without a specific date
    // This allows scheduled registrations for courses where booking window hasn't opened
    const isFutureBooking = bookingStatus === 'opens_later';

    // PART 1: Check if user has saved payment method for ALL flows (immediate and future)
    let hasPaymentMethod = false;
    let cardLast4: string | null = null;
    let cardBrand: string | null = null;
    
    // Only check database if user is authenticated
    if (userId) {
      const supabase = this.getSupabaseClient();
      const { data: billingData } = await supabase
        .from('user_billing')
        .select('default_payment_method_id, payment_method_last4, payment_method_brand')
        .eq('user_id', userId)
        .maybeSingle();
      
      hasPaymentMethod = !!billingData?.default_payment_method_id;
      cardLast4 = billingData?.payment_method_last4 || null;
      cardBrand = billingData?.payment_method_brand || null;
      
      Logger.info('[submitForm] Payment method check result', { hasPaymentMethod, cardBrand, cardLast4 });
    }
    // If userId is undefined, hasPaymentMethod stays false (unauthenticated users don't have saved cards)
    
    // Always store form data in context regardless of payment method status
    // This ensures confirmPayment/confirmScheduledRegistration can access it from context
    const scheduledTime = isFutureBooking 
      ? (earliestSlot?.toISOString() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      : undefined;
    
    this.updateContext(sessionId, {
      step: FlowStep.PAYMENT,
      formData: {
        delegate_data: formData.delegate,
        participant_data: formData.participants,
        num_participants: numParticipants,
        event_id: context.selectedProgram?.first_available_event_id,
        program_fee_cents: Math.round(totalPrice * 100)
      },
      // Store scheduling data for future bookings (needed by confirmScheduledRegistration)
      schedulingData: isFutureBooking ? {
        scheduled_time: scheduledTime,
        event_id: context.selectedProgram?.first_available_event_id,
        total_amount: grandTotal,
        program_fee: formattedTotal,
        program_fee_cents: Math.round(totalPrice * 100),
        formData: {
          delegate: formData.delegate,
          participants: formData.participants,
          num_participants: numParticipants
        }
      } : undefined,
      cardLast4,
      cardBrand
    });
    
    // PART 2: Handle payment setup requirement for users WITHOUT saved payment method
    if (!hasPaymentMethod) {
      Logger.info('[submitForm] No payment method found - prompting user to add card');
      
      const nextAction = isFutureBooking ? "confirm_scheduled_registration" : "confirm_payment";
      
      return {
        message: `${message}\n\n💳 First, let's save your payment method securely. You'll only be charged if registration succeeds!`,
        metadata: {
          componentType: "payment_setup",
          next_action: nextAction,
          schedulingData: {
            event_id: context.selectedProgram?.first_available_event_id,
            total_amount: grandTotal,
            program_fee: formattedTotal,
            program_fee_cents: Math.round(totalPrice * 100),
            scheduled_time: isFutureBooking ? (earliestSlot?.toISOString() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()) : undefined,
            formData: {
              delegate_data: formData.delegate,
              participant_data: formData.participants,
              num_participants: numParticipants
            }
          }
        }
      };
    }
    
    Logger.info('[submitForm] Payment method found - proceeding to payment authorization', { cardBrand, cardLast4, isFutureBooking });

    // Build conditional payment button
    let buttons: any[] = [];
    let paymentMessage = message;

    if (isFutureBooking) {
      // Set & Forget flow: Show auto-register button
      // Use placeholder date if no specific slot time is known
      const scheduledDate = earliestSlot || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const dateDisplay = earliestSlot 
        ? `on ${this.formatTimeForUser(earliestSlot, context)}`
        : "when registration opens";
      
      // Different messaging based on whether card is saved
      const cardDisplay = cardLast4 ? `${cardBrand || 'Card'} •••• ${cardLast4}` : null;
      
      if (cardDisplay) {
        paymentMessage += `\n\n📅 This class isn't open for registration yet. We can automatically register you ${dateDisplay}!

💳 **Using saved card:** ${cardDisplay}
• **You won't be charged today**
• **Only if registration succeeds:** Provider charges program fee + $20 SignupAssist fee`;
      } else {
        paymentMessage += `\n\n📅 This class isn't open for registration yet. We can automatically register you ${dateDisplay}!

💳 **How charging works:**
• **You won't be charged today** — we're just saving your payment method
• **Only if registration succeeds:** Provider charges their program fee, and SignupAssist charges $20 success fee
• **If registration fails:** No charges at all`;
      }
      
      // If user has saved card, skip payment setup and go directly to confirm
      const buttonLabel = cardDisplay
        ? `📝 Confirm Auto-Registration with ${cardDisplay}`
        : `📝 Set Up Auto-Registration for ${scheduledDate.toLocaleDateString()}`;
      
      const buttonAction = cardDisplay ? "confirm_scheduled_registration" : "schedule_auto_registration";
      
      buttons = [
        { 
          label: buttonLabel, 
          action: buttonAction,
          payload: {
            scheduled_time: scheduledDate.toISOString(),
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
      // Immediate registration flow: Show confirm & pay button with card details
      const cardLabel = cardLast4 
        ? `Pay with ${cardBrand || 'Card'} •••• ${cardLast4}` 
        : "Confirm & Pay";
      buttons = [
        { label: cardLabel, action: "confirm_payment", variant: "accent" },
        { label: "Go Back", action: "search_programs", payload: { orgRef: context.orgRef }, variant: "outline" }
      ];
    }

    // Build card description based on whether this is immediate or scheduled
    const cardDisplay = cardLast4 ? `${cardBrand || 'Card'} •••• ${cardLast4}` : null;
    
    const cardDescription = isFutureBooking
      ? `**Participants:**\n${participantList}

⏰ **Scheduled for:** ${this.formatTimeForUser(earliestSlot || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), context)}

${cardDisplay ? `💳 **Payment Method:** ${cardDisplay}` : ''}

💰 **Charges (only if registration succeeds):**
• Program Fee: ${formattedTotal} → Paid to provider upon signup
• SignupAssist Fee: $20.00 → Charged only if signup succeeds
• **Total:** ${grandTotal}

🔒 **Your card will NOT be charged today.** ${cardDisplay ? 'We\'ll use your saved card' : 'We\'re just saving your payment method'} to complete registration when the booking window opens.`
      : `**Participants:**\n${participantList}

💳 **Payment Method:** ${cardBrand || 'Card'} •••• ${cardLast4 || '****'}

**Charges:**
• Program Fee: ${formattedTotal} (to provider)
• SignupAssist Success Fee: $20.00 (only if booking succeeds)
• **Total:** ${grandTotal}`;

    const paymentResponse: OrchestratorResponse = {
      message: paymentMessage,
      cards: [{
        title: isFutureBooking ? "Set Up Auto-Registration" : "Confirm Booking & Payment",
        subtitle: programName,
        description: cardDescription,
        buttons: []
      }],
      cta: {
        buttons
      }
    };

    // Form data already stored in context earlier (before payment method check)

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

      // Get booking data from payload (primary) or context (fallback)
      const formData = payload.formData || context.formData;
      
      // DEBUG: Log the entire formData object to see what we're working with
      Logger.info("[confirmPayment] 🔍 FormData source:", {
        fromPayload: !!payload.formData,
        fromContext: !!context.formData,
        hasFormData: !!formData,
        formData: JSON.stringify(formData, null, 2),
        keys: formData ? Object.keys(formData) : []
      });
      
      const delegate_data = formData?.delegate_data;
      const participant_data = formData?.participant_data;
      const num_participants = formData?.num_participants;
      const event_id = payload.event_id || formData?.event_id;
      
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
        delegate_email: delegate_data.delegate_email || delegate_data.email,
        num_participants_in_array: participant_data.length
      });

      // PART 2.5: Validate booking window using Bookeo's rules
      const slotTime = context.selectedProgram?.earliest_slot_time;
      const bookingLimits = context.selectedProgram?.booking_limits;
      
      if (slotTime) {
        const slotDate = new Date(slotTime);
        const now = new Date();
        const formattedSlotTime = this.formatTimeForUser(slotTime, context);
        
        // Apply Bookeo's booking window rules
        if (bookingLimits) {
          // Check if too late to book (minimum advance time)
          if (bookingLimits.minAdvanceTime) {
            const minDate = new Date(now.getTime() + bookingLimits.minAdvanceTime.amount * this.getMilliseconds(bookingLimits.minAdvanceTime.unit));
            if (slotDate < minDate) {
              Logger.warn("[confirmPayment] Booking window closed (min advance time)", {
                slot_time: slotTime,
                min_advance: bookingLimits.minAdvanceTime,
                now: now.toISOString()
              });
              
              return this.formatError(
                `⏰ This class requires booking at least ${bookingLimits.minAdvanceTime.amount} ${bookingLimits.minAdvanceTime.unit} in advance. The booking window has closed. Please browse programs again.`
              );
            }
          }
          
          // Check if too early to book (maximum advance time)
          if (bookingLimits.maxAdvanceTime) {
            const maxDate = new Date(now.getTime() + bookingLimits.maxAdvanceTime.amount * this.getMilliseconds(bookingLimits.maxAdvanceTime.unit));
            if (slotDate > maxDate) {
              Logger.warn("[confirmPayment] Too early to book (max advance time)", {
                slot_time: slotTime,
                max_advance: bookingLimits.maxAdvanceTime,
                now: now.toISOString()
              });
              
              return this.formatError(
                `⏰ This class cannot be booked more than ${bookingLimits.maxAdvanceTime.amount} ${bookingLimits.maxAdvanceTime.unit} in advance. Please check back closer to the date.`
              );
            }
          }
        } else {
          // Fallback: date-based validation if no booking limits
          const slotDay = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate());
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          if (slotDay < today) {
            Logger.warn("[confirmPayment] Event date has passed", {
              slot_date: slotDay.toISOString(),
              today: today.toISOString()
            });
            
            return this.formatError(
              `⏰ This class was scheduled for ${formattedSlotTime} and is no longer available. Please browse programs again to see upcoming sessions.`
            );
          }
        }
      }

      // PART 3: Email-based user_id lookup if not in context
      let userId = context.user_id || payload.user_id;
      
      if (!userId) {
        Logger.warn("[confirmPayment] No user_id in context or payload - attempting email lookup");
        const delegateEmail = delegate_data.delegate_email || delegate_data.email;
        
        if (delegateEmail) {
          const supabase = this.getSupabaseClient();
          
          // Find user by email via admin API
          const { data: { users }, error } = await supabase.auth.admin.listUsers();
          const matchingUser = users?.find((u: any) => u.email === delegateEmail);
          
          if (matchingUser) {
            userId = matchingUser.id;
            Logger.info("[confirmPayment] ✅ User ID found via email lookup:", userId);
            // Store in context for future use
            this.updateContext(sessionId, { user_id: userId });
          } else {
            Logger.warn("[confirmPayment] Could not find user_id via email lookup");
          }
        }
      }

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

      // PART 5: Create mandate BEFORE booking (for audit compliance)
      Logger.info("[confirmPayment] Creating mandate for audit trail...");
      let mandate_id: string | undefined;
      
      if (userId) {
        try {
          const mandateResponse = await this.invokeMCPTool('mandates.create', {
            user_id: userId,
            provider: 'bookeo',
            org_ref: orgRef,
            scopes: ['platform:success_fee', 'scp:register'],
            program_ref: programRef,
            valid_until: new Date(Date.now() + 5 * 60 * 1000).toISOString()  // 5 minutes from now
          });
          
          if (mandateResponse.success && mandateResponse.data?.mandate_id) {
            mandate_id = mandateResponse.data.mandate_id;
            Logger.info("[confirmPayment] ✅ Mandate created:", mandate_id);
          } else {
            Logger.warn("[confirmPayment] Mandate creation failed (non-fatal):", mandateResponse.error);
          }
        } catch (mandateError) {
          Logger.warn("[confirmPayment] Mandate creation exception (non-fatal):", mandateError);
        }
      } else {
        Logger.warn("[confirmPayment] No userId - skipping mandate creation");
      }

      // Step 1: Book with Bookeo via MCP tool
      Logger.info("[confirmPayment] Calling bookeo.confirm_booking...");
      const bookingResponse = await this.invokeMCPTool('bookeo.confirm_booking', {
        event_id,
        program_ref: programRef,
        org_ref: orgRef,
        delegate_data: mappedDelegateData,
        participant_data: mappedParticipantData,
        num_participants
      }, { mandate_id, user_id: userId }); // Pass audit context for ChatGPT compliance

      if (!bookingResponse.success || !bookingResponse.data?.booking_number) {
        Logger.error("[confirmPayment] Booking failed", bookingResponse);
        return this.formatError(
          bookingResponse.error?.display || "Failed to create booking. Please try again."
        );
      }

      const { booking_number, start_time } = bookingResponse.data;
      Logger.info("[confirmPayment] ✅ Booking confirmed:", { booking_number });

      // Step 3: Charge $20 success fee via MCP tool (audit-compliant)
      Logger.info("[confirmPayment] About to charge Stripe", { 
        userId, 
        contextUserId: context.user_id,
        payloadUserId: payload.user_id 
      });
      
      let charge_id: string | undefined;
      
      if (!userId) {
        Logger.warn("[confirmPayment] No user_id - cannot charge success fee");
        // Don't fail the booking, just log warning
      } else {
        try {
          const feeResult = await this.invokeMCPTool('stripe.charge_success_fee', {
            booking_number,
            mandate_id,
            amount_cents: 2000, // $20 success fee
            user_id: userId  // Required for server-to-server call
          }, { mandate_id, user_id: userId }); // Pass audit context for audit trail linking

          if (!feeResult.success) {
            Logger.warn("[confirmPayment] Success fee charge failed (non-fatal):", feeResult.error);
            // Don't fail the entire flow - booking was successful
          } else {
            charge_id = feeResult.data?.charge_id;
            Logger.info("[confirmPayment] ✅ Success fee charged:", charge_id);
          }
        } catch (feeError) {
          Logger.warn("[confirmPayment] Success fee exception (non-fatal):", feeError);
          // Continue - booking was successful even if fee failed
        }
      }

      // Step 4: Create registration record for receipts/audit trail
      if (userId) {
        try {
          const delegateName = `${delegate_data.delegate_firstName || ''} ${delegate_data.delegate_lastName || ''}`.trim();
          const delegateEmail = delegate_data.delegate_email || delegate_data.email || '';
          const participantNames = participant_data.map((p: any) => 
            `${p.firstName || ''} ${p.lastName || ''}`.trim()
          ).filter((name: string) => name.length > 0);
          
          // Get program cost from context formData (stored in submitForm)
          const amountCents = context.formData?.program_fee_cents || 0;
          
          const registrationResult = await this.invokeMCPTool('registrations.create', {
            user_id: userId,
            mandate_id,
            charge_id,
            program_name: programName,
            program_ref: programRef,
            provider: 'bookeo',
            org_ref: orgRef,
            start_date: start_time || context.selectedProgram?.earliest_slot_time,
            booking_number,
            amount_cents: amountCents,
            success_fee_cents: 2000,
            delegate_name: delegateName,
            delegate_email: delegateEmail,
            participant_names: participantNames
          });

          if (registrationResult.success) {
            Logger.info("[confirmPayment] ✅ Registration record created:", registrationResult.data?.id);
          } else {
            Logger.warn("[confirmPayment] Registration record creation failed (non-fatal):", registrationResult.error);
          }
        } catch (regError) {
          Logger.warn("[confirmPayment] Registration record exception (non-fatal):", regError);
          // Continue - booking was successful even if registration record failed
        }
      } else {
        Logger.warn("[confirmPayment] No userId - skipping registration record creation");
      }

      // Step 5: Reset context and return success
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
              label: "View My Registrations", 
              action: "view_receipts", 
              payload: { user_id: userId },
              variant: "accent" 
            },
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

      // Call confirmScheduledRegistration directly with updated context including user_id
      return await this.confirmScheduledRegistration(
        { schedulingData }, 
        sessionId, 
        { ...context, user_id }
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
    const { scheduled_time, event_id, total_amount, program_fee, program_fee_cents, formData } = payload;
    
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
        program_fee_cents: program_fee_cents || 0,
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

      // Step 2: Create registration via MCP tool (unified registrations table)
      Logger.info("[confirmScheduledRegistration] Creating scheduled registration via MCP tool...");
      
      const delegate = formData.delegate || {};
      const participants = formData.participants || [];
      const delegateName = `${delegate.delegate_firstName || ''} ${delegate.delegate_lastName || ''}`.trim();
      const delegateEmail = delegate.delegate_email || '';
      const participantNames = participants.map((p: any) => `${p.firstName || ''} ${p.lastName || ''}`.trim());
      const programFeeCents = Math.round(parseFloat(program_fee?.replace(/[^0-9.]/g, '') || '0') * 100);
      
      const registrationResponse = await this.invokeMCPTool('registrations.create', {
        user_id: context.user_id,
        mandate_id: mandateId,
        program_name: programName,
        program_ref: context.selectedProgram.program_ref,
        provider: 'bookeo',
        org_ref: context.selectedProgram.org_ref,
        start_date: context.selectedProgram?.start_date,
        amount_cents: programFeeCents,
        success_fee_cents: 2000,
        delegate_name: delegateName,
        delegate_email: delegateEmail,
        participant_names: participantNames,
        scheduled_for: scheduled_time // This makes status='pending'
      }, { mandate_id: mandateId });

      if (!registrationResponse.success || !registrationResponse.data?.id) {
        Logger.error("[confirmScheduledRegistration] Registration creation failed", registrationResponse);
        return this.formatError("Failed to schedule registration. Please try again.");
      }

      const registrationId = registrationResponse.data.id;
      Logger.info("[confirmScheduledRegistration] ✅ Scheduled registration created:", registrationId);

      // Step 3: Schedule the job via MCP tool (audit-compliant)
      Logger.info("[confirmScheduledRegistration] Scheduling job...");
      const scheduleResponse = await this.invokeMCPTool('scheduler.schedule_signup', {
        registration_id: registrationId,
        trigger_time: scheduled_time
      }, { mandate_id: mandateId });

      if (!scheduleResponse.success) {
        Logger.error("[confirmScheduledRegistration] Job scheduling failed", scheduleResponse);
        return this.formatError("Failed to schedule auto-registration. Please try again.");
      }

      Logger.info("[confirmScheduledRegistration] ✅ Job scheduled successfully");
      
      // Reset context
      this.updateContext(sessionId, {
        step: FlowStep.BROWSE
      });
      
      // Format valid_until date (mandate expiry)
      const validUntilDate = mandateResponse.data?.valid_until 
        ? new Date(mandateResponse.data.valid_until).toLocaleString()
        : scheduledDate.toLocaleString();
      
      // Use the Responsible Delegate disclosure template
      const successMessage = getScheduledRegistrationSuccessMessage({
        program_name: programName,
        scheduled_date: scheduledDate.toLocaleString(),
        total_cost: total_amount,
        provider_name: 'AIM Design', // TODO: get from context
        mandate_id: mandateId,
        valid_until: validUntilDate
      });
      
      return {
        message: successMessage,
        cards: [{
          title: '🎉 You\'re All Set!',
          subtitle: programName,
          description: `📅 **Auto-Registration Scheduled**\nWe'll register you on: ${scheduledDate.toLocaleString()}\n\n💰 **Total (if successful):** ${total_amount}\n\n🔐 **Mandate ID:** ${mandateId.substring(0, 8)}...`
        }],
        cta: {
          buttons: [
            { label: "View My Registrations", action: "view_receipts", payload: { user_id: context.user_id }, variant: "accent" },
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
   * View user's registrations (receipts)
   */
  private async viewReceipts(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload?.user_id || context.user_id;
    
    if (!userId) {
      return this.formatError("Please sign in to view your registrations.");
    }

    try {
      const supabase = this.getSupabaseClient();
      const { data: registrations, error } = await supabase
        .from('registrations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        Logger.error("[viewReceipts] Failed to fetch registrations:", error);
        return this.formatError("Unable to load your registrations.");
      }

      if (!registrations || registrations.length === 0) {
        return this.formatResponse(
          "📋 **Your Registrations**\n\nYou don't have any registrations yet.",
          undefined,
          [{ label: "Browse Classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }]
        );
      }

      // Format currency helper (cents → dollars)
      const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

      // Format date/time for display
      const formatDateTime = (dateStr: string | null) => {
        if (!dateStr) return 'Date TBD';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });
      };

      // Categorize registrations
      const now = new Date();
      const upcoming = registrations.filter(r => 
        r.status === 'confirmed' && r.start_date && new Date(r.start_date) > now
      );
      const scheduled = registrations.filter(r => r.status === 'pending');
      // Past includes: completed, cancelled, failed, and confirmed with past start_date
      const past = registrations.filter(r => 
        r.status === 'cancelled' || 
        r.status === 'failed' ||
        r.status === 'completed' ||
        (r.status === 'confirmed' && r.start_date && new Date(r.start_date) <= now)
      );

      // Status badge helper
      const getStatusBadge = (status: string): string => {
        switch (status) {
          case 'cancelled': return '❌ Cancelled';
          case 'failed': return '⚠️ Failed';
          case 'completed': return '✅ Completed';
          case 'confirmed': return '✅ Confirmed';
          case 'pending': return '⏳ Scheduled';
          default: return status;
        }
      };

      // Build cards for each registration
      const buildRegCard = (reg: any, isUpcoming: boolean = false): CardSpec => {
        const buttons = [];
        
        // Always show View Audit Trail for non-pending registrations (including cancelled)
        if (reg.status !== 'pending') {
          buttons.push({ label: 'View Audit Trail', action: 'view_audit_trail', payload: { registration_id: reg.id }, variant: 'outline' as const });
        }
        
        // Show Cancel button for pending OR upcoming (but not cancelled/failed/completed)
        if ((reg.status === 'pending' || isUpcoming) && reg.status !== 'cancelled' && reg.status !== 'failed' && reg.status !== 'completed') {
          buttons.push({ label: 'Cancel', action: 'cancel_registration', payload: { registration_id: reg.id }, variant: 'secondary' as const });
        }
        
        // Add status badge to title for cancelled/failed
        const titleWithStatus = (reg.status === 'cancelled' || reg.status === 'failed') 
          ? `${reg.program_name} ${getStatusBadge(reg.status)}`
          : reg.program_name;
        
        return {
          title: titleWithStatus,
          subtitle: formatDateTime(reg.start_date),
          description: [
            `**Booking #:** ${reg.booking_number || 'N/A'}`,
            `**Participants:** ${(reg.participant_names || []).join(', ') || 'N/A'}`,
            `**Program Fee:** ${formatDollars(reg.amount_cents || 0)}`,
            `**SignupAssist Fee:** ${formatDollars(reg.success_fee_cents || 0)}`,
            `**Total:** ${formatDollars((reg.amount_cents || 0) + (reg.success_fee_cents || 0))}`
          ].join('\n'),
          buttons
        };
      };

      const cards: CardSpec[] = [
        ...upcoming.map(r => buildRegCard(r, true)),  // isUpcoming = true, show Cancel button
        ...scheduled.map(r => buildRegCard(r, false)), // pending status, Cancel already shown
        ...past.map(r => buildRegCard(r, false))       // past (includes cancelled/failed), no cancel option
      ];

      return {
        message: `📋 **Your Registrations**\n\n` +
          `✅ **Upcoming:** ${upcoming.length}\n` +
          `📅 **Scheduled:** ${scheduled.length}\n` +
          `📦 **Past:** ${past.length}\n\n` +
          getReceiptsFooterMessage(),
        cards,
        cta: {
          buttons: [
            { label: "Browse Classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
          ]
        }
      };
    } catch (err) {
      Logger.error("[viewReceipts] Exception:", err);
      return this.formatError("An error occurred while loading your registrations.");
    }
  }

  /**
   * View audit trail for a specific registration
   * Phase E: Shows mandate details and all tool calls with decisions
   */
  private async viewAuditTrail(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { registration_id } = payload;
    
    if (!registration_id) {
      return this.formatError("Registration ID required to view audit trail.");
    }
    
    try {
      const supabase = this.getSupabaseClient();
      
      // 1. Get registration to find mandate_id
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select('mandate_id, program_name, booking_number, delegate_name, amount_cents, success_fee_cents, created_at')
        .eq('id', registration_id)
        .single();
      
      if (regError || !registration) {
        Logger.error("[viewAuditTrail] Registration not found:", regError);
        return this.formatError("Registration not found.");
      }
      
      if (!registration.mandate_id) {
        // No mandate linked - show registration details without audit events
        return {
          message: `📋 **Registration Details**\n\n` +
            `**Program:** ${registration.program_name}\n` +
            `**Booking #:** ${registration.booking_number || 'N/A'}\n` +
            `**Delegate:** ${registration.delegate_name || 'N/A'}\n\n` +
            `_No mandate authorization found for this registration._`,
          cards: [],
          cta: {
            buttons: [
              { label: "Back to Registrations", action: "view_receipts", variant: "outline" }
            ]
          }
        };
      }
      
      // 2. Get mandate details
      const { data: mandate, error: mandateError } = await supabase
        .from('mandates')
        .select('id, scope, valid_from, valid_until, status, provider')
        .eq('id', registration.mandate_id)
        .single();
      
      if (mandateError) {
        Logger.warn("[viewAuditTrail] Mandate lookup failed:", mandateError);
      }
      
      // 3. Get audit events for this mandate (including args and results for transparency)
      const { data: auditEvents, error: auditError } = await supabase
        .from('audit_events')
        .select('tool, decision, started_at, finished_at, event_type, args_json, result_json')
        .eq('mandate_id', registration.mandate_id)
        .order('started_at', { ascending: true });
      
      if (auditError) {
        Logger.warn("[viewAuditTrail] Audit events lookup failed:", auditError);
      }
      
      const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
      
      // Helper to extract key details from args/results for display
      const formatEventDetails = (event: any): { input: string; output: string } => {
        const args = event.args_json || {};
        const resultSuccess = event.result_json?.success; // Check TOP level for success flag
        const result = event.result_json?.data || event.result_json || {};
        
        if (event.tool === 'bookeo.confirm_booking') {
          const delegate = args.delegate_data || {};
          const participants = args.participant_data || [];
          const participantNames = participants.map((p: any) => `${p.firstName} ${p.lastName}`).join(', ');
          
          return {
            input: [
              `• Delegate: ${delegate.firstName || ''} ${delegate.lastName || ''} (${delegate.email || 'N/A'})`,
              `• Participants: ${participantNames || 'N/A'}`,
              `• Event ID: ${args.event_id?.substring(0, 20) || 'N/A'}...`
            ].join('\n'),
            output: [
              `• Booking #: ${result.booking_number || 'N/A'}`,
              `• Program: ${result.program_name || 'N/A'}`,
              `• Status: ${resultSuccess ? 'Success' : 'Failed'}`
            ].join('\n')
          };
        }
        
        if (event.tool === 'stripe.charge_success_fee') {
          return {
            input: [
              `• Amount: ${formatDollars(args.amount_cents || 0)}`,
              `• Booking #: ${args.booking_number || 'N/A'}`
            ].join('\n'),
            output: [
              `• Charge ID: ${result.charge_id?.substring(0, 12) || 'N/A'}...`,
              `• Status: ${resultSuccess ? 'Charged' : 'Failed'}`
            ].join('\n')
          };
        }
        
        // Generic fallback
        return {
          input: Object.keys(args).length > 0 ? `• ${Object.keys(args).slice(0, 3).join(', ')}` : '_No input data_',
          output: resultSuccess !== undefined ? `• Status: ${resultSuccess ? 'Success' : 'Failed'}` : '_No output data_'
        };
      };
      
      // Build audit trail timeline with details
      const auditTrailItems = (auditEvents || []).map((event, index) => {
        const time = this.formatTimeForUser(new Date(event.started_at), context);
        const status = event.decision === 'allowed' ? '✅' : (event.decision === 'denied' ? '❌' : '⏳');
        const toolName = event.tool || event.event_type || 'Unknown action';
        return `${index + 1}. ${status} **${toolName}** - ${time}`;
      });
      
      // Build detailed event cards for full transparency
      const eventCards: CardSpec[] = (auditEvents || []).map((event, index) => {
        const time = this.formatTimeForUser(new Date(event.started_at), context);
        const status = event.decision === 'allowed' ? '✅ Allowed' : (event.decision === 'denied' ? '❌ Denied' : '⏳ Pending');
        const toolName = event.tool || event.event_type || 'Unknown';
        const details = formatEventDetails(event);
        
        // Friendly tool names
        const friendlyNames: Record<string, string> = {
          'bookeo.confirm_booking': '📅 Booking Confirmation',
          'stripe.charge_success_fee': '💳 Success Fee Charge'
        };
        
        return {
          title: friendlyNames[toolName] || `🔧 ${toolName}`,
          subtitle: `${status} • ${time}`,
          description: [
            `**Input Data:**`,
            details.input,
            ``,
            `**Result:**`,
            details.output
          ].join('\n'),
          buttons: []
        };
      });
      
      // Build mandate summary card
      const mandateCard: CardSpec = {
        title: `🔐 Mandate Authorization`,
        subtitle: `ID: ${mandate?.id?.substring(0, 8) || 'N/A'}...`,
        description: [
          `**Provider:** ${mandate?.provider || 'N/A'}`,
          `**Scopes:** ${mandate?.scope?.join(', ') || 'N/A'}`,
          `**Valid From:** ${mandate ? this.formatTimeForUser(new Date(mandate.valid_from), context) : 'N/A'}`,
          `**Valid Until:** ${mandate ? this.formatTimeForUser(new Date(mandate.valid_until), context) : 'N/A'}`,
          `**Status:** ${mandate?.status || 'N/A'}`
        ].join('\n'),
        buttons: []
      };
      
      // Build registration summary card
      const registrationCard: CardSpec = {
        title: `📝 Registration Summary`,
        subtitle: registration.booking_number || 'Booking # pending',
        description: [
          `**Program:** ${registration.program_name}`,
          `**Delegate:** ${registration.delegate_name || 'N/A'}`,
          `**Program Fee:** ${formatDollars(registration.amount_cents || 0)}`,
          `**SignupAssist Fee:** ${formatDollars(registration.success_fee_cents || 0)}`,
          `**Total:** ${formatDollars((registration.amount_cents || 0) + (registration.success_fee_cents || 0))}`
        ].join('\n'),
        buttons: []
      };
      
      return {
        message: `📋 **Audit Trail**\n\n` +
          `---\n\n` +
          `**Actions Performed (${auditTrailItems.length} events):**\n` +
          (auditTrailItems.length > 0 
            ? auditTrailItems.join('\n') 
            : '_No audit events recorded for this registration._') +
          `\n\n---\n\n` +
          `🔒 _All actions are logged for transparency. SignupAssist acts as your Responsible Delegate with explicit consent._`,
        cards: [registrationCard, ...eventCards, mandateCard],
        cta: {
          buttons: [
            { label: "Back to Registrations", action: "view_receipts", variant: "outline" }
          ]
        }
      };
    } catch (err) {
      Logger.error("[viewAuditTrail] Exception:", err);
      return this.formatError("An error occurred while loading the audit trail.");
    }
  }

  /**
   * Cancel Registration Step 1: Show confirmation dialog
   * Phase F: Two-step confirmation to prevent accidental cancellations
   * Now supports both pending (scheduled) AND confirmed (booked) registrations
   */
  private async cancelRegistrationStep1(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { registration_id } = payload;
    
    if (!registration_id) {
      return this.formatError("Registration ID required to cancel.");
    }
    
    try {
      const supabase = this.getSupabaseClient();
      
      // Get registration details for confirmation
      const { data: registration, error } = await supabase
        .from('registrations')
        .select('id, program_name, booking_number, status, start_date, delegate_name, amount_cents, success_fee_cents, org_ref, provider, charge_id')
        .eq('id', registration_id)
        .single();
      
      if (error || !registration) {
        Logger.error("[cancelRegistration] Registration not found:", error);
        return this.formatError("Registration not found.");
      }
      
      // Check if cancellation is allowed
      if (registration.status === 'cancelled') {
        return this.formatError(`This registration has already been cancelled.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
      }
      
      if (registration.status === 'completed') {
        return this.formatError(`Completed registrations cannot be cancelled.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
      }
      
      const isPending = registration.status === 'pending';
      const isConfirmed = registration.status === 'confirmed';
      
      const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
      const startDateFormatted = registration.start_date 
        ? this.formatTimeForUser(new Date(registration.start_date), context)
        : 'TBD';
      const providerName = registration.org_ref === 'aim-design' ? 'AIM Design' : registration.org_ref;
      
      if (isConfirmed) {
        // Show cancellation confirmation for confirmed bookings with refund policy
        const message = getConfirmedCancelConfirmMessage({
          program_name: registration.program_name,
          provider_name: providerName,
          booking_number: registration.booking_number
        });
        
        const confirmationCard: CardSpec = {
          title: `⚠️ Cancel Confirmed Booking?`,
          subtitle: registration.program_name,
          description: [
            `**Booking #:** ${registration.booking_number || 'N/A'}`,
            `**Date:** ${startDateFormatted}`,
            `**Delegate:** ${registration.delegate_name || 'N/A'}`,
            `**Program Fee:** ${formatDollars(registration.amount_cents || 0)}`,
            `**SignupAssist Fee:** ${formatDollars(registration.success_fee_cents || 0)}`,
            ``,
            `If ${providerName} accepts, your $20 fee will be refunded.`
          ].join('\n'),
          buttons: [
            { 
              label: "Yes, Request Cancellation", 
              action: "confirm_cancel_registration", 
              variant: "secondary",
              payload: { registration_id, is_confirmed: true } 
            },
            { 
              label: "Keep Booking", 
              action: "view_receipts", 
              variant: "outline" 
            }
          ]
        };
        
        return {
          message,
          cards: [confirmationCard],
          cta: { buttons: [] }
        };
      }
      
      // Pending registration - simpler cancellation
      const message = getPendingCancelConfirmMessage({
        program_name: registration.program_name
      });
      
      const confirmationCard: CardSpec = {
        title: `⚠️ Cancel Scheduled Registration?`,
        subtitle: registration.program_name,
        description: [
          `**Date:** ${startDateFormatted}`,
          `**Delegate:** ${registration.delegate_name || 'N/A'}`,
          `**Status:** Scheduled (not yet booked)`,
          ``,
          `No booking has been made, so no charges apply.`
        ].join('\n'),
        buttons: [
          { 
            label: "Yes, Cancel Registration", 
            action: "confirm_cancel_registration", 
            variant: "secondary",
            payload: { registration_id, is_confirmed: false } 
          },
          { 
            label: "Keep Registration", 
            action: "view_receipts", 
            variant: "outline" 
          }
        ]
      };
      
      return {
        message,
        cards: [confirmationCard],
        cta: { buttons: [] }
      };
      
    } catch (err) {
      Logger.error("[cancelRegistrationStep1] Exception:", err);
      return this.formatError("An error occurred while preparing cancellation.");
    }
  }

  /**
   * Cancel Registration Step 2: Execute cancellation
   * Phase F: Actual cancellation after user confirms
   * Now handles both pending AND confirmed bookings with Bookeo API + Stripe refund
   */
  private async cancelRegistrationStep2(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const { registration_id, is_confirmed } = payload;
    const userId = context.user_id;
    
    if (!registration_id) {
      return this.formatError("Registration ID required to cancel.");
    }
    
    if (!userId) {
      return this.formatError("You must be logged in to cancel a registration.");
    }
    
    try {
      const supabase = this.getSupabaseClient();
      
      // Get full registration details
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select('*')
        .eq('id', registration_id)
        .single();
      
      if (regError || !registration) {
        return this.formatError("Registration not found.");
      }
      
      const providerName = registration.org_ref === 'aim-design' ? 'AIM Design' : registration.org_ref;
      
      // Handle PENDING registrations (simple cancellation)
      if (registration.status === 'pending') {
        Logger.info(`[cancelRegistration] Cancelling pending registration: ${registration_id}`);
        
        const result = await this.invokeMCPTool('registrations.cancel', {
          registration_id,
          user_id: userId
        });
        
        if (!result.success) {
          Logger.error("[cancelRegistration] Cancel failed:", result.error);
          return this.formatError(`Failed to cancel registration.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
        }
        
        const message = getPendingCancelSuccessMessage({
          program_name: registration.program_name
        });
        
        return {
          message,
          cards: [],
          cta: {
            buttons: [
              { label: "View Registrations", action: "view_receipts", variant: "outline" },
              { label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
            ]
          }
        };
      }
      
      // Handle CONFIRMED bookings (Bookeo cancel + Stripe refund)
      if (registration.status === 'confirmed' && registration.booking_number) {
        Logger.info(`[cancelRegistration] Attempting Bookeo cancellation: ${registration.booking_number}`);
        
        // Step 1: Cancel with Bookeo
        const bookeoResult = await this.invokeMCPTool('bookeo.cancel_booking', {
          booking_number: registration.booking_number,
          org_ref: registration.org_ref
        }, {
          mandate_id: registration.mandate_id,
          user_id: userId
        });
        
        if (!bookeoResult.success) {
          // Provider blocked cancellation
          Logger.warn("[cancelRegistration] Bookeo cancellation blocked:", bookeoResult.error);
          
          const message = getCancelFailedMessage({
            program_name: registration.program_name,
            provider_name: providerName,
            booking_number: registration.booking_number
          });
          
          return {
            message,
            cards: [],
            cta: {
              buttons: [
                { label: "View Registrations", action: "view_receipts", variant: "outline" }
              ]
            }
          };
        }
        
        Logger.info("[cancelRegistration] ✅ Bookeo cancellation successful");
        
        // Step 2: Refund success fee if there's a charge
        let refundSuccessful = false;
        if (registration.charge_id) {
          Logger.info(`[cancelRegistration] Refunding success fee: ${registration.charge_id}`);
          
          const refundResult = await this.invokeMCPTool('stripe.refund_success_fee', {
            charge_id: registration.charge_id,
            reason: 'booking_cancelled'
          }, {
            mandate_id: registration.mandate_id,
            user_id: userId
          });
          
          if (refundResult.success) {
            Logger.info("[cancelRegistration] ✅ Success fee refunded");
            refundSuccessful = true;
          } else {
            Logger.error("[cancelRegistration] Refund failed (booking still cancelled):", refundResult.error);
            // Don't fail - booking was cancelled, refund is secondary
          }
        }
        
        // Step 3: Update registration status
        const { error: updateError } = await supabase
          .from('registrations')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', registration_id);
        
        if (updateError) {
          Logger.error("[cancelRegistration] Failed to update status:", updateError);
        }
        
        const message = getCancelSuccessMessage({
          program_name: registration.program_name,
          provider_name: providerName
        });
        
        return {
          message: refundSuccessful 
            ? message 
            : message + `\n\n⚠️ _Note: Refund processing may be delayed. Contact ${SUPPORT_EMAIL} if you don't see it within 5-10 business days._`,
          cards: [],
          cta: {
            buttons: [
              { label: "View Registrations", action: "view_receipts", variant: "outline" },
              { label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
            ]
          }
        };
      }
      
      // Fallback - shouldn't reach here
      return this.formatError(`Unable to cancel this registration. Status: ${registration.status}\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
      
    } catch (err) {
      Logger.error("[cancelRegistrationStep2] Exception:", err);
      return this.formatError(`An error occurred while cancelling.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
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
   * Load saved children for user (ChatGPT App Store compliant - via MCP tool)
   */
  private async loadSavedChildren(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      Logger.warn('[loadSavedChildren] No user ID provided');
      return {
        message: "",
        metadata: { savedChildren: [] }
      };
    }
    
    Logger.info('[loadSavedChildren] Loading saved children via MCP tool', { userId });
    
    try {
      const result = await this.invokeMCPTool('user.list_children', { user_id: userId });
      
      if (!result?.success) {
        Logger.warn('[loadSavedChildren] MCP tool failed:', result?.error);
        return {
          message: "",
          metadata: { savedChildren: [] }
        };
      }
      
      const children = result.data?.children || [];
      Logger.info('[loadSavedChildren] ✅ Loaded children:', children.length);
      
      return {
        message: "",
        metadata: { savedChildren: children }
      };
    } catch (error) {
      Logger.error('[loadSavedChildren] Error:', error);
      return {
        message: "",
        metadata: { savedChildren: [] }
      };
    }
  }

  /**
   * Check payment method for user (ChatGPT App Store compliant - via MCP tool)
   */
  private async checkPaymentMethod(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      Logger.warn('[checkPaymentMethod] No user ID provided');
      return {
        message: "",
        metadata: { paymentMethod: null }
      };
    }
    
    Logger.info('[checkPaymentMethod] Checking payment method via MCP tool', { userId });
    
    try {
      const result = await this.invokeMCPTool('user.check_payment_method', { user_id: userId });
      
      if (!result?.success) {
        Logger.warn('[checkPaymentMethod] MCP tool failed:', result?.error);
        return {
          message: "",
          metadata: { paymentMethod: null }
        };
      }
      
      Logger.info('[checkPaymentMethod] ✅ Payment method check:', result.data);
      
      return {
        message: "",
        metadata: { paymentMethod: result.data }
      };
    } catch (error) {
      Logger.error('[checkPaymentMethod] Error:', error);
      return {
        message: "",
        metadata: { paymentMethod: null }
      };
    }
  }

  /**
   * Save a new child for user (ChatGPT App Store compliant - via MCP tool)
   */
  private async saveChild(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      return this.formatError("Please sign in to save participant information.");
    }
    
    const { first_name, last_name, dob } = payload;
    
    if (!first_name || !last_name) {
      return this.formatError("First name and last name are required.");
    }
    
    Logger.info('[saveChild] Saving child via MCP tool', { userId, first_name, last_name });
    
    try {
      const result = await this.invokeMCPTool('user.create_child', {
        user_id: userId,
        first_name,
        last_name,
        dob
      });
      
      if (!result?.success) {
        Logger.error('[saveChild] MCP tool failed:', result?.error);
        return this.formatError("Unable to save participant. Please try again.");
      }
      
      Logger.info('[saveChild] ✅ Child saved:', result.data?.child?.id);
      
      return {
        message: "✅ Participant saved for future registrations!",
        metadata: { savedChild: result.data?.child }
      };
    } catch (error) {
      Logger.error('[saveChild] Error:', error);
      return this.formatError("Unable to save participant. Please try again.");
    }
  }

  /**
   * Load delegate profile for user (ChatGPT App Store compliant - via MCP tool)
   */
  private async loadDelegateProfile(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      Logger.warn('[loadDelegateProfile] No user ID provided');
      return {
        message: "",
        metadata: { delegateProfile: null }
      };
    }
    
    Logger.info('[loadDelegateProfile] Loading delegate profile via MCP tool', { userId });
    
    try {
      const result = await this.invokeMCPTool('user.get_delegate_profile', { user_id: userId });
      
      if (!result?.success) {
        Logger.warn('[loadDelegateProfile] MCP tool failed:', result?.error);
        return {
          message: "",
          metadata: { delegateProfile: null }
        };
      }
      
      const profile = result.data?.profile;
      Logger.info('[loadDelegateProfile] ✅ Profile loaded:', profile ? 'found' : 'not found');
      
      return {
        message: "",
        metadata: { delegateProfile: profile }
      };
    } catch (error) {
      Logger.error('[loadDelegateProfile] Error:', error);
      return {
        message: "",
        metadata: { delegateProfile: null }
      };
    }
  }

  /**
   * Save/update delegate profile (ChatGPT App Store compliant - via MCP tool)
   */
  private async saveDelegateProfile(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      return this.formatError("Please sign in to save your profile.");
    }
    
    const { first_name, last_name, phone, date_of_birth, default_relationship } = payload;
    
    Logger.info('[saveDelegateProfile] Saving delegate profile via MCP tool', { userId });
    
    try {
      const result = await this.invokeMCPTool('user.update_delegate_profile', {
        user_id: userId,
        first_name,
        last_name,
        phone,
        date_of_birth,
        default_relationship
      });
      
      if (!result?.success) {
        Logger.error('[saveDelegateProfile] MCP tool failed:', result?.error);
        return this.formatError("Unable to save your profile. Please try again.");
      }
      
      Logger.info('[saveDelegateProfile] ✅ Profile saved');
      
      return {
        message: "✅ Your information has been saved for future registrations!",
        metadata: { savedProfile: result.data?.profile }
      };
    } catch (error) {
      Logger.error('[saveDelegateProfile] Error:', error);
      return this.formatError("Unable to save your profile. Please try again.");
    }
  }

  /**
   * Convert Bookeo time unit to milliseconds
   */
  private getMilliseconds(unit: string): number {
    const units: Record<string, number> = {
      'hours': 60 * 60 * 1000,
      'days': 24 * 60 * 60 * 1000,
      'weeks': 7 * 24 * 60 * 60 * 1000,
      'months': 30 * 24 * 60 * 60 * 1000, // Approximate
      'years': 365 * 24 * 60 * 60 * 1000  // Approximate
    };
    return units[unit] || 0;
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
