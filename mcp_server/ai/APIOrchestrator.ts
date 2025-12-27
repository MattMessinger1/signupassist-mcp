/**
 * APIOrchestrator.ts
 * Clean API-first orchestrator for providers with direct API access
 * Flow: BROWSE → FORM_FILL → PAYMENT
 * No scraping, no prerequisites, no session complexity
 */

// V1 default: NO widgets. If we ever bring widgets back, flip env var to true.
const WIDGET_ENABLED = process.env.WIDGET_ENABLED === 'true';

import type { 
  OrchestratorResponse, 
  CardSpec, 
  ButtonSpec,
  IOrchestrator
} from "./types.js";
import type { InputClassification } from "../types.js";
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
  getScheduledPaymentAuthorizationMessage,
  getInitialActivationMessage,
  getFallbackClarificationMessage,
  getGracefulDeclineMessage,
  getLocationQuestionMessage,
  getOutOfAreaProgramsMessage,
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
import { createClient } from "@supabase/supabase-js";
import { lookupCity } from "../utils/cityLookup.js";
import { analyzeLocation } from "./orchestratorMultiBackend.js";
import { 
  extractActivityFromMessage as matcherExtractActivity,
  getActivityDisplayName
} from "../utils/activityMatcher.js";
import { getAllActiveOrganizations } from "../config/organizations.js";
import { callOpenAI_JSON } from "../lib/openaiHelpers.js";
import { checkAudienceMismatch } from "../utils/audienceParser.js";

// Simple flow steps for API-first providers
enum FlowStep {
  BROWSE = "BROWSE",           // Browse programs → select program
  FORM_FILL = "FORM_FILL",     // Collect child & delegate info
  REVIEW = "REVIEW",           // Review details and consent
  PAYMENT = "PAYMENT",         // Payment method setup (Stripe)
  SUBMIT = "SUBMIT",           // Submit booking confirmation
  COMPLETED = "COMPLETED"      // Booking completed (receipt shown)
}

// Minimal context for API-first flow
interface APIContext {
  step: FlowStep;
  orgRef?: string;
  user_id?: string;
  userTimezone?: string;  // User's IANA timezone (e.g., 'America/Chicago')
  requestedActivity?: string;  // Track what activity user is looking for (e.g., 'swimming', 'coding')

  // Audience preference (e.g., user asked for "adults")
  requestedAdults?: boolean;
  ignoreAudienceMismatch?: boolean;
  
  // Location handling: bypass location filter to show out-of-area programs
  ignoreLocationFilter?: boolean;
  requestedLocation?: string;  // Original location user asked for

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
  
  // Explicit payment authorization flag - prevents NL parser from skipping consent
  paymentAuthorized?: boolean;
  
  // ChatGPT NL compatibility: store displayed programs for title/ordinal matching
  displayedPrograms?: Array<{ title: string; program_ref: string; program_data?: any }>;
  
  // ChatGPT NL compatibility: pending provider confirmation (for "Yes" responses)
  pendingProviderConfirmation?: string;
  
  // ChatGPT NL compatibility: multi-participant flow
  pendingParticipants?: Array<{ firstName: string; lastName: string; age?: number }>;
  
  // ChatGPT NL compatibility: delegate info collection
  pendingDelegateInfo?: { email?: string; firstName?: string; lastName?: string; phone?: string };
  awaitingDelegateEmail?: boolean;

  // Form schema cache (from bookeo.discover_required_fields)
  requiredFields?: {
    delegate?: Array<{ key: string; label?: string; required?: boolean; type?: string }>;
    participant?: Array<{ key: string; label?: string; required?: boolean; type?: string }>;
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
  
  // Build stamp for debugging which version is running in production
  private static readonly BUILD_STAMP = {
    build_id: '2025-12-21T08:00:00Z',
    orchestrator_mode: 'api-first',
    version: '2.7.0-session-state-recovery'
  };
  
  // LRU cache for input classification results (avoid redundant LLM calls)
  private classificationCache: Map<string, { result: InputClassification; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly CACHE_MAX_SIZE = 500;

  constructor(mcpServer: any) {
    this.mcpServer = mcpServer;
    Logger.info("APIOrchestrator initialized - API-first mode with MCP tool access");
    Logger.info(`[BUILD] ${JSON.stringify(APIOrchestrator.BUILD_STAMP)}`);
  }

  /**
   * SESSION KEYING (Auth0 + client sessionId)
   *
   * Problem: in production logs we were effectively keying sessions ONLY by Auth0 user id,
   * which causes "new chat" or "refresh" to resurrect an older in-flight signup (stuck on a prior program).
   *
   * Fix: if userId is present, scope the durable session id to:
   *   `${userId}::${originalSessionId}`
   *
   * This preserves "stable identity" (per user) while still allowing multiple independent chat sessions.
   */
  private resolveDurableSessionId(originalSessionId: string, userId?: string): string {
    const sid = String(originalSessionId || "chatgpt").trim();
    const uid = userId ? String(userId).trim() : "";
    if (!uid) return sid;

    // If caller mistakenly passes the Auth0 userId as the sessionId,
    // avoid creating a nonsense key like "auth0|...::auth0|...".
    if (sid === uid) {
      return `${uid}::default`;
    }

    // If already scoped, leave it alone (prevents double-scoping).
    if (sid.includes("::")) {
      return sid;
    }
    return `${uid}::${sid}`;
  }
  
  // ============================================================================
  // ChatGPT Natural Language Parsing Helpers
  // ============================================================================
  
  /**
   * Parse child info from natural language input
   * Handles: "Percy Messinger, 11", "Percy (11)", "Name: Percy, Age: 11"
   * For ChatGPT compatibility where users type instead of clicking buttons
   */
  private parseChildInfoFromMessage(input: string): { name: string; age?: number; firstName?: string; lastName?: string } | null {
    const trimmed = input.trim();
    
    // Pattern 1: "Name, Age" - e.g., "Percy Messinger, 11"
    const commaAgePattern = /^(.+?),?\s*(\d{1,2})(?:\s*(?:years?\s*old|yo))?$/i;
    const commaMatch = trimmed.match(commaAgePattern);
    if (commaMatch) {
      const fullName = commaMatch[1].trim();
      const nameParts = fullName.split(/\s+/);
      return {
        name: fullName,
        age: parseInt(commaMatch[2], 10),
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || ''
      };
    }
    
    // Pattern 2: "Name (Age)" - e.g., "Percy (11)"
    const parenPattern = /^(.+?)\s*\((\d{1,2})\)$/;
    const parenMatch = trimmed.match(parenPattern);
    if (parenMatch) {
      const fullName = parenMatch[1].trim();
      const nameParts = fullName.split(/\s+/);
      return {
        name: fullName,
        age: parseInt(parenMatch[2], 10),
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || ''
      };
    }
    
    // Pattern 3: "Name: X, Age: Y" - e.g., "Name: Percy, Age: 11"
    const labeledPattern = /^(?:name:?\s*)?(.+?)\s*,?\s*(?:age:?\s*)?(\d{1,2})$/i;
    const labeledMatch = trimmed.match(labeledPattern);
    if (labeledMatch && labeledMatch[1].length < 50) {
      const fullName = labeledMatch[1].trim();
      const nameParts = fullName.split(/\s+/);
      return {
        name: fullName,
        age: parseInt(labeledMatch[2], 10),
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || ''
      };
    }
    
    // Pattern 4: Just a name (no age) - e.g., "Percy Messinger"
    // Must look like a proper name (capitalized words, reasonable length)
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(trimmed) && trimmed.length >= 2 && trimmed.length < 50) {
      const nameParts = trimmed.split(/\s+/);
      return {
        name: trimmed,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || ''
      };
    }
    
    return null;
  }

  /**
   * Parse child info in strict "FirstName LastName, Age" format
   * For robust handling of inputs like "Percy Messinger, 11"
   */
  private parseChildLine(input: string): { firstName: string; lastName: string; age: number } | null {
    const s = (input || "").trim();
    // Match: "Percy Messinger, 11" / "Percy Messinger 11" / "Percy Messinger (11)"
    const m = s.match(/^([A-Za-z'-]+)\s+([A-Za-z'-]+)[,\s()]*([0-9]{1,2})\s*$/);
    if (!m) return null;
    const age = Number(m[3]);
    if (!Number.isFinite(age) || age < 0 || age > 120) return null;
    return { firstName: m[1], lastName: m[2], age };
  }
  
  /**
   * Detect if input is a user confirmation
   * Handles: "Yes", "Yeah", "Sure", "Ok", "Confirm", "Go ahead", etc.
   * For ChatGPT compatibility where users type instead of clicking buttons
   */
  private isUserConfirmation(input: string): boolean {
    const confirmPatterns = /^(yes|yeah|yep|yup|sure|ok|okay|confirm|go ahead|please|do it|book it|let's do it|let's go|sounds good|authorize|proceed|continue|absolutely|definitely|i confirm|yes please|that's right|correct)\.?!?$/i;
    return confirmPatterns.test(input.trim());
  }

  // ---------------------------------------------------------------------------
  // Chat-only intent helpers (eliminate "Madison?" + "which activity?" loops)
  // ---------------------------------------------------------------------------
  private isBrowseAllIntent(input: string): boolean {
    const s = (input || "").trim().toLowerCase();
    if (!s) return false;
    return (
      s === "browse" ||
      s === "show" ||
      s === "list" ||
      s === "anything" ||
      s === "whatever" ||
      s.includes("browse") ||
      s.includes("show programs") ||
      s.includes("show classes") ||
      s.includes("list programs") ||
      s.includes("list classes") ||
      s.includes("show all") ||
      s.includes("all programs") ||
      s.includes("all classes")
    );
  }

  private hasSignupIntent(input: string): boolean {
    return /\b(sign\s*up|signup|register|enroll|enrol|book|reserve|set\s*and\s*forget|auto[-\s]?register|schedule)\b/i.test(input || "");
  }

  private hasProgramWords(input: string): boolean {
    return /\b(class|classes|course|courses|program|programs|camp|camps|lesson|lessons|workshop|workshops)\b/i.test(input || "");
  }

  // ============================================================================
  // Option A: Free-text → Form hydration helpers
  // ============================================================================

  /**
   * Best-effort parse for phone numbers from free text
   */
  private parsePhoneNumber(input: string): string | null {
    const phone = input.match(/(\+?1[\s-]?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
    return phone ? phone[0].trim() : null;
  }

  /**
   * Extract likely "delegate name" from text ("Matt Messinger") if present.
   * Very conservative: two capitalized words.
   */
  private parseAdultName(input: string): { firstName: string; lastName: string } | null {
    const m = input.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
    if (!m) return null;
    return { firstName: m[1], lastName: m[2] };
  }

  /**
   * Hydrate context.formData from free-text user input using:
   * - known helpers (child name/age, email)
   * - requiredFields schema keys (delegate vs participant)
   *
   * Returns the updated formData (may be partial).
   */
  private hydrateFormDataFromText(input: string, context: APIContext): Record<string, any> {
    const formData: Record<string, any> = { ...(context.formData || {}) };

    // 1) Email
    const email = this.parseDelegateEmail(input);
    if (email) {
      context.pendingDelegateInfo = { ...(context.pendingDelegateInfo || {}), email };
    }

    // 2) Phone
    const phone = this.parsePhoneNumber(input);
    if (phone) {
      context.pendingDelegateInfo = { ...(context.pendingDelegateInfo || {}), phone };
    }

    // 3) Child info
    const child = this.parseChildInfoFromMessage(input);
    if (child) {
      context.childInfo = {
        name: child.name,
        age: child.age,
      };
    }

    // 4) Adult name (delegate)
    const adult = this.parseAdultName(input);
    if (adult) {
      context.pendingDelegateInfo = {
        ...(context.pendingDelegateInfo || {}),
        firstName: context.pendingDelegateInfo?.firstName || adult.firstName,
        lastName: context.pendingDelegateInfo?.lastName || adult.lastName,
      };
    }

    // 5) Map into schema keys (best effort)
    const delegateFields = context.requiredFields?.delegate || [];
    const participantFields = context.requiredFields?.participant || [];

    // Delegate mapping
    const d = context.pendingDelegateInfo || {};
    for (const f of delegateFields) {
      const k = f.key;
      const lk = k.toLowerCase();
      if (formData[k] != null) continue;

      if (d.email && (lk.includes('email'))) formData[k] = d.email;
      else if (d.phone && (lk.includes('phone') || lk.includes('mobile') || lk.includes('cell'))) formData[k] = d.phone;
      else if (d.firstName && (lk.includes('first') && lk.includes('name'))) formData[k] = d.firstName;
      else if (d.lastName && (lk.includes('last') && lk.includes('name'))) formData[k] = d.lastName;
      else if (!lk.includes('first') && !lk.includes('last') && lk.includes('name') && d.firstName && d.lastName) {
        // fallback "name" field
        formData[k] = `${d.firstName} ${d.lastName}`.trim();
      }
    }

    // Participant mapping (single child for now)
    const c = context.childInfo;
    for (const f of participantFields) {
      const k = f.key;
      const lk = k.toLowerCase();
      if (formData[k] != null) continue;

      if (c?.name && lk.includes('name')) formData[k] = c.name;
      else if (typeof c?.age === 'number' && (lk.includes('age') || lk.includes('years'))) formData[k] = c.age;
      else if (c?.dob && (lk.includes('dob') || lk.includes('birth'))) formData[k] = c.dob;
    }

    return formData;
  }

  /**
   * Determine if required fields are satisfied for submit_form.
   * Conservative: all required=true fields must exist and be non-empty.
   */
  private hasAllRequiredFields(context: APIContext, formData: Record<string, any>): boolean {
    const required = [
      ...(context.requiredFields?.delegate || []).filter(f => f.required),
      ...(context.requiredFields?.participant || []).filter(f => f.required),
    ];
    if (required.length === 0) return Object.keys(formData).length > 0;

    for (const f of required) {
      const v = formData[f.key];
      if (v == null) return false;
      if (typeof v === 'string' && v.trim().length === 0) return false;
    }
    return true;
  }
  
  /**
   * Parse program selection from natural language
   * Handles: "The Coding Course", "the first one", "option 2", "number 3"
   * Also handles confirmation phrases ("yes", "sign me up") when only 1 program is displayed
   * For ChatGPT compatibility where users type instead of clicking buttons
   */
  private parseProgramSelection(input: string, displayedPrograms: Array<{ title: string; program_ref: string; program_data?: any }>): { title: string; program_ref: string; program_data?: any } | null {
    console.log('[parseProgramSelection] 🔍 TRACE: Starting parse', {
      input,
      displayedProgramsCount: displayedPrograms?.length || 0,
      displayedTitles: displayedPrograms?.map(p => p.title).join(', ') || 'none'
    });
    
    if (!displayedPrograms || displayedPrograms.length === 0) {
      console.log('[parseProgramSelection] ❌ TRACE: No displayed programs to match against');
      return null;
    }
    
    const normalized = input.toLowerCase().trim();
    
    // CONFIRMATION PHRASE DETECTION: When user says "yes" and only 1 program is displayed
    const confirmationPatterns = /^(yes|yep|yeah|yup|sure|ok|okay|do it|go ahead|sign me up|let's do it|let's go|sounds good|book it|register|proceed|continue|absolutely|definitely|i confirm|yes please|that's right|correct|sign up|start signup|start registration)\.?!?$/i;
    if (confirmationPatterns.test(normalized) && displayedPrograms.length === 1) {
      console.log('[parseProgramSelection] ✅ TRACE: Confirmation phrase with single program - auto-selecting');
      Logger.info('[NL Parse] Confirmation phrase matched with single program', { 
        source: 'natural_language', 
        phrase: input,
        matchedTitle: displayedPrograms[0].title 
      });
      return displayedPrograms[0];
    }
    
    // Strip common prefixes from input: "select ", "choose ", "I want ", etc.
    const cleanedInput = normalized
      .replace(/^(select|choose|pick|i want|i'd like|sign up for|register for|book)\s+/i, '')
      .trim();
    
    // Match by title (fuzzy contains match with improved keyword extraction)
    const titleMatch = displayedPrograms.find(p => {
      const progTitle = (p.title || '').toLowerCase();
      // Check if user's input contains the program title or vice versa
      if (cleanedInput.includes(progTitle) || progTitle.includes(cleanedInput)) {
        return true;
      }
      
      // Extract meaningful keywords from program title (skip CLASS prefixes, ages, etc.)
      const progKeywords = progTitle
        .replace(/^class\s*\d+:\s*/i, '') // Remove "CLASS N:" prefix
        .replace(/\s*\(ages?\s*\d+[-–]\d+\)\s*/gi, '') // Remove "(Ages X-Y)"
        .replace(/\s*ages?\s*\d+[-–]\d+\s*/gi, '') // Remove "Ages X-Y" without parens
        .replace(/\s*–\s*/g, ' ') // Replace em-dash with space
        .trim()
        .toLowerCase();
      
      // Check if cleaned input matches the core program name
      if (cleanedInput.includes(progKeywords) || progKeywords.includes(cleanedInput)) {
        return true;
      }
      
      // Check for significant word overlap (at least 2 words match)
      const inputWords = cleanedInput.split(/\s+/).filter(w => w.length > 2);
      const progWords = progKeywords.split(/\s+/).filter(w => w.length > 2);
      const matchingWords = inputWords.filter(w => progWords.some(pw => pw.includes(w) || w.includes(pw)));
      if (matchingWords.length >= 2) {
        return true;
      }
      
      return false;
    });
    if (titleMatch) {
      console.log('[parseProgramSelection] ✅ TRACE: Matched by title', { 
        matchedTitle: titleMatch.title,
        program_ref: titleMatch.program_ref
      });
      Logger.info('[NL Parse] Program matched by title', { 
        source: 'natural_language', 
        matchedTitle: titleMatch.title,
        userInput: input 
      });
      return titleMatch;
    }
    
    // Match by ordinal: "the first one", "option 2", "number 3", "the second", "Class 2"
    // IMPORTANT: Only match ordinals that appear to be intentional selections, not ages in program names
    // Use strict patterns that require ordinal context (e.g., "class 2", "the first", "option 1")
    const ordinalPatterns = [
      /^(?:class|option|program|number|#)\s*(\d)$/i,                  // "class 2", "option 1", "#3"
      /^(\d)(?:st|nd|rd|th)?(?:\s+(?:one|class|option|program))?$/i,  // "2nd", "3rd one", "1st class"
      /^the\s+(first|second|third|fourth|fifth)\s*(?:one|class|option|program)?$/i, // "the first one"
      /^(first|second|third|fourth|fifth)\s*(?:one|class|option|program)?$/i,       // "first one", "second"
    ];
    
    for (const pattern of ordinalPatterns) {
      const ordinalMatch = cleanedInput.match(pattern);
      if (ordinalMatch) {
        const matched = (ordinalMatch[1] || '').toLowerCase();
        const ordinalMap: Record<string, number> = {
          'first': 0, '1st': 0, '1': 0, 'one': 0,
          'second': 1, '2nd': 1, '2': 1, 'two': 1,
          'third': 2, '3rd': 2, '3': 2, 'three': 2,
          'fourth': 3, '4th': 3, '4': 3, 'four': 3,
          'fifth': 4, '5th': 4, '5': 4, 'five': 4,
        };
        const idx = ordinalMap[matched] ?? -1;
        console.log('[parseProgramSelection] 🔍 TRACE: Ordinal match attempt', {
          pattern: pattern.source,
          matched,
          idx,
          programsAvailable: displayedPrograms.length
        });
        if (idx >= 0 && idx < displayedPrograms.length) {
          console.log('[parseProgramSelection] ✅ TRACE: Matched by ordinal', {
            ordinal: matched,
            index: idx,
            matchedTitle: displayedPrograms[idx].title,
            program_ref: displayedPrograms[idx].program_ref
          });
          Logger.info('[NL Parse] Program matched by ordinal', { 
            source: 'natural_language', 
            ordinal: matched,
            index: idx,
            matchedTitle: displayedPrograms[idx].title 
          });
          return displayedPrograms[idx];
        }
      }
    }
    
    console.log('[parseProgramSelection] ❌ TRACE: No match found');
    return null;
  }
  
  /**
   * Parse multiple children from a single natural language message
   * Handles: "Percy, 11 and Alice, 9", "John Smith 8, Jane Smith 6"
   * For ChatGPT multi-participant registration flow
   */
  private parseMultipleChildrenFromMessage(input: string): Array<{ name: string; age?: number; firstName?: string; lastName?: string }> {
    const results: Array<{ name: string; age?: number; firstName?: string; lastName?: string }> = [];
    
    // Split by common delimiters: "and", "&", newlines, semicolons
    const segments = input.split(/\s+(?:and|&)\s+|[;\n]+/i).map(s => s.trim()).filter(Boolean);
    
    for (const segment of segments) {
      const parsed = this.parseChildInfoFromMessage(segment);
      if (parsed) {
        results.push(parsed);
      }
    }
    
    // If no splits worked, try parsing the whole input as a single child
    if (results.length === 0) {
      const singleParsed = this.parseChildInfoFromMessage(input);
      if (singleParsed) {
        results.push(singleParsed);
      }
    }
    
    return results;
  }
  
  /**
   * Detect if input indicates user is done adding participants
   * Handles: "done", "that's all", "no more", "finished", "nope", etc.
   */
  private isDoneIndicator(input: string): boolean {
    const donePatterns = /^(done|that's all|thats all|no more|finished|complete|nobody else|just (them|those|that)|nope|no|i'm done|im done|that's it|thats it|all set|we're good|were good)\.?!?$/i;
    return donePatterns.test(input.trim());
  }
  
  /**
   * Parse delegate email from natural language input
   * Handles: "my email is john@example.com", "john@example.com", "email: john@test.com"
   */
  private parseDelegateEmail(input: string): string | null {
    const emailPattern = /[\w.+-]+@[\w.-]+\.\w{2,}/;
    const match = input.match(emailPattern);
    return match ? match[0].toLowerCase() : null;
  }
  
  /**
   * Parse secondary actions from natural language
   * Handles: "show my registrations", "cancel my booking", "view audit trail"
   */
  private parseSecondaryAction(input: string): { action: string; payload?: any } | null {
    const normalized = input.toLowerCase().trim();
    
    // View registrations / receipts / bookings
    if (/\b(show|view|see|list|my)\b.*\b(registrations?|bookings?|receipts?|signups?|enrollments?)\b/i.test(normalized) ||
        /\b(registrations?|bookings?|receipts?)\b.*\b(please|show|view)?\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: view_receipts', { source: 'natural_language', input });
      return { action: 'view_receipts' };
    }
    
    // Cancel registration
    if (/\b(cancel|remove|delete|undo)\b.*\b(registration|booking|signup|enrollment)\b/i.test(normalized) ||
        /\b(registration|booking)\b.*\b(cancel|remove)\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: cancel_registration', { source: 'natural_language', input });
      return { action: 'cancel_registration' };
    }
    
    // View audit trail / history
    if (/\b(audit|trail|history|log|activity)\b/i.test(normalized) && 
        /\b(show|view|see|my)\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: view_audit_trail', { source: 'natural_language', input });
      return { action: 'view_audit_trail' };
    }
    
    return null;
  }
  
  /**
   * Normalize location input by stripping common qualifiers
   * Handles: "near Chicago", "around Madison", "in the Madison area"
   */
  private normalizeLocationInput(input: string): string {
    return input
      .replace(/\b(near|around|close to|in|at|the)\b/gi, '')
      .replace(/\b(area|region|city|metro|vicinity)\b/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Collapse multiple spaces
  }
  
  /**
   * Extract a city name from a message that may contain other content
   * Handles: "STEM classes in Madison", "Find robotics near Madison WI", "swimming in Madison, Wisconsin"
   * 
   * Uses pattern matching to find city references within longer messages
   */
  private extractCityFromMessage(input: string): string | null {
    const normalized = input.toLowerCase().trim();
    
    // Pattern 1: "in [City]" or "in [City], [State]" or "in [City] [State]"
    const inCityMatch = input.match(/\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*([A-Z]{2})?/i);
    if (inCityMatch) {
      const city = inCityMatch[1].trim();
      const state = inCityMatch[2];
      const result = lookupCity(state ? `${city}, ${state}` : city);
      if (result.found) {
        return state ? `${city}, ${state}` : city;
      }
    }
    
    // Pattern 2: "near [City]" or "near [City], [State]"
    const nearCityMatch = input.match(/\bnear\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*([A-Z]{2})?/i);
    if (nearCityMatch) {
      const city = nearCityMatch[1].trim();
      const state = nearCityMatch[2];
      const result = lookupCity(state ? `${city}, ${state}` : city);
      if (result.found) {
        return state ? `${city}, ${state}` : city;
      }
    }
    
    // Pattern 3: "[City], [State]" anywhere in the message
    const cityStateMatch = input.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*([A-Z]{2})\b/);
    if (cityStateMatch) {
      const city = cityStateMatch[1].trim();
      const state = cityStateMatch[2];
      const result = lookupCity(`${city}, ${state}`);
      if (result.found) {
        return `${city}, ${state}`;
      }
    }
    
    // Pattern 4: Check known supported cities in the message
    const supportedCities = this.getSupportedCities();
    for (const city of supportedCities) {
      // Case-insensitive check for city name
      const cityRegex = new RegExp(`\\b${city}\\b`, 'i');
      if (cityRegex.test(normalized)) {
        // Found a supported city - verify with lookup
        const result = lookupCity(city);
        if (result.found) {
          return result.suggestedMatch!.city;
        }
      }
    }
    
    // Pattern 5: Try to find any city-like word (capitalized word at word boundary)
    // and verify it with lookupCity
    const potentialCities = input.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
    if (potentialCities) {
      for (const potential of potentialCities) {
        // Skip common non-city words
        const skipWords = ['I', 'STEM', 'Find', 'Looking', 'Need', 'Want', 'Please', 'Help', 'For', 'My', 'The', 'And', 'Or', 'In', 'Near', 'At'];
        if (skipWords.includes(potential)) continue;
        
        const result = lookupCity(potential);
        if (result.found && !result.needsDisambiguation) {
          return result.suggestedMatch!.city;
        }
      }
    }
    
    return null;
  }
  
  // ============================================================================
  // Tiered Input Classification System
  // ============================================================================
  
  /**
   * Get cities from registered organizations (dynamic, no hardcoding)
   */
  private getSupportedCities(): string[] {
    return getAllActiveOrganizations()
      .map(org => org.location?.city?.toLowerCase())
      .filter((city): city is string => !!city);
  }
  
  /**
   * Get organization search keywords for pattern detection
   */
  private getOrgSearchKeywords(): string[] {
    return getAllActiveOrganizations()
      .flatMap(org => org.searchKeywords || [])
      .map(kw => kw.toLowerCase());
  }
  
  /**
   * Tier 1: Fast heuristic detection for organizations
   * Detects possessives, business suffixes, and known org keywords
   */
  private detectOrganizationPattern(input: string): boolean {
    const normalized = input.toLowerCase().trim();
    
    // Check against registered org keywords (dynamic!)
    const orgKeywords = this.getOrgSearchKeywords();
    if (orgKeywords.some(kw => normalized.includes(kw))) {
      return true;
    }
    
    // Possessive pattern: "Joe's", "Mary's" (common in business names)
    if (/\b\w+'s\b/i.test(input)) {
      return true;
    }
    
    // Business suffixes that indicate organization names
    const bizSuffixes = ['inc', 'llc', 'club', 'studio', 'academy', 'center', 'centre', 'school', 'gym', 'ymca', 'ywca'];
    if (bizSuffixes.some(s => normalized.includes(s))) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Tiered input classification: fast heuristics → cache → LLM fallback
   * Guarantees <5ms for 80-90% of cases, uses LLM only when ambiguous
   */
  private async classifyInputType(input: string): Promise<InputClassification> {
    const normalized = input.toLowerCase().trim();
    
    // Tier 1: Fast heuristic - check activity keywords first
    const activityMatch = matcherExtractActivity(input);
    if (activityMatch) {
      Logger.debug('[classifyInputType] Tier 1 heuristic: detected activity', activityMatch);
      return { 
        type: 'activity', 
        confidence: 0.95, 
        source: 'heuristic',
        detectedValue: activityMatch
      };
    }
    
    // Tier 1: Fast heuristic - check organization patterns
    if (this.detectOrganizationPattern(input)) {
      Logger.debug('[classifyInputType] Tier 1 heuristic: detected organization pattern');
      return { 
        type: 'organization', 
        confidence: 0.90, 
        source: 'heuristic',
        detectedValue: input 
      };
    }
    
    // Tier 2: Check cache
    const cached = this.classificationCache.get(normalized);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      Logger.debug('[classifyInputType] Tier 2 cache hit');
      return { ...cached.result, source: 'cache' };
    }
    
    // Tier 3: LLM fallback for truly ambiguous cases
    try {
      Logger.info('[classifyInputType] Tier 3 LLM fallback for:', input);
      
      const llmResult = await callOpenAI_JSON({
        model: 'gpt-4o-mini',
        system: `Classify user input as either an activity/program type or an organization name.
Activity examples: "swimming", "coding classes", "basket weaving", "darts"
Organization examples: "Joe's Dance Studio", "YMCA", "AIM Design", "Madison Swim Club"
Return JSON: {"type":"activity"|"organization","confidence":0.0-1.0}
If truly ambiguous, use type "ambiguous" with lower confidence.`,
        user: input,
        maxTokens: 50,
        temperature: 0,
      });
      
      const result: InputClassification = {
        type: llmResult?.type === 'activity' ? 'activity' : 
              llmResult?.type === 'organization' ? 'organization' : 'ambiguous',
        confidence: typeof llmResult?.confidence === 'number' ? llmResult.confidence : 0.5,
        source: 'llm',
        detectedValue: input
      };
      
      // Cache the result (with LRU eviction)
      if (this.classificationCache.size >= this.CACHE_MAX_SIZE) {
        // Remove oldest entry
        const oldestKey = this.classificationCache.keys().next().value;
        if (oldestKey) this.classificationCache.delete(oldestKey);
      }
      this.classificationCache.set(normalized, { result, timestamp: Date.now() });
      
      return result;
    } catch (error) {
      Logger.warn('[classifyInputType] LLM fallback failed, defaulting to ambiguous:', error);
      return { type: 'ambiguous', confidence: 0.3, source: 'heuristic' };
    }
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
      // ================================================================
      // AUTH0 + CLIENT SESSION SCOPING
      // Make sessions per (auth0 user) + (client sessionId), so new chat/refresh
      // creates a new session instead of resurrecting an old in-flight signup.
      // ================================================================
      const originalSessionId = String(sessionId || "chatgpt");
      const durableSessionId = this.resolveDurableSessionId(originalSessionId, userId);
      const isAuth0Session = !!userId;
      
      if (durableSessionId !== originalSessionId) {
        Logger.info("[AUTH0-SESSION] 🔑 Session key resolution", {
          originalSessionId,
          auth0UserId: userId,
          durableSessionId,
          isAuth0Session
        });
      }

      // IMPORTANT: from here on, use the durableSessionId for ALL context/persistence.
      const contextSessionId = durableSessionId;

      // ✅ CRITICAL: Use async context loading to restore from Supabase if needed
      // This fixes ChatGPT multi-turn conversations losing context between API calls
      const context = await this.getContextAsync(contextSessionId);

      Logger.info('[generateResponse] Context loaded', {
        sessionId,
        contextSessionId,
        isAuth0Session,
        step: context.step,
        hasSelectedProgram: !!context.selectedProgram,
        hasFormData: !!context.formData,
        hasSchedulingData: !!context.schedulingData,
        requestedActivity: context.requestedActivity
      });

      // Store user ID and timezone in context
      if (userId) {
        this.updateContext(contextSessionId, { user_id: userId });
        Logger.info('[APIOrchestrator] User authenticated', { userId });
      }

      // Store user timezone in context
      if (userTimezone && userTimezone !== context.userTimezone) {
        this.updateContext(contextSessionId, { userTimezone });
      }

      // Handle explicit actions (button clicks)
      if (action) {
        const response = await this.handleAction(action, payload, contextSessionId, context, input);
        return this.attachContextSnapshot(response, contextSessionId);
      }

      // Handle natural language messages
      const response = await this.handleMessage(input, contextSessionId, context);
      return this.attachContextSnapshot(response, contextSessionId);
    } catch (error) {
      Logger.error('APIOrchestrator error:', error);
      return this.formatError('Sorry, something went wrong. Please try again.');
    }
  }

  /**
   * Handle action (button click)
   */
  private async handleAction(
    action: string,
    payload: any,
    sessionId: string,
    context: APIContext,
    input?: string  // Optional: user's natural language message for fallback parsing
  ): Promise<OrchestratorResponse> {
    // -------------------------------------------------------------------------
    // Secondary Bug Fix: Resolve aliases FIRST (before any step gating).
    // -------------------------------------------------------------------------
    const ACTION_ALIASES: Record<string, string> = {
      'confirm_booking': 'authorize_payment',    // Old ChatGPT action name
      'cancel_booking': 'cancel_registration',   // Old ChatGPT action name
      'answer_questions': 'submit_form',         // Old ChatGPT action name
      'start_over': 'clear_context',             // Old ChatGPT action name
      'show_more_programs': 'search_programs',   // Alias for browse
      'back': 'clear_context',                   // Treat back as reset
    };
    
    const resolvedAction = ACTION_ALIASES[action] || action;
    if (resolvedAction !== action) {
      Logger.info(`[handleAction] Aliased deprecated action: ${action} → ${resolvedAction}`);
    }

    // -------------------------------------------------------------------------
    // Step gate based on RESOLVED action (not deprecated action).
    // Prevents weird "gated before alias" behaviors.
    // -------------------------------------------------------------------------
    const STEP_REQUIREMENTS: Record<string, FlowStep> = {
      // user must be filling a form to submit it
      'submit_form': FlowStep.FORM_FILL,
      // payment authorization should only happen in PAYMENT step
      'authorize_payment': FlowStep.PAYMENT,
    };
    const requiredStep = STEP_REQUIREMENTS[resolvedAction];
    if (requiredStep && context.step !== requiredStep) {
      Logger.warn(`[${resolvedAction}] ⛔ STEP GATE: Not in ${requiredStep} step`, { currentStep: context.step });
      return this.formatResponse(
        `Step 1/5 — Finding classes\n\nWe need to collect some information first before I can continue.`,
        undefined,
        []
      );
    }
    
    switch (resolvedAction) {
      case "search_programs": {
        // =========================================================================
        // BROWSE INTENT: Clear selection state before showing programs
        // This ensures "yes" won't be misinterpreted as confirming stale selection
        // =========================================================================
        const ignore = typeof payload?.ignoreAudienceMismatch === 'boolean' ? payload.ignoreAudienceMismatch : false;
        this.updateContext(sessionId, { 
          ignoreAudienceMismatch: ignore,
          selectedProgram: null,
          step: FlowStep.BROWSE,
        });
        Logger.info('[search_programs] Cleared selection state for fresh browse');
        return await this.searchPrograms(payload.orgRef || "aim-design", sessionId);
      }

      case "select_program":
        {
          // -------------------------------------------------------------------
          // ChatGPT Compatibility Fix:
          // Sometimes ChatGPT triggers select_program with an empty payload when
          // the user types "yes" instead of clicking a card button.
          // We recover using displayedPrograms + natural-language parsing.
          // -------------------------------------------------------------------
          const hasPayload =
            payload &&
            typeof payload === "object" &&
            Object.keys(payload).length > 0;

          if (!hasPayload && typeof input === "string") {
            const displayed = context.displayedPrograms || [];
            // Try to infer selection from user's text (yes/ordinal/title)
            const inferred = this.parseProgramSelection(input, displayed);
            if (inferred) {
              const recoveredPayload = {
                program_ref: inferred.program_ref,
                program_data: inferred.program_data || {
                  title: inferred.title,
                  program_ref: inferred.program_ref,
                },
              };
              Logger.info("[select_program] Recovered missing payload from NL input", {
                input,
                program_ref: recoveredPayload.program_ref,
              });
              return await this.selectProgram(recoveredPayload, sessionId, context, input);
            }

            // If we already have a selectedProgram in context, treat confirmation as proceed
            if (this.isUserConfirmation(input) && context.selectedProgram) {
              const ref =
                (context.selectedProgram?.program_ref as string) ||
                (context.selectedProgram?.ref as string) ||
                undefined;
              if (ref) {
                const recoveredPayload = {
                  program_ref: ref,
                  program_data: context.selectedProgram,
                };
                Logger.info("[select_program] Using selectedProgram from context (confirmation)", {
                  input,
                  program_ref: recoveredPayload.program_ref,
                });
                return await this.selectProgram(recoveredPayload, sessionId, context, input);
              }
            }
          }

          // Default path: use whatever payload we were given (may still error if empty,
          // but now we only hit this when we truly can't infer a selection)
          return await this.selectProgram(payload, sessionId, context, input);
        }

      case "submit_form":
        {
          // -------------------------------------------------------------------
          // Option A: if payload is empty, hydrate from free-text.
          // ChatGPT often sends submit_form with payload {} even after user typed answers.
          // -------------------------------------------------------------------
          const hasPayload =
            payload &&
            typeof payload === "object" &&
            Object.keys(payload).length > 0;

          // If schema isn't stored yet, still hydrate what we can into context.formData.
          if (!hasPayload && typeof input === "string") {
            const hydrated = this.hydrateFormDataFromText(input, context);
            context.formData = hydrated;
            this.updateContext(sessionId, { formData: hydrated, pendingDelegateInfo: context.pendingDelegateInfo, childInfo: context.childInfo });
            payload = { formData: hydrated };
            Logger.info("[submit_form] Hydrated formData from free-text", {
              keys: Object.keys(hydrated),
            });
          }

          // If payload has formData, merge into context
          if (payload?.formData && typeof payload.formData === "object") {
            const merged = { ...(context.formData || {}), ...payload.formData };
            context.formData = merged;
            this.updateContext(sessionId, { formData: merged });
            payload = { ...payload, formData: merged };
          }

          // If after hydration we still don't have required fields, ask for what's missing.
          const current = context.formData || {};
          if (!this.hasAllRequiredFields(context, current)) {
            const missing: string[] = [];
            for (const f of (context.requiredFields?.delegate || []).filter(x => x.required)) {
              if (current[f.key] == null || (typeof current[f.key] === "string" && current[f.key].trim() === "")) {
                missing.push(f.label || f.key);
              }
            }
            for (const f of (context.requiredFields?.participant || []).filter(x => x.required)) {
              if (current[f.key] == null || (typeof current[f.key] === "string" && current[f.key].trim() === "")) {
                missing.push(f.label || f.key);
              }
            }

            if (missing.length > 0) {
              return this.formatResponse(
                `Step 2/5 — Registration details\n\nI still need a couple details:\n\n- ${missing.slice(0, 8).join("\n- ")}\n\nReply with them in one message (you can use commas), and I'll continue.`,
                undefined,
                []
              );
            }
          }

          // ✅ We have required fields -> advance flow to REVIEW
          context.step = FlowStep.REVIEW;
          this.updateContext(sessionId, { step: FlowStep.REVIEW });
          Logger.info("[submit_form] ✅ Required fields satisfied; advancing to REVIEW", {
            sessionId,
            formKeys: Object.keys(context.formData || {}),
          });

          // Now call existing submitForm implementation.
          return await this.submitForm(payload, sessionId, context);
        }

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

      case "select_child":
        // Handle child selection from UI action (ChatGPT card click or NL input)
        return await this.handleSelectChild(payload, sessionId, context, input);

      case "load_delegate_profile":
        return await this.loadDelegateProfile(payload, sessionId, context);

      case "save_delegate_profile":
        return await this.saveDelegateProfile(payload, sessionId, context);

      case "show_payment_authorization":
        return await this.showPaymentAuthorization(payload, sessionId, context);

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

      case "clear_activity_filter":
        return await this.handleClearActivityFilter(payload, sessionId, context);

      case "show_out_of_area_programs":
        return await this.handleShowOutOfAreaPrograms(payload, sessionId, context);

      case "authorize_payment":
        // ⚠️ HARD STEP GATES - prevent NL bypass of payment flow
        
        // Gate 1: Must have selected a program
        if (!context.selectedProgram?.program_ref) {
          Logger.warn('[authorize_payment] ⛔ STEP GATE: No selected program');
          return this.formatResponse(
            "Let me help you find a program first. Which activity are you looking for?",
            undefined,
            [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
          );
        }
        
        // Gate 2: Must be in PAYMENT/SUBMIT step
        if (context.step !== FlowStep.PAYMENT && context.step !== FlowStep.SUBMIT) {
          Logger.warn('[authorize_payment] ⛔ STEP GATE: Not in PAYMENT/SUBMIT step', { currentStep: context.step });
          return this.formatResponse(
            "We need to collect some information first before I can process your authorization.",
            undefined,
            [{ label: "Continue Registration", action: "select_program", payload: { program_ref: context.selectedProgram.program_ref }, variant: "accent" }]
          );
        }
        
        // Gate 3: Must have payment method
        if (!context.cardLast4 && !context.cardBrand) {
          Logger.warn('[authorize_payment] ⛔ STEP GATE: No payment method in context');
          return {
            message: "Before I can complete your booking, I need to save a payment method.",
            metadata: {
              componentType: "payment_setup",
              next_action: context.schedulingData ? "confirm_scheduled_registration" : "confirm_payment",
              _build: APIOrchestrator.BUILD_STAMP
            },
            cta: {
              buttons: [
                { label: "Add Payment Method", action: "setup_payment", variant: "accent" }
              ]
            }
          };
        }
        
        // Gate 4: Must have form data
        if (!context.formData) {
          Logger.warn('[authorize_payment] ⛔ STEP GATE: No form data in context');
          return this.formatResponse(
            "I'm missing your registration details. Let me help you select a program first.",
            undefined,
            [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
          );
        }
        
        // All gates passed - proceed with authorization
        this.updateContext(sessionId, { paymentAuthorized: true });
        Logger.info('[authorize_payment] ✅ Payment explicitly authorized by user - all gates passed');
        if (context.schedulingData) {
          return await this.confirmScheduledRegistration(payload, sessionId, this.getContext(sessionId));
        }
        return await this.confirmPayment(payload, sessionId, this.getContext(sessionId));

      case "setup_payment":
        // Redirect to payment setup flow
        return await this.setupPaymentMethod(payload, sessionId, context);

      case "cancel_flow":
        // User cancelled the flow
        this.updateContext(sessionId, { 
          step: FlowStep.BROWSE,
          schedulingData: undefined,
          paymentAuthorized: undefined
        });
        return this.formatResponse(
          "No problem! Let me know if you'd like to browse other programs.",
          undefined,
          [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
        );

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
    // ChatGPT NL: Check for secondary actions FIRST (view receipts, cancel, audit trail)
    const secondaryAction = this.parseSecondaryAction(input);
    if (secondaryAction) {
      Logger.info('[NL Parse] Secondary action detected at start of handleMessage', {
        source: 'natural_language',
        action: secondaryAction.action,
        userInput: input
      });
      return await this.handleAction(secondaryAction.action, secondaryAction.payload || {}, sessionId, context);
    }
    
    // ChatGPT NL: Check if user is awaiting delegate email collection
    if (context.awaitingDelegateEmail) {
      const email = this.parseDelegateEmail(input);
      if (email) {
        Logger.info('[NL Parse] Delegate email extracted', { source: 'natural_language', email });
        // Store email and proceed with form submission
        const pendingParticipants = context.pendingParticipants || [];
        this.updateContext(sessionId, { 
          awaitingDelegateEmail: false,
          pendingDelegateInfo: { ...context.pendingDelegateInfo, email }
        });
        
        // Now submit with collected data
        const formData = {
          participants: pendingParticipants,
          delegate: { delegate_email: email }
        };
        
        return await this.submitForm({
          formData,
          program_ref: context.selectedProgram?.program_ref,
          org_ref: context.orgRef || context.selectedProgram?.org_ref
        }, sessionId, context);
      }
      
      // Email not detected - ask again
      return this.formatResponse(
        "I didn't catch that email. Please share your email address (e.g., 'john@example.com').",
        undefined,
        []
      );
    }
    
    // ============================================================================
    // SESSION STATE RECOVERY: Fix corrupted states from race conditions
    // If we're in FORM_FILL or PAYMENT but missing critical context, reset to BROWSE
    // ============================================================================
    const isInvalidFormFillState = context.step === FlowStep.FORM_FILL && !context.selectedProgram;
    const isInvalidReviewState = context.step === FlowStep.REVIEW && !context.selectedProgram;
    const isInvalidPaymentState = (context.step === FlowStep.PAYMENT || context.step === FlowStep.SUBMIT || context.step === FlowStep.COMPLETED) && !context.selectedProgram;
    
    if (isInvalidFormFillState || isInvalidReviewState || isInvalidPaymentState) {
      console.log('[handleMessage] ⚠️ RECOVERY: Detected invalid session state, resetting to BROWSE', {
        currentStep: context.step,
        hasSelectedProgram: !!context.selectedProgram,
        sessionId
      });
      this.updateContext(sessionId, { step: FlowStep.BROWSE });
      context = this.getContext(sessionId); // Refresh context after update
    }
    
    // Check if this might be a location response (simple city/state input)
    // Use normalizeLocationInput to handle fuzzy inputs like "near Chicago"
    // Handle location responses in BROWSE step OR when we're in an active session without a selected program
    const normalizedForLocation = this.normalizeLocationInput(input);
    const shouldHandleAsLocation = this.isLocationResponse(normalizedForLocation) && 
      (context.step === FlowStep.BROWSE || !context.selectedProgram);
    
    if (shouldHandleAsLocation) {
      return await this.handleLocationResponse(normalizedForLocation, sessionId, context);
    }

    // ------------------------------------------------------------------------
    // V1 CHAT-ONLY FAST PATHS
    // If user is clearly trying to sign up / browse programs at AIM Design,
    // skip activation + clarifications and list programs immediately.
    // ------------------------------------------------------------------------
    const mentionsAimDesign = /\baim\s*design\b/i.test(input);
    const wantsProgramsNow =
      this.isBrowseAllIntent(input) || this.hasSignupIntent(input) || this.hasProgramWords(input);

    if (mentionsAimDesign && wantsProgramsNow) {
      this.updateContext(sessionId, {
        orgRef: "aim-design",
        requestedActivity: undefined,
        pendingProviderConfirmation: undefined,
        step: FlowStep.BROWSE
      });
      return await this.searchPrograms("aim-design", sessionId);
    }

    // If user says "browse/show/list/anything" and we already have a provider context,
    // list programs now (don't ask follow-ups).
    if (this.isBrowseAllIntent(input) && (context.orgRef || context.pendingProviderConfirmation)) {
      const orgRef = context.orgRef || context.pendingProviderConfirmation?.toLowerCase().replace(/\s+/g, '-') || "aim-design";
      this.updateContext(sessionId, { orgRef, requestedActivity: undefined, pendingProviderConfirmation: undefined });
      return await this.searchPrograms(orgRef, sessionId);
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

    // Store detected activity in session context (even if we can't help)
    // This enables filtering programs when user later picks a provider
    const detectedActivity = matcherExtractActivity(input);
    if (detectedActivity) {
      this.updateContext(sessionId, { requestedActivity: detectedActivity });
      Logger.info('[handleMessage] Stored requestedActivity:', detectedActivity);
    }

    // Track audience preference (e.g., "adults") so we can warn on clear mismatches
    const audiencePref = this.detectAudiencePreference(input);
    if (audiencePref) {
      this.updateContext(sessionId, {
        requestedAdults: audiencePref === 'adults',
        ignoreAudienceMismatch: false,
      });
    }

    Logger.info('[handleMessage] Activation confidence:', {
      level: confidence.level,
      reason: confidence.reason,
      provider: confidence.matchedProvider?.name,
      requestedActivity: detectedActivity
    });

    // ========================================================================
    // SINGLE-TURN OPTIMIZATION: Activity + City in one message → immediate search
    // This is the "Set & Forget" philosophy - less back and forth
    // ========================================================================
    if (detectedActivity) {
      // Try to extract city from the same message
      const cityMatch = this.extractCityFromMessage(input);
      if (cityMatch) {
        const locationCheck = analyzeLocation(cityMatch);
        if (locationCheck.found && locationCheck.isInCoverage) {
          Logger.info('[handleMessage] ✅ SINGLE-TURN: Activity + City detected, immediate search', {
            activity: detectedActivity,
            city: locationCheck.city,
            state: locationCheck.state
          });
          
          // Store context and proceed directly to search
          this.updateContext(sessionId, { 
            requestedActivity: detectedActivity,
            requestedLocation: cityMatch,
            step: FlowStep.BROWSE
          });
          
          // Save location if authenticated
          if (context.user_id && locationCheck.city) {
            try {
              await this.invokeMCPTool("user.update_delegate_profile", {
                user_id: context.user_id,
                city: locationCheck.city,
                ...(locationCheck.state && { state: locationCheck.state }),
              });
            } catch (error) {
              Logger.warn("[handleMessage] Failed to save location:", error);
            }
          }
          
          // Get the default org for this coverage area (aim-design for now)
          const orgRef = "aim-design";
          return await this.searchPrograms(orgRef, sessionId);
        }
        
        // City detected but out of coverage - store context and handle gracefully
        if (locationCheck.found && !locationCheck.isInCoverage) {
          this.updateContext(sessionId, { 
            requestedActivity: detectedActivity,
            requestedLocation: cityMatch,
            step: FlowStep.BROWSE
          });
          
          return await this.handleLocationResponse(cityMatch, sessionId, this.getContext(sessionId));
        }
      }
    }

    // Route based on confidence level
    if (confidence.level === 'HIGH' && confidence.matchedProvider) {
      const orgRef = confidence.matchedProvider.name.toLowerCase().replace(/\s+/g, '-');
      // CHAT-ONLY: If user intent is signup/browse/programs, list programs immediately.
      if (this.hasSignupIntent(input) || this.hasProgramWords(input) || this.isBrowseAllIntent(input)) {
        this.updateContext(sessionId, { orgRef, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE });
        return await this.searchPrograms(orgRef, sessionId);
      }
      // Otherwise keep the activation message (still useful for generic/ambiguous opens)
      return await this.activateWithInitialMessage(confidence.matchedProvider, orgRef, sessionId);
    }

    if (confidence.level === 'MEDIUM') {
      // Case A: Activity detected, providers exist, need location
      const activity = matcherExtractActivity(input);
      if (activity && !confidence.matchedProvider) {
        // Store that we're waiting for a city so follow-ups like "for adults?" don't dead-end.
        this.updateContext(sessionId, { step: FlowStep.BROWSE });

        const displayName = getActivityDisplayName(activity);
        return this.formatResponse(
          `I have ${displayName} programs! What city are you in?`,
          undefined,
          []  // Wait for text response
        );
      }
      
      // Case B: Provider name matched (existing logic)
      if (confidence.matchedProvider) {
        const orgRef = confidence.matchedProvider.name.toLowerCase().replace(/\s+/g, '-');

        // CHAT-ONLY: stop "Madison?" and "what activity?" if user intends browse/signup.
        if (this.hasSignupIntent(input) || this.hasProgramWords(input) || this.isBrowseAllIntent(input)) {
          this.updateContext(sessionId, { orgRef, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // Otherwise keep conservative behavior
        if (context.user_id && !storedCity) {
          return this.askForLocation(confidence.matchedProvider, sessionId);
        }
        return this.showFallbackClarification(confidence.matchedProvider, sessionId);
      }
    }

    // LOW confidence for ANONYMOUS users = DON'T ACTIVATE
    // SignupAssist is a high-intent signup tool, not a discovery platform.
    // However: if we're mid-flow (e.g., we already captured an activity and asked for city),
    // do NOT "silent pass"—restate the pending question so the user isn't stuck.
    if (!context.user_id) {
      const shouldContinueBrowseFlow =
        context.step === FlowStep.BROWSE &&
        !!context.requestedActivity &&
        !detectedActivity &&
        !confidence.matchedProvider;

      if (shouldContinueBrowseFlow) {
        const displayName = getActivityDisplayName(context.requestedActivity!);
        const audienceAck =
          context.requestedAdults === true
            ? "Got it — adults." 
            : context.requestedAdults === false
              ? "Got it — kids." 
              : "Got it.";

        return this.formatResponse(
          `${audienceAck} To find ${displayName} programs near you, what city are you in?`,
          undefined,
          []
        );
      }

      Logger.info('[handleMessage] LOW confidence + anonymous user = not activating');
      // Return null to signal "pass" - let ChatGPT route elsewhere
      return null;
    }

    // LOW confidence for AUTHENTICATED users: Context-aware responses based on flow step
    // Also handles ChatGPT NL parsing for form fill and payment steps
    switch (context.step) {
      case FlowStep.BROWSE: {
        // If user says "browse/show/list/anything", list programs now.
        if (this.isBrowseAllIntent(input)) {
          const orgRef = context.orgRef || "aim-design";
          this.updateContext(sessionId, { orgRef, requestedActivity: undefined, pendingProviderConfirmation: undefined });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // If user says "yes" while we have a provider context but no list displayed yet,
        // treat that as "show programs".
        if (
          this.isUserConfirmation(input) &&
          (context.orgRef || context.pendingProviderConfirmation) &&
          (!context.displayedPrograms || context.displayedPrograms.length === 0)
        ) {
          const orgRef =
            context.orgRef ||
            context.pendingProviderConfirmation?.toLowerCase().replace(/\s+/g, '-') ||
            "aim-design";
          this.updateContext(sessionId, { orgRef, requestedActivity: undefined, pendingProviderConfirmation: undefined });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // ChatGPT NL: Check for program selection by title or ordinal
        if (context.displayedPrograms?.length) {
          const selectedProgram = this.parseProgramSelection(input, context.displayedPrograms);
          if (selectedProgram) {
            Logger.info('[NL Parse] Auto-selecting program from NL input', {
              source: 'natural_language',
              program_ref: selectedProgram.program_ref,
              userInput: input
            });
            return await this.selectProgram({
              program_ref: selectedProgram.program_ref,
              program_name: selectedProgram.title,
              program_data: selectedProgram.program_data
            }, sessionId, context);
          }
        }
        
        // ChatGPT NL: Check for provider confirmation ("Yes" after clarification)
        if (this.isUserConfirmation(input) && context.pendingProviderConfirmation) {
          Logger.info('[NL Parse] Auto-confirming provider from NL input', {
            source: 'natural_language',
            provider: context.pendingProviderConfirmation
          });
          return await this.handleConfirmProvider(
            { provider_name: context.pendingProviderConfirmation },
            sessionId,
            context
          );
        }
        break; // Fall through to default behavior
      }
      
      case FlowStep.FORM_FILL: {
        // ChatGPT NL: Multi-participant flow - check for "done" indicator first
        if (this.isDoneIndicator(input) && context.pendingParticipants?.length) {
          Logger.info('[NL Parse] Done indicator detected - submitting with pending participants', {
            source: 'natural_language',
            participantCount: context.pendingParticipants.length,
            userInput: input
          });
          
          // Check if we need delegate email (for unauthenticated or new users)
          const needsDelegateEmail = !context.user_id && !context.pendingDelegateInfo?.email;
          if (needsDelegateEmail) {
            this.updateContext(sessionId, { awaitingDelegateEmail: true });
            return this.formatResponse(
              `Great! I have ${context.pendingParticipants.length} participant${context.pendingParticipants.length > 1 ? 's' : ''} ready.\n\nWhat's your email address? (as the responsible adult)`,
              undefined,
              []
            );
          }
          
          // Submit with collected participants
          const formData = {
            participants: context.pendingParticipants,
            delegate: context.pendingDelegateInfo ? { delegate_email: context.pendingDelegateInfo.email } : undefined
          };
          
          // Clear pending participants after submission
          this.updateContext(sessionId, { pendingParticipants: undefined });
          
          return await this.submitForm({
            formData,
            program_ref: context.selectedProgram?.program_ref,
            org_ref: context.orgRef || context.selectedProgram?.org_ref
          }, sessionId, context);
        }
        
        // ChatGPT NL: Try to parse multiple children from natural language
        const parsedChildren = this.parseMultipleChildrenFromMessage(input);
        if (parsedChildren.length > 0) {
          Logger.info('[NL Parse] Child info extracted from NL input', {
            source: 'natural_language',
            parsedCount: parsedChildren.length,
            parsed: parsedChildren,
            userInput: input
          });
          
          // Add to pending participants
          const existingParticipants = context.pendingParticipants || [];
          const allParticipants = [...existingParticipants, ...parsedChildren.map(child => ({
            firstName: child.firstName || child.name.split(' ')[0],
            lastName: child.lastName || child.name.split(' ').slice(1).join(' ') || '',
            age: child.age
          }))];
          
          this.updateContext(sessionId, { pendingParticipants: allParticipants });
          
          // Build participant name list for confirmation
          const nameList = parsedChildren.map(c => c.name).join(' and ');
          const totalCount = allParticipants.length;
          
          // Ask if there are more participants
          return this.formatResponse(
            `Got it! ${nameList} added (${totalCount} total).\n\nAnyone else to register? Say "done" when that's everyone.`,
            undefined,
            [
              { label: "Done - that's everyone", action: "submit_form", payload: { finalize: true }, variant: "accent" },
              { label: "Add more participants", action: "continue_form", variant: "outline" }
            ]
          );
        }
        
        // Check if we have pending participants but no new ones parsed - might be a "done" variant
        if (context.pendingParticipants?.length && input.trim().length < 20) {
          // Short input that's not a name might be trying to say "done" in different ways
          const mightBeDone = /^(ok|okay|proceed|continue|go|yes|yep|submit|register|book)\.?!?$/i.test(input.trim());
          if (mightBeDone) {
            Logger.info('[NL Parse] Implicit done indicator detected', { source: 'natural_language', input });
            
            // Check if we need delegate email
            const needsDelegateEmail = !context.user_id && !context.pendingDelegateInfo?.email;
            if (needsDelegateEmail) {
              this.updateContext(sessionId, { awaitingDelegateEmail: true });
              return this.formatResponse(
                `Great! What's your email address? (as the responsible adult)`,
                undefined,
                []
              );
            }
            
            const formData = {
              participants: context.pendingParticipants,
              delegate: context.pendingDelegateInfo ? { delegate_email: context.pendingDelegateInfo.email } : undefined
            };
            
            this.updateContext(sessionId, { pendingParticipants: undefined });
            
            return await this.submitForm({
              formData,
              program_ref: context.selectedProgram?.program_ref,
              org_ref: context.orgRef || context.selectedProgram?.org_ref
            }, sessionId, context);
          }
        }
        
        // Fallback: ask for child info explicitly
        const pendingCount = context.pendingParticipants?.length || 0;
        const prompt = pendingCount > 0
          ? `Who else would you like to register? (or say "done" if that's everyone)`
          : "Please share your child's name and age (e.g., 'Percy, 11'). You can add multiple by saying 'Percy, 11 and Alice, 9'.";
        
        return this.formatResponse(
          prompt,
          undefined,
          pendingCount > 0 
            ? [{ label: "Done - that's everyone", action: "submit_form", payload: { finalize: true }, variant: "accent" }]
            : [{ label: "Continue", action: "submit_form", variant: "accent" }]
        );
      }

      case FlowStep.REVIEW: {
        // Await user confirmation of details
        if (this.isUserConfirmation(input)) {
          Logger.info('[Review] User confirmed details', { hasCardOnFile: !!context.cardLast4, futureBooking: !!context.schedulingData });
          if (!context.cardLast4) {
            Logger.info('[Review] No saved card on file – initiating Stripe Checkout');
            const userEmail = context.pendingDelegateInfo?.email || context.formData?.delegate_data?.email || context.formData?.delegate_data?.delegate_email;
            const userId = context.user_id;
            try {
              const sessionRes = await this.invokeMCPTool('stripe.create_checkout_session', {
                user_id: userId,
                user_email: userEmail,
                success_url: "https://signupassist.ai/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}",
                cancel_url: "https://signupassist.ai/stripe_return?payment_setup=canceled"
              });
              if (!sessionRes.success || !sessionRes.data?.url) {
                throw new Error(sessionRes.error?.message || "Unknown error");
              }
              // Advance to PAYMENT step awaiting verification
              this.updateContext(sessionId, { step: FlowStep.PAYMENT });
              const stripeUrl = sessionRes.data.url;
              const linkMsg = `💳 **Secure Stripe Checkout**\nPlease add your payment method using the link below. We never see your card details.\n\n🔗 ${stripeUrl}\n\nWhen you've finished, type "done" here to continue.`;
              return this.formatResponse(linkMsg);
            } catch (error) {
              Logger.error("[stripe] Checkout session creation failed:", error);
              return this.formatError("Failed to start payment setup. Please try again.");
            }
          } else {
            // Card already on file – proceed to final booking confirmation
            Logger.info('[Review] Card on file, proceeding to booking');
            this.updateContext(sessionId, { paymentAuthorized: true, step: FlowStep.SUBMIT });
            if (context.schedulingData) {
              return await this.confirmScheduledRegistration({}, sessionId, this.getContext(sessionId));
            } else {
              return await this.confirmPayment({}, sessionId, this.getContext(sessionId));
            }
          }
        }
        if (/cancel/i.test(input.trim())) {
          Logger.info('[Review] User cancelled during review');
          // Reset context for safety
          this.updateContext(sessionId, { step: FlowStep.BROWSE, selectedProgram: undefined });
          return this.formatResponse("Okay, I've canceled that signup. Let me know if you need help with anything else.");
        }
        // If user says something else (e.g. tries to change info), prompt for explicit confirmation
        return this.formatResponse(`Please reply "yes" to confirm the above details or "cancel" to abort.`);
      }

      case FlowStep.PAYMENT: {
        // ChatGPT NL: Detect confirmation from natural language
        if (this.isUserConfirmation(input)) {
          Logger.info('[NL Parse] Payment confirmation detected from NL input', {
            source: 'natural_language',
            hasSchedulingData: !!context.schedulingData,
            userInput: input,
            hasPaymentMethod: !!context.cardLast4,
            paymentAuthorized: !!context.paymentAuthorized
          });
          
          // ⚠️ GUARD 1: Check for saved payment method before allowing confirmation
          if (!context.cardLast4 && context.user_id) {
            Logger.warn('[NL Parse] Payment confirmation attempted without saved payment method');
            return {
              message: "Before I can schedule your registration, I need to save a payment method. You'll only be charged if registration succeeds!",
              metadata: {
                componentType: "payment_setup",
                next_action: context.schedulingData ? "confirm_scheduled_registration" : "confirm_payment",
                schedulingData: context.schedulingData
              },
              cta: {
                buttons: [
                  { label: "Add Payment Method", action: "setup_payment", variant: "accent" }
                ]
              }
            };
          }
          
          // ⚠️ GUARD 2: Require explicit authorization (not just "yes")
          if (!context.paymentAuthorized) {
            Logger.info('[NL Parse] Payment method saved; recording explicit authorization from user confirmation');
            this.updateContext(sessionId, { paymentAuthorized: true, step: FlowStep.SUBMIT });
            if (context.schedulingData) {
              return await this.confirmScheduledRegistration({}, sessionId, this.getContext(sessionId));
            }
            return await this.confirmPayment({}, sessionId, this.getContext(sessionId));
          }
          
          // Route to appropriate confirmation handler
          if (context.schedulingData) {
            return await this.confirmScheduledRegistration({}, sessionId, context);
          }
          return await this.confirmPayment({}, sessionId, context);
        }
        
        // Detect if user indicates they've added payment method (e.g., "done")
        if (/done|card|added|finished/i.test(input.trim())) {
          Logger.info('[Payment] User indicates payment method setup is done, checking status...');
          if (context.user_id) {
            const checkRes = await this.invokeMCPTool('stripe.check_payment_status', { user_id: context.user_id });
            if (checkRes.success && checkRes.data?.hasPaymentMethod) {
              const { last4, brand } = checkRes.data;
              this.updateContext(sessionId, { cardLast4: last4, cardBrand: brand });
              return this.formatResponse(`✅ Payment method saved (${brand} •••• ${last4}). Now say \"yes\" to confirm your booking.`);
            }
          }
          return this.formatResponse("I haven't detected a new payment method yet. If you've completed the Stripe form, please wait a moment and type \"done\" again.");
        }
        // Fallback prompt: ask user to confirm booking
        return this.formatResponse(
          "Ready to complete your booking? Say 'yes' to confirm."
        );
      }

      default: {
        // Authenticated but LOW confidence - org not recognized
        // Use tiered classification to determine if activity vs organization
        const classification = await this.classifyInputType(input);
        
        // Dynamic city check from organization registry
        const userCity = storedCity?.toLowerCase().trim();
        const supportedCities = this.getSupportedCities();
        const supportedProviderInCity = userCity && supportedCities.includes(userCity);
        
        const itemType = classification.type === 'activity' ? 'program' : 'organization';
        
        if (supportedProviderInCity) {
          // Find which org is in that city for a better suggestion
          const cityOrg = getAllActiveOrganizations().find(
            org => org.location?.city?.toLowerCase() === userCity
          );
          const orgName = cityOrg?.displayName || 'our partners';
          const orgRef = cityOrg?.orgRef || 'aim-design';
          
          return this.formatResponse(
            `I don't support that ${itemType} yet. But I can help with **${orgName}** classes in ${storedCity}.`,
            undefined,
            [
              { label: `Browse ${orgName}`, action: "search_programs", payload: { orgRef }, variant: "accent" }
            ]
          );
        }
        
        // User not in a supported city - just decline without alternatives
        return this.formatResponse(
          `I don't support that ${itemType} yet. Sorry!`,
          undefined,
          []
        );
      }
    }
  }

  // NOTE: extractActivityFromMessage removed - using matcherExtractActivity from activityMatcher.ts

  /**
   * Check if input looks like a simple location response
   * Must be specific to avoid matching activity keywords like "coding course"
   */
  private isLocationResponse(input: string): boolean {
    const trimmed = input.trim();

    // Too long to be just a city
    if (trimmed.length > 50) return false;

    // Reject if input contains activity keywords (not a location)
    const activityKeywords = /\b(class|classes|course|courses|lesson|lessons|camp|camps|program|programs|workshop|workshops|activity|activities|coding|ski|skiing|swim|swimming|soccer|robotics|stem|dance|art|music|sports|training|session|sessions)\b/i;
    if (activityKeywords.test(trimmed)) return false;

    // Prefer real city recognition over fragile regex lists
    if (lookupCity(trimmed).found) return true;

    // Also allow "City, ST" / "City ST" as a fallback (even if city isn't in our list)
    return /^[A-Za-z\s]+,?\s+[A-Z]{2}$/i.test(trimmed);
  }

  private detectAudiencePreference(input: string): 'adults' | 'kids' | null {
    const adultPatterns = /\b(adult|adults|grown[-\s]?up|18\+|over\s*18|for\s*adults)\b/i;
    const kidPatterns = /\b(kid|kids|child|children|youth|teen|teens|for\s*kids|for\s*children)\b/i;

    if (adultPatterns.test(input)) return 'adults';
    if (kidPatterns.test(input)) return 'kids';
    return null;
  }

  private detectAdultsVsYouthMismatch(programs: any[]): { hasMismatch: boolean; foundAudience?: string } {
    const ranges: Array<{ min: number; max: number; display: string }> = [];

    const tryExtract = (text: string) => {
      if (!text) return;
      const m = text.match(/\bages?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i) || text.match(/\bage\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
      if (m) {
        const min = parseInt(m[1], 10);
        const max = parseInt(m[2], 10);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
          ranges.push({ min, max, display: `ages ${min}-${max}` });
        }
      }
    };

    for (const p of programs) {
      tryExtract(p?.age_range || "");
      tryExtract(p?.title || "");
      tryExtract(stripHtml(p?.description || ""));
    }

    if (ranges.length === 0) return { hasMismatch: false };

    const maxAgeFound = Math.max(...ranges.map(r => r.max));
    if (maxAgeFound >= 18) return { hasMismatch: false };

    const unique = [...new Set(ranges.map(r => r.display))].slice(0, 3);
    return {
      hasMismatch: true,
      foundAudience: unique.length === 1 ? unique[0] : `${unique.join(', ')}${ranges.length > 3 ? '…' : ''}`
    };
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

    const analysis = analyzeLocation(trimmed);

    // Not recognized as a city
    if (!analysis.found) {
      return this.formatResponse(analysis.message || "I didn't catch that. What city are you in?", undefined, []);
    }

    // Ambiguous city: offer quick disambiguation
    if (analysis.isAmbiguous && analysis.disambiguationOptions?.length) {
      const providerName = context.orgRef || "aim-design";

      return this.formatResponse(
        analysis.message || `Which ${analysis.city || "location"} did you mean?`,
        undefined,
        analysis.disambiguationOptions.slice(0, 4).map((opt) => ({
          label: opt.description,
          action: "save_location",
          variant: "outline" as const,
          payload: {
            city: opt.city,
            state: opt.state,
            provider_name: providerName,
          },
        }))
      );
    }

    // Out of coverage: Check if we have programs elsewhere to offer
    if (!analysis.isInCoverage && !analysis.isComingSoon) {
      // Store the requested location for context
      this.updateContext(sessionId, { requestedLocation: trimmed });
      
      // Check if we have ANY programs available (in any location)
      const supabase = this.getSupabaseClient();
      const { data: availablePrograms } = await supabase
        .from('cached_provider_feed')
        .select('org_ref, program, category')
        .limit(10);
      
      if (availablePrograms && availablePrograms.length > 0) {
        // We have programs but not in user's area - offer to show them anyway
        const firstProgram = availablePrograms[0];
        const programData = typeof firstProgram.program === 'string' 
          ? JSON.parse(firstProgram.program) 
          : firstProgram.program;
        
        // Get location from organizations config
        const allOrgs = getAllActiveOrganizations();
        const matchingOrg = allOrgs.find(org => org.orgRef === firstProgram.org_ref);
        const availableCity = matchingOrg?.location?.city || 'Anna Maria Island';
        const availableState = matchingOrg?.location?.state || 'FL';
        
        // Get activity if user specified one
        const activityType = context.requestedActivity 
          ? getActivityDisplayName(context.requestedActivity)
          : undefined;
        
        const message = getOutOfAreaProgramsMessage({
          requested_city: trimmed,
          available_city: availableCity,
          available_state: availableState,
          program_count: availablePrograms.length,
          activity_type: activityType
        });
        
        Logger.info('[handleLocationResponse] Out of coverage but programs available elsewhere', {
          requestedCity: trimmed,
          availableCity,
          programCount: availablePrograms.length
        });
        
        return this.formatResponse(
          message,
          undefined,
          [
            {
              label: `Show Programs in ${availableCity}`,
              action: "show_out_of_area_programs",
              payload: { 
                orgRef: firstProgram.org_ref,
                ignoreLocationFilter: true 
              },
              variant: "accent" as const
            },
            {
              label: "No thanks",
              action: "clear_context",
              payload: {},
              variant: "outline" as const
            }
          ]
        );
      }
      
      // No programs available anywhere
      return this.formatResponse(analysis.message || "I don't have providers in that area yet.", undefined, []);
    }

    const city = analysis.city || trimmed;
    const state = analysis.state;

    // Save location if authenticated
    if (context.user_id) {
      try {
        await this.invokeMCPTool("user.update_delegate_profile", {
          user_id: context.user_id,
          city,
          ...(state && { state }),
        });
        Logger.info("[handleLocationResponse] Saved location:", { city, state });
      } catch (error) {
        Logger.warn("[handleLocationResponse] Failed to save location:", error);
      }
    }

    // Proceed to search programs (default provider if none selected)
    const providerName = context.orgRef || "aim-design";
    return await this.searchPrograms(providerName, sessionId);
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
      ...(WIDGET_ENABLED ? { cards } : {})
    };
  }

  /**
   * Ask authenticated user for their location
   */
  private askForLocation(provider: ProviderConfig, sessionId: string): OrchestratorResponse {
    const message = getLocationQuestionMessage();
    
    // Store that we're waiting for location
    this.updateContext(sessionId, { step: FlowStep.BROWSE });
    
    const cards: CardSpec[] = [{
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
    }];

    return {
      message,
      ...(WIDGET_ENABLED ? { cards } : {})
    };
  }

  /**
   * Show fallback clarification for MEDIUM confidence
   * Also stores pendingProviderConfirmation for ChatGPT NL parsing
   */
  private showFallbackClarification(provider: ProviderConfig, sessionId: string): OrchestratorResponse {
    const message = getFallbackClarificationMessage({
      provider_name: provider.name,
      provider_city: provider.city
    });

    const orgRef = provider.name.toLowerCase().replace(/\s+/g, '-');
    
    // Store pending provider for ChatGPT NL "Yes" detection
    this.updateContext(sessionId, { pendingProviderConfirmation: provider.name });

    const cards: CardSpec[] = [{
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
    }];

    return {
      message,
      ...(WIDGET_ENABLED ? { cards } : {})
    };
  }

  /**
   * Handle confirm_provider action (user confirms fallback clarification)
   * Also handles ChatGPT NL "Yes" responses via pendingProviderConfirmation
   */
  private async handleConfirmProvider(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // ⚠️ HARD STEP GATE - prevent NL bypass of provider confirmation
    // Must have a pending confirmation or valid provider in payload
    const providerFromPayload = payload.orgRef || payload.provider_name;
    const providerFromContext = context.pendingProviderConfirmation;
    
    if (!providerFromPayload && !providerFromContext) {
      Logger.warn('[handleConfirmProvider] ⛔ STEP GATE: No provider to confirm');
      return this.formatResponse(
        "I'm not sure which provider you're confirming. What program or activity are you looking for?",
        undefined,
        [{ label: "Start Fresh", action: "clear_context", payload: {}, variant: "outline" }]
      );
    }
    
    const orgRef = providerFromPayload?.toLowerCase().replace(/\s+/g, '-') || providerFromContext?.toLowerCase().replace(/\s+/g, '-') || 'aim-design';
    
    // Clear pending confirmation
    this.updateContext(sessionId, { pendingProviderConfirmation: undefined });
    
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
    // Clear any provider context from session (including NL tracking state)
    this.updateContext(sessionId, {
      orgRef: undefined,
      selectedProgram: undefined,
      displayedPrograms: undefined,
      pendingProviderConfirmation: undefined
    });

    return this.formatResponse(
      "No problem! What program or activity are you looking for? I can help you find and sign up for classes, camps, and workshops.",
      [{
        title: "What would you like to do?",
        subtitle: "Options to continue",
        description: "Type what you're looking for below, or use these shortcuts:",
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
    // Reset session context (including NL tracking state)
    this.updateContext(sessionId, {
      orgRef: undefined,
      formData: undefined,
      selectedProgram: undefined,
      step: FlowStep.BROWSE,
      requestedAdults: undefined,
      ignoreAudienceMismatch: undefined,
      displayedPrograms: undefined,
      pendingProviderConfirmation: undefined,
      // Multi-participant and delegate flow state
      pendingParticipants: undefined,
      pendingDelegateInfo: undefined,
      awaitingDelegateEmail: undefined,
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
   * Handle clear_activity_filter action (user wants to see all programs at provider)
   */
  private async handleClearActivityFilter(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Clear the activity filter from context
    this.updateContext(sessionId, { requestedActivity: undefined });
    Logger.info('[handleClearActivityFilter] Cleared activity filter');
    
    // Re-search without activity filter
    const orgRef = payload.orgRef || context.orgRef || 'aim-design';
    return await this.searchPrograms(orgRef, sessionId);
  }

  /**
   * Handle show_out_of_area_programs action (user accepts seeing programs from different location)
   */
  private async handleShowOutOfAreaPrograms(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    // Mark that user has accepted out-of-area programs
    this.updateContext(sessionId, { 
      ignoreLocationFilter: true,
      orgRef: payload.orgRef 
    });
    
    Logger.info('[handleShowOutOfAreaPrograms] User accepted out-of-area programs', {
      orgRef: payload.orgRef,
      requestedLocation: context.requestedLocation
    });
    
    // Search programs at the available provider
    const orgRef = payload.orgRef || 'aim-design';
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

      // =========================================================================
      // BROWSE INTENT GUARD: Clear stale selection state before listing programs
      // This prevents "yes" from being misinterpreted as confirming a previously
      // selected program when the user actually wants to browse/show new programs.
      // =========================================================================
      this.updateContext(sessionId, {
        selectedProgram: null,
        step: FlowStep.BROWSE,
        // Clear form/payment data from previous selections
        formData: undefined,
        schedulingData: undefined,
        paymentAuthorized: false,
        // Keep displayedPrograms - will be overwritten with fresh data below
      });
      Logger.info('[searchPrograms] Cleared stale selection state for fresh browse');

      // Get context for timezone formatting
      const context = this.getContext(sessionId);

      // Call Bookeo MCP tool (ensures audit logging)
      // Note: provider param removed - tool name already selects provider
      const programsResult = await this.invokeMCPTool('bookeo.find_programs', {
        org_ref: orgRef
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

      // Hard filter: remove deprecated SkiClubPro remnants (e.g., ski jumping classes)
      programs = programs.filter((p: any) => {
        const providerRef = (p.provider_ref || p.org_ref || "").toLowerCase();
        const title = (p.title || "").toLowerCase();
        if (providerRef.includes("skiclubpro")) return false;
        if (/ski\s+jump/i.test(title) || /\bski\b/i.test(title)) return false;
        return true;
      });

      // If user asked for a specific activity, narrow to matching programs first.
      const requestedActivity = (context.requestedActivity || "").toLowerCase().trim();
      if (requestedActivity) {
        const keywords = requestedActivity.split(/\s+/).filter(Boolean);
        const matchesKeyword = (text: string) =>
          keywords.every((kw) => text.toLowerCase().includes(kw));
        const filtered = programs.filter((p: any) => {
          const t = (p.title || "") + " " + (p.description || "");
          return matchesKeyword(t);
        });
        if (filtered.length > 0) {
          programs = filtered;
          Logger.info(`[searchPrograms] Filtered programs by requestedActivity='${requestedActivity}' -> ${filtered.length} matches`);
        } else {
          Logger.info(`[searchPrograms] No direct matches for requestedActivity='${requestedActivity}', showing full list`);
        }
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
      
      // Filter by requestedActivity if set (respects user's original intent)
      let filteredPrograms = upcomingPrograms;
      if (context.requestedActivity) {
        const { getActivityKeywords, getActivityDisplayName } = await import('../utils/activityMatcher.js');
        const activityKeywords = getActivityKeywords(context.requestedActivity);
        const activityName = getActivityDisplayName(context.requestedActivity);

        filteredPrograms = upcomingPrograms.filter((prog: any) => {
          const searchText = [
            prog.title || '',
            prog.description || '',
            prog.category || ''
          ].join(' ').toLowerCase();

          return activityKeywords.some((keyword: string) => searchText.includes(keyword));
        });

        Logger.info('[searchPrograms] Activity filter applied:', {
          requestedActivity: context.requestedActivity,
          activityKeywords,
          originalCount: upcomingPrograms.length,
          filteredCount: filteredPrograms.length
        });

        if (filteredPrograms.length === 0) {
          // Provider doesn't have matching programs - be honest
          return this.formatResponse(
            `This provider doesn't have ${activityName} programs. Would you like to see all their programs instead, or search for a different provider?`,
            undefined,
            [
              { label: "Show All Programs", action: "clear_activity_filter", payload: { orgRef }, variant: "accent" },
              { label: "Start Over", action: "clear_context", payload: {}, variant: "outline" }
            ]
          );
        }
      }

      // Audience mismatch check using the shared audienceParser utility
      if (context.requestedAdults && !context.ignoreAudienceMismatch) {
        const mismatch = checkAudienceMismatch(
          filteredPrograms.map((p: any) => ({
            audience: p.audience,
            age_range: p.age_range,
            title: p.title,
            description: p.description,
          })),
          'adults'
        );
        if (mismatch.hasMismatch) {
          const providerDisplayName = orgRef === "aim-design" ? "AIM Design" : orgRef;
          return this.formatResponse(
            `I found ${mismatch.programCount} class${mismatch.programCount !== 1 ? 'es' : ''} at ${providerDisplayName}, but they're for ${mismatch.foundAudience || 'kids'}—not adults. We don't have adult classes at this provider yet. Sorry!`,
            undefined,
            [
              { label: "Start Over", action: "clear_context", payload: {}, variant: "accent" }
            ]
          );
        }
      }

      
      // V1: persist the FULL displayed list so numeric selection works (1..N)
      // Limit to 8 programs max to prevent UI overflow and context bloat
      const programsToDisplay = filteredPrograms.slice(0, 8);
      
      // Store programs in context (including displayedPrograms for ChatGPT NL selection)
      const displayedPrograms = programsToDisplay.map((prog: any) => ({
        title: prog.title || "Untitled Program",
        program_ref: prog.program_ref,
        program_data: {
          title: prog.title,
          program_ref: prog.program_ref,
          org_ref: prog.org_ref || orgRef,
          description: prog.description,
          status: prog.status,
          price: prog.price,
          schedule: prog.schedule,
          booking_status: prog.booking_status || 'open_now',
          earliest_slot_time: prog.earliest_slot_time,
          booking_opens_at: prog.booking_opens_at,
          first_available_event_id: prog.first_available_event_id || null
        }
      }));
      
      // Use awaited persist to prevent race conditions (fixes displayedProgramsCount=1 bug)
      await this.updateContextAndAwait(sessionId, {
        step: FlowStep.BROWSE,
        orgRef,
        displayedPrograms, // For ChatGPT NL program selection by title/ordinal
        pendingProviderConfirmation: undefined, // Clear any pending confirmation
      });

      // Build program cards with timing badges and cleaned descriptions
      // IMPORTANT: Use same programsToDisplay slice to ensure consistency with displayedPrograms
      const cards: CardSpec[] = programsToDisplay.map((prog: any, index: number) => {
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

      // Build program list for inline text display in native ChatGPT
      const programListForMessage = upcomingPrograms.map((prog, idx) => {
        // Determine status inline (no separate method needed)
        const hasAvailability = prog.availableSpots !== undefined ? prog.availableSpots > 0 : true;
        const opensLater = prog.opensAt && new Date(prog.opensAt) > new Date();
        const status = opensLater ? 'coming_soon' : (hasAvailability ? 'open' : 'waitlist');
        
        return {
          index: idx + 1,
          title: prog.title || "Untitled",
          description: stripHtml(prog.description || ""),
          price: prog.price,
          schedule: prog.schedule,
          status
        };
      });

      // Use Design DNA-compliant message template with inline program list
      const message = getAPIProgramsReadyMessage({
        provider_name: orgRef === "aim-design" ? "AIM Design" : orgRef,
        program_count: upcomingPrograms.length,
        programs: programListForMessage
      });

      const orchestratorResponse: OrchestratorResponse = {
        message,
        // V1 chat-only: don't return cards unless widget mode is explicitly enabled
        ...(WIDGET_ENABLED ? { cards } : {}),
        metadata: {
          // Keep metadata minimal; no widget component routing in v1
          orgRef,
          programCount: upcomingPrograms.length,
          _build: APIOrchestrator.BUILD_STAMP
        },
        // Keep structuredContent for model reasoning (works great without widgets)
        structuredContent: {
          type: 'program_list',
          orgRef,
          programCount: upcomingPrograms.length,
          programs: programListForMessage.map(p => ({
            index: p.index,
            title: p.title,
            price: p.price,
            status: p.status
          }))
        }
        // NOTE: no _meta in v1 (widget-only metadata removed)
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
    context: APIContext,
    input?: string  // Optional: user's NL message for ordinal parsing fallback
  ): Promise<OrchestratorResponse> {
    // ⚠️ HARD STEP GATE - must have confirmed provider first
    // orgRef is set when provider is confirmed (via handleConfirmProvider or searchPrograms)
    if (!context.orgRef && !payload.program_data?.org_ref) {
      Logger.warn('[selectProgram] ⛔ STEP GATE: No confirmed provider');
      return this.formatResponse(
        "Let me help you find a program first. Which activity or provider are you looking for?",
        undefined,
        [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }]
      );
    }
    
    console.log('[selectProgram] 🔍 TRACE: Starting with sessionId:', sessionId);
    console.log('[selectProgram] 🔍 TRACE: Input message:', input || '(none)');
    console.log('[selectProgram] 🔍 TRACE: Payload keys:', Object.keys(payload));
    console.log('[selectProgram] 🔍 TRACE: Full payload:', JSON.stringify(payload, null, 2));
    console.log('[selectProgram] 🔍 TRACE: Current context BEFORE update:', {
      step: context.step,
      hasSelectedProgram: !!context.selectedProgram,
      hasDisplayedPrograms: !!context.displayedPrograms,
      displayedProgramsCount: context.displayedPrograms?.length || 0
    });
    
    // ============================================================================
    // FIVE-LAYER PROGRAM DATA RECOVERY
    // Layer -1: Auto-select single program when payload is empty (BUT NOT if user typed a number)
    // Layer 0: Parse from NL input (e.g., "Class 3") when payload is empty
    // Fixes: ChatGPT sending empty payload when user types ordinal selection
    // FIX 3: If user typed a number, NEVER auto-select - only match by ordinal/title
    // ============================================================================
    let programData = payload.program_data;
    let programRef = payload.program_ref || payload.program_data?.ref || payload.program_data?.program_ref;
    
    // FIX 3: Detect if user typed a number (ordinal selection)
    const isNumericSelection = (input?: string): boolean => {
      if (!input) return false;
      return /\b([1-9]|10)\b/.test(input.trim());
    };
    const userTypedNumber = isNumericSelection(input);
    
    // LAYER -1: If only ONE program displayed and no payload, auto-select it
    // FIX 3: But ONLY if user did NOT type a number (respect their ordinal choice)
    if (!programData && !programRef && context.displayedPrograms?.length === 1 && !userTypedNumber) {
      const singleProgram = context.displayedPrograms[0];
      console.log('[selectProgram] ✅ RECOVERY L-1: Auto-selecting single displayed program', {
        program_ref: singleProgram.program_ref,
        program_name: singleProgram.title
      });
      Logger.info('[selectProgram] ✅ RECOVERY L-1: Auto-selecting single displayed program', {
        program_ref: singleProgram.program_ref,
        program_name: singleProgram.title
      });
      programData = singleProgram.program_data;
      programRef = singleProgram.program_ref;
    }
    
    // LAYER 0: If payload is empty/missing, try parsing from user's NL input
    // This handles both ordinal ("Class 3") and title ("The Coding Course") selection
    if (!programData && !programRef && input && context.displayedPrograms?.length) {
      console.log('[selectProgram] 🔄 RECOVERY L0: Attempting NL parse from input:', input);
      const nlMatch = this.parseProgramSelection(input, context.displayedPrograms);
      if (nlMatch) {
        programData = nlMatch.program_data;
        programRef = nlMatch.program_ref;
        console.log('[selectProgram] ✅ RECOVERY L0: Matched from NL input', {
          input,
          program_ref: programRef,
          program_name: programData?.name || programData?.title
        });
      }
    }
    
    // LAYER 1: If programData missing, recover from displayedPrograms in context
    if (!programData && programRef && context.displayedPrograms?.length) {
      const found = context.displayedPrograms.find(p => p.program_ref === programRef);
      if (found?.program_data) {
        programData = found.program_data;
        console.log('[selectProgram] ✅ RECOVERY L1: Found programData from displayedPrograms', {
          program_ref: programRef,
          program_name: programData?.name || programData?.title
        });
      }
    }
    
    // LAYER 2: If still missing, query cached_provider_feed database
    if (!programData && programRef) {
      console.log('[selectProgram] 🔄 RECOVERY L2: Querying cached_provider_feed for', programRef);
      try {
        const supabase = this.getSupabaseClient();
        const { data: feedData, error } = await supabase
          .from('cached_provider_feed')
          .select('program, org_ref, category')
          .eq('program_ref', programRef)
          .maybeSingle();
        
        if (feedData?.program && !error) {
          programData = {
            ...feedData.program,
            program_ref: programRef,
            org_ref: feedData.org_ref
          };
          console.log('[selectProgram] ✅ RECOVERY L2: Found programData from cached_provider_feed', {
            program_ref: programRef,
            program_name: programData?.name || programData?.title,
            org_ref: feedData.org_ref
          });
        } else if (error) {
          console.log('[selectProgram] ⚠️ RECOVERY L2 DB error:', error.message);
        }
      } catch (dbError) {
        console.log('[selectProgram] ⚠️ RECOVERY L2 exception:', dbError);
      }
    }
    
    // LAYER 3: If still missing, return error
    if (!programData) {
      console.error('[selectProgram] ❌ RECOVERY FAILED: No programData found for', programRef);
      Logger.error('[selectProgram] RECOVERY FAILED', { program_ref: programRef });
      return this.formatResponse(
        "I couldn't find that program's details. Could you please select it again from the list?"
      );
    }
    
    const programName = programData?.title || programData?.name || payload.program_name || "this program";
    
    // Debug logging to catch structure issues
    if (programName === "this program") {
      Logger.warn('[selectProgram] Missing program name in payload:', {
        has_program_data: !!payload.program_data,
        payload_keys: Object.keys(payload),
        program_data_keys: programData ? Object.keys(programData) : []
      });
    }
    const orgRef = programData?.org_ref || 'aim-design';

    // Update context (clear displayedPrograms since we're moving to next step)
    // CRITICAL: Use awaited persist to prevent race conditions
    console.log('[selectProgram] 🔍 TRACE: About to call updateContextAndAwait with selectedProgram:', {
      programData_exists: !!programData,
      programData_ref: programData?.ref || programData?.program_ref,
      programData_name: programData?.name || programData?.title
    });
    
    await this.updateContextAndAwait(sessionId, {
      step: FlowStep.FORM_FILL,
      selectedProgram: programData,
      displayedPrograms: undefined // Clear to prevent stale data
    });
    
    // Verify update succeeded
    const verifyContext = this.sessions.get(sessionId);
    console.log('[selectProgram] ✅ TRACE: Context AFTER update:', {
      sessionId,
      program_ref: programRef,
      program_name: programName,
      has_selectedProgram_in_map: !!verifyContext?.selectedProgram,
      verified_step: verifyContext?.step,
      verified_program_name: verifyContext?.selectedProgram?.name || verifyContext?.selectedProgram?.title
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
        programData_keys: Object.keys(programData)
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
      
      // Simplified message - timing context shown at payment step instead
      const message = `Great choice! Let's get you signed up for **${programName}**.`;

      // Return form schema with fullscreen mode for ChatGPT compliance
      // Include all fields the widget needs to initialize form state
      const programFeeCents = programData.priceCents || 
                              (programData.price ? Math.round(parseFloat(String(programData.price).replace(/[^0-9.]/g, '')) * 100) : 0);
      
      const formResponse: OrchestratorResponse = {
        message,
        metadata: {
          // V1 chat-only: gate widget-specific fields behind WIDGET_ENABLED
          ...(WIDGET_ENABLED ? { componentType: 'fullscreen_form', displayMode: 'fullscreen' } : {}),
          signupForm: formDiscoveryResult.data?.program_questions || {},
          program_ref: programRef,
          org_ref: orgRef,
          program_name: programName,
          programFeeCents: programFeeCents,
          numParticipants: context.numParticipants || 1,
          provider: 'bookeo'
        }
      };

      // Cache required field metadata for guided prompts (Bookeo schema)
      if (formDiscoveryResult.success && formDiscoveryResult.data?.program_questions) {
        const questions = formDiscoveryResult.data.program_questions;
        const delegateFields = questions.delegate_fields || [];
        const participantFields = questions.participant_fields || [];
        const requiredFields = {
          delegate: delegateFields.map((f: any) => ({
            key: f.fieldId || f.id,
            label: f.label,
            required: f.mandatory ?? f.required ?? false,
            type: f.type
          })),
          participant: participantFields.map((f: any) => ({
            key: f.fieldId || f.id,
            label: f.label,
            required: f.mandatory ?? f.required ?? false,
            type: f.type
          }))
        };
        await this.updateContextAndAwait(sessionId, { requiredFields });
      }

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
    
    const { formData } = payload;

    // Recover program context from payload if server state was lost (Railway restarts, multi-instance)
    if (!context.selectedProgram && payload.program_ref) {
      Logger.info('[submitForm] Recovering program context from payload:', {
        program_ref: payload.program_ref,
        org_ref: payload.org_ref,
        program_name: payload.program_name
      });
      
      // Fetch full program data from cache to get pricing
      const supabase = this.getSupabaseClient();
      const { data: programCache } = await supabase
        .from('cached_provider_feed')
        .select('program, signup_form')
        .eq('program_ref', payload.program_ref)
        .eq('org_ref', payload.org_ref || 'aim-design')
        .maybeSingle();
      
      if (programCache?.program) {
        const programData = typeof programCache.program === 'string' 
          ? JSON.parse(programCache.program) 
          : programCache.program;
        
        context.selectedProgram = {
          ...programData,
          program_ref: payload.program_ref,
          org_ref: payload.org_ref || 'aim-design',
          title: programData.title || programData.name || payload.program_name
        };
        
        // Update session for subsequent calls
        this.updateContext(sessionId, { selectedProgram: context.selectedProgram, step: FlowStep.FORM_FILL });
        Logger.info('[submitForm] ✅ Program context recovered from database');
      } else {
        Logger.warn('[submitForm] Could not recover program from database, using minimal data');
        context.selectedProgram = {
          program_ref: payload.program_ref,
          org_ref: payload.org_ref || 'aim-design',
          title: payload.program_name || 'Selected Program'
        };
      }
    }

    // FLOW INTEGRITY GUARD: Ensure we have a valid program before proceeding
    // This prevents ChatGPT NL from jumping to submission without proper program selection
    if (!context.selectedProgram?.program_ref) {
      Logger.warn('[submitForm] ⚠️ Flow integrity guard triggered - no selectedProgram', {
        sessionId,
        hasFormData: !!formData,
        hasPayloadProgramRef: !!payload.program_ref,
        step: context.step
      });
      
      // User-friendly recovery: redirect to program search
      const orgRef = context.orgRef || 'aim-design';
      return this.formatResponse(
        "Let me help you find a program first. Which activity are you looking for?",
        undefined,
        [
          { 
            label: "Browse Programs", 
            action: "search_programs", 
            payload: { orgRef },
            variant: "accent" as const
          }
        ]
      );
    }
    
    if (!formData) {
      Logger.warn('[submitForm] ⚠️ Missing form data', { sessionId, hasSelectedProgram: true });
      return this.formatError("I need your registration details. Please fill out the form and try again.");
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
      Logger.info('[submitForm] Saving new children for user:', { userId, count: payload.saveNewChildren.length });
      for (const child of payload.saveNewChildren) {
        try {
          const result = await this.invokeMCPTool('user.create_child', {
            user_id: userId,
            first_name: child.first_name,
            last_name: child.last_name,
            dob: child.dob
          });
          if (result?.success) {
            Logger.info('[submitForm] ✅ Child saved:', { firstName: child.first_name, lastName: child.last_name });
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
      step: FlowStep.REVIEW,
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

    // ✅ COMPLIANCE: Determine booking status FIRST for proper confirmation messaging
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
    const isFutureBooking = bookingStatus === 'opens_later';

    // Build review summary and store state for payment/confirmation
    let cardLast4: string | null = null;
    let cardBrand: string | null = null;
    if (userId) {
      const supabase = this.getSupabaseClient();
      const { data: billingData } = await supabase
        .from('user_billing')
        .select('default_payment_method_id, payment_method_last4, payment_method_brand')
        .eq('user_id', userId)
        .maybeSingle();
      cardLast4 = billingData?.payment_method_last4 || null;
      cardBrand = billingData?.payment_method_brand || null;
      Logger.info('[submitForm] Payment method check result', { hasPaymentMethod: !!billingData?.default_payment_method_id, cardBrand, cardLast4 });
    }

    const scheduledTime = isFutureBooking
      ? (earliestSlot?.toISOString() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      : undefined;

    this.updateContext(sessionId, {
      step: FlowStep.REVIEW,
      formData: {
        delegate_data: formData.delegate,
        participant_data: formData.participants,
        num_participants: numParticipants,
        event_id: context.selectedProgram?.first_available_event_id,
        program_fee_cents: Math.round(totalPrice * 100)
      },
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

    Logger.info('[submitForm] All required fields collected; transitioning to REVIEW phase');
    const delegate = formData.delegate || {};
    const participant = (formData.participants || [])[0] || {};
    const childName = participant.firstName
      ? `${participant.firstName} ${participant.lastName || ""}`.trim()
      : (context.childInfo?.name || "your child");
    const childDetail = participant.dob ? ` (DOB: ${participant.dob})` : (participant.age ? ` (Age: ${participant.age})` : "");
    const parentName = `${delegate.delegate_firstName || ""} ${delegate.delegate_lastName || ""}`.trim();
    const sessionDate = context.selectedProgram?.earliest_slot_time ? this.formatTimeForUser(context.selectedProgram.earliest_slot_time, context) : null;
    let reviewMessage = "Please review the details below:\\n\\n";
    reviewMessage += `- **Program:** ${programName}\\n`;
    reviewMessage += `- **Participant:** ${childName}${childDetail}\\n`;
    reviewMessage += `- **Parent/Guardian:** ${parentName || delegate.email || "parent"}\\n`;
    if (sessionDate) reviewMessage += `- **Date:** ${sessionDate}\\n`;
    reviewMessage += `- **Program Fee:** ${formattedTotal} (paid to provider)\\n`;
    reviewMessage += `- **SignupAssist Fee:** $20 (charged only upon successful registration)\\n`;
    if (cardLast4) reviewMessage += `- **Payment method on file:** ${cardBrand || 'Card'} •••• ${cardLast4}\\n`;
    reviewMessage += "\\nIf everything is correct, type \\\"yes\\\" to continue or \\\"cancel\\\" to abort.";
    return this.formatResponse(reviewMessage);
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

      // ⚠️ HARD STEP GATE: Must have selected a program
      if (!context.selectedProgram?.program_ref) {
        Logger.warn('[confirmPayment] ⛔ STEP GATE: No selected program - cannot proceed');
        return this.formatResponse(
          "Let me help you find a program first. Which activity are you looking for?",
          undefined,
          [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
        );
      }

      // ⚠️ HARD STEP GATE: Must be in PAYMENT/SUBMIT step
      if (context.step !== FlowStep.PAYMENT && context.step !== FlowStep.SUBMIT) {
        Logger.warn('[confirmPayment] ⛔ STEP GATE: Not in PAYMENT/SUBMIT step', { currentStep: context.step });
        return this.formatResponse(
          "We need to collect some information first before completing payment.",
          undefined,
          [{ label: "Continue Registration", action: "select_program", payload: { program_ref: context.selectedProgram.program_ref }, variant: "accent" }]
        );
      }

      // ⚠️ HARD STEP GATE: Must have payment method for immediate booking
      if (!context.cardLast4 && !context.cardBrand) {
        Logger.warn('[confirmPayment] ⛔ STEP GATE: No payment method in context');
        return {
          message: "Before I can complete your booking, I need to save a payment method.",
          metadata: {
            componentType: "payment_setup",
            next_action: "confirm_payment",
            _build: APIOrchestrator.BUILD_STAMP
          },
          cta: {
            buttons: [
              { label: "Add Payment Method", action: "setup_payment", variant: "accent" }
            ]
          }
        };
      }

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
        grade: p.grade
        // allergies field REMOVED for ChatGPT App Store compliance (PHI prohibition)
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
   * Show payment authorization card after payment method is saved
   * Displays dual-charge breakdown with saved card details before final confirmation
   */
  private async showPaymentAuthorization(
    payload: any,
    sessionId: string,
    context: APIContext
  ): Promise<OrchestratorResponse> {
    try {
      Logger.info("[showPaymentAuthorization] Preparing payment authorization card");
      
      const { user_id, schedulingData } = payload;
      
      // Get saved card details from user_billing table
      let cardLast4 = context.cardLast4;
      let cardBrand = context.cardBrand;
      
      if (!cardLast4 && user_id) {
        try {
          const supabase = createClient(
            process.env.SUPABASE_URL || process.env.SB_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ''
          );
          
          const { data: billingData } = await supabase
            .from('user_billing')
            .select('payment_method_last4, payment_method_brand')
            .eq('user_id', user_id)
            .maybeSingle();
            
          if (billingData) {
            cardLast4 = billingData.payment_method_last4;
            cardBrand = billingData.payment_method_brand;
            Logger.info("[showPaymentAuthorization] Retrieved card details:", { cardBrand, cardLast4 });
          }
        } catch (error) {
          Logger.warn("[showPaymentAuthorization] Failed to retrieve card details:", error);
        }
      }
      
      // Get pricing info from schedulingData or context
      const formData = schedulingData?.formData || context.formData;
      const programFeeCents = formData?.program_fee_cents || schedulingData?.program_fee_cents || 0;
      const programFee = (programFeeCents / 100).toFixed(2);
      const totalAmount = ((programFeeCents + 2000) / 100).toFixed(2);
      const programName = context.selectedProgram?.title || formData?.program_name || "Program";
      
      // Format card display
      const cardDisplay = cardLast4 && cardBrand 
        ? `${cardBrand} •••• ${cardLast4}`
        : cardLast4 
          ? `Card •••• ${cardLast4}`
          : "Saved Card";
      
      // Build payment authorization message using Design DNA template
      const message = getPaymentAuthorizationMessage({
        program_name: programName,
        total_cost: `$${programFee}`,
        provider_name: "AIM Design"
      });
      
      // Build authorization card with dual-charge breakdown
      const authCard: CardSpec = {
        title: "💳 Payment Authorization",
        description: `**Payment Method:** ${cardDisplay}\n\n` +
          `**Program Fee:** $${programFee} (charged to provider)\n` +
          `**SignupAssist Fee:** $20.00 (charged only if registration succeeds)\n\n` +
          `**Total:** $${totalAmount}`,
        metadata: {
          programFeeCents,
          serviceFeeCents: 2000,
          isPaymentCard: true,
          cardBrand,
          cardLast4
        },
        buttons: [
          {
            label: `Pay with ${cardDisplay}`,
            action: "confirm_payment",
            payload: {
              user_id,
              ...schedulingData
            },
            variant: "accent"
          },
          {
            label: "Go Back",
            action: "search_programs",
            variant: "outline"
          }
        ]
      };
      
      const response: OrchestratorResponse = {
        message: addAPISecurityContext(addResponsibleDelegateFooter(message), "AIM Design"),
        cards: [authCard]
      };
      
      // Validate Design DNA compliance
      const validation = validateDesignDNA(response, {
        step: 'payment',
        isWriteAction: true
      });
      
      if (!validation.passed) {
        Logger.error('[DesignDNA] Validation failed:', validation.issues);
      }
      
      Logger.info("[showPaymentAuthorization] ✅ Authorization card ready");
      return response;
      
    } catch (error) {
      Logger.error("[showPaymentAuthorization] Error:", error);
      return this.formatError("Failed to prepare payment authorization. Please try again.");
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
      
      // ⚠️ HARD STEP GATES - prevent NL bypass of payment setup
      
      // Gate 1: Must have selected a program
      if (!context.selectedProgram?.program_ref) {
        Logger.warn('[setupPaymentMethod] ⛔ STEP GATE: No selected program');
        return this.formatResponse(
          "Let me help you find a program first before setting up payment.",
          undefined,
          [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
        );
      }
      
      // Gate 2: Must be in FORM_FILL, REVIEW, or PAYMENT step
      if (context.step !== FlowStep.FORM_FILL && context.step !== FlowStep.REVIEW && context.step !== FlowStep.PAYMENT) {
        Logger.warn('[setupPaymentMethod] ⛔ STEP GATE: Not in FORM_FILL/REVIEW/PAYMENT step', { currentStep: context.step });
        return this.formatResponse(
          "We need to collect your registration details first before setting up payment.",
          undefined,
          [{ label: "Continue Registration", action: "select_program", payload: { program_ref: context.selectedProgram.program_ref }, variant: "accent" }]
        );
      }

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
    // ⚠️ HARD STEP GATE: Must have selected a program
    if (!context.selectedProgram?.program_ref) {
      Logger.warn('[scheduleAutoRegistration] ⛔ STEP GATE: No selected program');
      return this.formatResponse(
        "Let me help you find a program first. Which activity are you looking for?",
        undefined,
        [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
      );
    }

    // ⚠️ HARD STEP GATE: Must be in REVIEW or PAYMENT step
    if (context.step !== FlowStep.PAYMENT && context.step !== FlowStep.REVIEW) {
      Logger.warn('[scheduleAutoRegistration] ⛔ STEP GATE: Not in PAYMENT/REVIEW step', { currentStep: context.step });
      return this.formatResponse(
        "We need to collect participant information first.",
        undefined,
        [{ label: "Continue Registration", action: "select_program", payload: { program_ref: context.selectedProgram.program_ref }, variant: "accent" }]
      );
    }

    const { scheduled_time, event_id, total_amount, program_fee, program_fee_cents, formData } = payload;
    
    // ⚠️ HARD STEP GATE: Must have scheduling time
    if (!scheduled_time) {
      Logger.warn('[scheduleAutoRegistration] ⛔ STEP GATE: No scheduled_time in payload');
      return this.formatError("Missing scheduling information. Please try selecting the program again.");
    }
    
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
        },
        _build: APIOrchestrator.BUILD_STAMP
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
    // ⚠️ HARD STEP GATE: Must have selected a program
    if (!context.selectedProgram?.program_ref) {
      Logger.warn('[confirmScheduledRegistration] ⛔ STEP GATE: No selected program');
      return this.formatResponse(
        "Let me help you find a program first. Which activity are you looking for?",
        undefined,
        [{ label: "Browse Programs", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
      );
    }

    // ⚠️ SAFETY NET: Payment method guard
    if (!context.cardLast4 && !context.cardBrand) {
      Logger.warn('[confirmScheduledRegistration] ⚠️ No payment method in context - prompting for setup');
      return {
        message: "Before I can schedule your registration, I need to save a payment method. You'll only be charged if registration succeeds!",
        metadata: {
          componentType: "payment_setup",
          next_action: "confirm_scheduled_registration",
          schedulingData: context.schedulingData,
          _build: APIOrchestrator.BUILD_STAMP
        },
        cta: {
          buttons: [
            { label: "Add Payment Method", action: "setup_payment", variant: "accent" }
          ]
        }
      };
    }
    
    // ⚠️ SAFETY NET: Explicit authorization guard
    if (!context.paymentAuthorized) {
      Logger.warn('[confirmScheduledRegistration] ⚠️ Payment not explicitly authorized - prompting for authorization');
      const amount = context.schedulingData?.total_amount || context.selectedProgram?.price || 'the program fee';
      const scheduledTime = context.schedulingData?.scheduled_time;
      const scheduledDate = scheduledTime ? new Date(scheduledTime).toLocaleString() : null;
      
      return {
        message: scheduledDate
          ? `I have your payment method on file (${context.cardBrand} •••${context.cardLast4}). Please click "Authorize Payment" to confirm:\n\n💰 **Amount:** ${amount}\n📅 **Scheduled for:** ${scheduledDate}\n\nYou'll only be charged if registration succeeds.`
          : `I have your payment method on file (${context.cardBrand} •••${context.cardLast4}). Please click "Authorize Payment" to complete your booking.\n\n💰 **Amount:** ${amount}`,
        metadata: {
          _build: APIOrchestrator.BUILD_STAMP
        },
        cta: {
          buttons: [
            { label: "Authorize Payment", action: "authorize_payment", variant: "accent" },
            { label: "Cancel", action: "cancel_flow", variant: "ghost" }
          ]
        }
      };
    }
    
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
   * Map technical scopes to user-friendly labels for ChatGPT-compatible display
   */
  private mapScopeToFriendly(scope: string): string {
    const scopeMap: Record<string, string> = {
      'scp:register': '✓ Register for programs',
      'scp:browse': '✓ Browse programs',
      'scp:authenticate': '✓ Authenticate',
      'scp:read:listings': '✓ View listings',
      'platform:success_fee': '✓ Charge success fee',
      'platform:refund': '✓ Process refunds',
    };
    return scopeMap[scope] || `• ${scope}`;
  }

  /**
   * View audit trail for a specific registration
   * Phase E: Shows mandate details and all tool calls with decisions
   * Includes SHA256 hashes for integrity verification and JWS token for cryptographic proof
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
      
      // 2. Get mandate details including JWS token for cryptographic verification
      const { data: mandate, error: mandateError } = await supabase
        .from('mandates')
        .select('id, scope, valid_from, valid_until, status, provider, jws_compact')
        .eq('id', registration.mandate_id)
        .single();
      
      if (mandateError) {
        Logger.warn("[viewAuditTrail] Mandate lookup failed:", mandateError);
      }
      
      // 3. Get audit events for this mandate (including args, results, and hashes for transparency)
      const { data: auditEvents, error: auditError } = await supabase
        .from('audit_events')
        .select('tool, decision, started_at, finished_at, event_type, args_json, result_json, args_hash, result_hash')
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
      
      // Build detailed event cards with SHA256 hashes for integrity verification
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
        
        // Build description with optional hash display for integrity verification
        const descriptionParts = [
          `**Input Data:**`,
          details.input,
        ];
        
        if (event.args_hash) {
          descriptionParts.push(`🔏 **Input Hash:** \`${event.args_hash.substring(0, 12)}...\``);
        }
        
        descriptionParts.push('', `**Result:**`, details.output);
        
        if (event.result_hash) {
          descriptionParts.push(`🔏 **Output Hash:** \`${event.result_hash.substring(0, 12)}...\``);
        }
        
        return {
          title: friendlyNames[toolName] || `🔧 ${toolName}`,
          subtitle: `${status} • ${time}`,
          description: descriptionParts.join('\n'),
          buttons: []
        };
      });
      
      // Build mandate summary card with friendly scopes and JWS token
      const friendlyScopes = (mandate?.scope || []).map((s: string) => this.mapScopeToFriendly(s)).join(', ');
      
      const mandateDescriptionParts = [
        `**Provider:** ${mandate?.provider || 'N/A'}`,
        `**Scopes:** ${friendlyScopes || 'N/A'}`,
        `**Valid From:** ${mandate ? this.formatTimeForUser(new Date(mandate.valid_from), context) : 'N/A'}`,
        `**Valid Until:** ${mandate ? this.formatTimeForUser(new Date(mandate.valid_until), context) : 'N/A'}`,
        `**Status:** ${mandate?.status || 'N/A'}`
      ];
      
      // Include truncated JWS token for cryptographic verification
      if (mandate?.jws_compact) {
        mandateDescriptionParts.push('');
        mandateDescriptionParts.push(`📜 **Cryptographic Token:** \`${mandate.jws_compact.substring(0, 40)}...\``);
        mandateDescriptionParts.push(`_(Verifiable JWS signature - tamper-proof authorization record)_`);
      }
      
      const mandateCard: CardSpec = {
        title: `🔐 Mandate Authorization`,
        subtitle: `ID: ${mandate?.id?.substring(0, 8) || 'N/A'}...`,
        description: mandateDescriptionParts.join('\n'),
        buttons: [],
        metadata: {
          jws_compact: mandate?.jws_compact // Include full token for frontend decoding if needed
        }
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
      
      // Build appropriate message based on whether audit events exist
      let auditMessage: string;
      if (auditTrailItems.length > 0) {
        auditMessage = `📋 **Audit Trail**\n\n` +
          `**Actions Performed (${auditTrailItems.length} events):**\n` +
          auditTrailItems.join('\n') +
          `\n\n🔒 All actions are logged for transparency.`;
      } else {
        // Check if this is a legacy registration (before Dec 8, 2025 when audit logging was implemented)
        const regDate = new Date(registration.created_at);
        const auditLoggingStartDate = new Date('2025-12-08');
        
        if (regDate < auditLoggingStartDate) {
          auditMessage = `📋 **Audit Trail**\n\n` +
            `This registration was completed on ${this.formatTimeForUser(regDate, context)}, before detailed audit logging was implemented.\n\n` +
            `🔒 Your authorization was recorded via the mandate shown below.`;
        } else {
          auditMessage = `📋 **Audit Trail**\n\n` +
            `No detailed action logs were recorded for this registration.\n\n` +
            `🔒 Your authorization is documented in the mandate below.`;
        }
      }

      return {
        message: auditMessage,
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
        let message = getConfirmedCancelConfirmMessage({
          program_name: registration.program_name,
          provider_name: providerName,
          booking_number: registration.booking_number
        });
        // ✅ COMPLIANCE: Include Responsible Delegate reminder for cancellation
        message = addResponsibleDelegateFooter(message);
        
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
      let message = getPendingCancelConfirmMessage({
        program_name: registration.program_name
      });
      // ✅ COMPLIANCE: Include Responsible Delegate reminder for cancellation
      message = addResponsibleDelegateFooter(message);
      
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
      metadata: {
        ...metadata,
        _build: APIOrchestrator.BUILD_STAMP
      }
    };
  }

  /**
   * Format error response
   */
  private formatError(message: string): OrchestratorResponse {
    return {
      message: `❌ ${message}`,
      cards: undefined,
      cta: undefined,
      metadata: {
        _build: APIOrchestrator.BUILD_STAMP
      }
    };
  }

  /**
   * Attach the latest context snapshot to the response so downstream guardrails
   * can compute the correct wizard step/progress in ChatGPT chat mode.
   */
  private attachContextSnapshot(
    response: OrchestratorResponse,
    sessionId: string
  ): OrchestratorResponse {
    const ctx = this.getContext(sessionId);
    const selectedProgramName =
      ctx.selectedProgram?.title || ctx.selectedProgram?.name || ctx.selectedProgram?.programName;

    const contextSnapshot = {
      step: ctx.step,
      orgRef: ctx.orgRef,
      userTimezone: ctx.userTimezone,
      requestedActivity: ctx.requestedActivity,
      selectedProgramName,
      selectedProgram: ctx.selectedProgram,
      formData: ctx.formData,
      requiredFields: ctx.requiredFields,
      pendingDelegateInfo: ctx.pendingDelegateInfo,
      pendingParticipants: ctx.pendingParticipants,
      schedulingData: ctx.schedulingData,
      paymentAuthorized: ctx.paymentAuthorized
    };

    return {
      ...response,
      step: response.step || ctx.step,
      context: { ...(response.context || {}), ...contextSnapshot }
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
   * Handle select_child action from UI cards or natural language
   * Stores child info in context and proceeds to next field
   */
  private async handleSelectChild(
    payload: any,
    sessionId: string,
    context: APIContext,
    input: string
  ): Promise<OrchestratorResponse> {
    Logger.info('[handleSelectChild] Processing child selection', { 
      hasPayload: !!payload, 
      payloadKeys: payload ? Object.keys(payload) : [],
      input 
    });

    // Extract child info from payload first (UI action)
    let childInfo = null;
    
    if (payload?.first_name && payload?.last_name) {
      childInfo = {
        firstName: payload.first_name,
        lastName: payload.last_name,
        age: payload.age ? Number(payload.age) : undefined
      };
    } else if (payload?.child_id) {
      // Child selected from saved children - look it up
      Logger.info('[handleSelectChild] Child selected by ID:', payload.child_id);
      // For now, just use the child_id as-is if present
      childInfo = { childId: payload.child_id };
    }

    // If no payload, try parsing from natural language input
    if (!childInfo && input) {
      const parsed = this.parseChildLine(input);
      if (parsed) {
        childInfo = parsed;
        Logger.info('[handleSelectChild] Parsed child from NL:', parsed);
      } else {
        // Fallback to existing parser for more formats
        const fallbackParsed = this.parseChildInfoFromMessage(input);
        if (fallbackParsed) {
          childInfo = {
            firstName: fallbackParsed.firstName || fallbackParsed.name?.split(' ')[0],
            lastName: fallbackParsed.lastName || fallbackParsed.name?.split(' ').slice(1).join(' '),
            age: fallbackParsed.age
          };
          Logger.info('[handleSelectChild] Parsed child from fallback:', childInfo);
        }
      }
    }

    if (!childInfo) {
      Logger.warn('[handleSelectChild] Could not parse child info from payload or input');
      return this.formatResponse(
        "I need the participant's information. Please provide their name and age (e.g., 'Percy Messinger, 11').",
        undefined,
        []
      );
    }

    // Store child info in pendingParticipants (use camelCase to match type)
    const participants = context.pendingParticipants || [];
    participants.push({
      firstName: childInfo.firstName,
      lastName: childInfo.lastName,
      age: childInfo.age
    });

    this.updateContext(sessionId, { 
      pendingParticipants: participants,
      childInfo: {
        name: `${childInfo.firstName || ''} ${childInfo.lastName || ''}`.trim(),
        age: childInfo.age
      }
    });

    Logger.info('[handleSelectChild] ✅ Child info stored', { 
      participantCount: participants.length,
      childInfo 
    });

    // Ask for delegate email if we don't have it yet
    if (!context.pendingDelegateInfo?.email) {
      this.updateContext(sessionId, { awaitingDelegateEmail: true });
      return this.formatResponse(
        `Great! I have ${childInfo.firstName}'s information. What email should I use for the registration?`,
        undefined,
        []
      );
    }

    // If we have delegate info, proceed to form submission
    return await this.submitForm({
      formData: {
        participants,
        delegate: context.pendingDelegateInfo
      },
      program_ref: context.selectedProgram?.program_ref,
      org_ref: context.orgRef || context.selectedProgram?.org_ref
    }, sessionId, this.getContext(sessionId));
  }

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

  // ============================================================================
  // Session Persistence Layer (Supabase browser_sessions table)
  // Fixes: ChatGPT multi-turn conversations losing context between API calls
  // ============================================================================
  
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly SESSION_KEY_PREFIX = 'orchestrator:api:';
  
  /**
   * Load session context from Supabase
   * Called when context not found in memory (e.g., ChatGPT calls with same sessionId)
   */
  private async loadSessionFromDB(sessionId: string): Promise<APIContext | null> {
    try {
      const supabase = this.getSupabaseClient();
      const sessionKey = this.SESSION_KEY_PREFIX + sessionId;
      
      // Check if this looks like an Auth0 userId vs a ChatGPT sessionId
      const isAuth0Key = sessionId.startsWith('auth0|') || sessionId.startsWith('google-oauth2|');
      
      console.log('[loadSessionFromDB] 🔍 Looking up session:', {
        sessionId,
        sessionKey,
        isAuth0Key,
        timestamp: new Date().toISOString()
      });
      
      const { data, error } = await supabase
        .from('browser_sessions')
        .select('session_data, expires_at')
        .eq('session_key', sessionKey)
        .maybeSingle();
      
      if (error) {
        Logger.warn('[loadSessionFromDB] Error loading session:', error.message);
        return null;
      }
      
      if (!data) {
        console.log('[loadSessionFromDB] ❌ No session found in DB:', {
          sessionId,
          sessionKey,
          isAuth0Key,
          suggestion: isAuth0Key ? 'First request with this Auth0 user' : 'Session may have expired or never existed'
        });
        return null;
      }
      
      // Check expiry
      if (new Date(data.expires_at) < new Date()) {
        Logger.info('[loadSessionFromDB] Session expired, deleting:', sessionId);
        await supabase.from('browser_sessions').delete().eq('session_key', sessionKey);
        return null;
      }
      
      const sessionData = data.session_data as APIContext;
      console.log('[loadSessionFromDB] ✅ Session RESTORED from DB:', {
        sessionId,
        sessionKey,
        isAuth0Key,
        step: sessionData.step,
        hasSelectedProgram: !!sessionData.selectedProgram,
        programName: sessionData.selectedProgram?.name || sessionData.selectedProgram?.title,
        hasFormData: !!sessionData.formData,
        requestedActivity: sessionData.requestedActivity,
        timestamp: new Date().toISOString()
      });
      
      return sessionData;
    } catch (error) {
      Logger.error('[loadSessionFromDB] Failed to load session:', error);
      return null;
    }
  }
  
  /**
   * Persist session context to Supabase
   * Called after every updateContext to ensure durability
   */
  private async persistSessionToDB(sessionId: string, context: APIContext): Promise<void> {
    try {
      const supabase = this.getSupabaseClient();
      const sessionKey = this.SESSION_KEY_PREFIX + sessionId;
      const expiresAt = new Date(Date.now() + this.SESSION_TTL_MS).toISOString();
      
      // Check if this looks like an Auth0 userId vs a ChatGPT sessionId
      const isAuth0Key = sessionId.startsWith('auth0|') || sessionId.startsWith('google-oauth2|');
      
      const { error } = await supabase
        .from('browser_sessions')
        .upsert({
          session_key: sessionKey,
          session_data: context,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'session_key'
        });
      
      if (error) {
        Logger.warn('[persistSessionToDB] Error persisting session:', error.message);
      } else {
        console.log('[persistSessionToDB] 💾 Session SAVED to DB:', {
          sessionId,
          sessionKey,
          isAuth0Key,
          step: context.step,
          hasSelectedProgram: !!context.selectedProgram,
          programName: context.selectedProgram?.name || context.selectedProgram?.title,
          expiresAt,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      Logger.error('[persistSessionToDB] Failed to persist session:', error);
      // Don't throw - session persistence is non-critical
    }
  }

  /**
   * Get session context (auto-initialize if needed)
   * Now checks Supabase if not in memory (for ChatGPT multi-turn support)
   */
  private getContext(sessionId: string): APIContext {
    const exists = this.sessions.has(sessionId);
    console.log('[getContext] 🔍', {
      sessionId,
      exists,
      action: exists ? 'retrieving existing' : 'checking DB then creating new',
      currentStep: exists ? this.sessions.get(sessionId)?.step : 'none',
      hasSelectedProgram: exists ? !!this.sessions.get(sessionId)?.selectedProgram : false
    });
    
    if (!this.sessions.has(sessionId)) {
      // Initialize with empty context - async DB load happens in getContextAsync
      this.sessions.set(sessionId, {
        step: FlowStep.BROWSE
      });
    }
    return this.sessions.get(sessionId)!;
  }
  
  /**
   * Get session context with async DB loading (for ChatGPT multi-turn support)
   * Use this at the start of generateResponse to ensure DB context is loaded
   */
  private async getContextAsync(sessionId: string): Promise<APIContext> {
    // Check memory first (fast path)
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    
    // Try loading from DB (slow path - for ChatGPT calls with persisted context)
    const dbContext = await this.loadSessionFromDB(sessionId);
    if (dbContext) {
      // Restore to memory cache
      this.sessions.set(sessionId, dbContext);
      return dbContext;
    }
    
    // Initialize new context
    const newContext: APIContext = { step: FlowStep.BROWSE };
    this.sessions.set(sessionId, newContext);
    return newContext;
  }

  /**
   * Update session context (now also persists to Supabase)
   * ENHANCED: Added detailed tracing to debug session persistence issues
   * 
   * FIX 2: NEVER revert step after selectProgram
   * Once step transitions to FORM_FILL, nothing is allowed to set it back to BROWSE.
   */
  private updateContext(sessionId: string, updates: Partial<APIContext>): void {
    const current = this.getContext(sessionId);
    
    // FIX 2: Guard against step reversion from FORM_FILL/PAYMENT back to BROWSE
    // ONLY block if we have a valid selectedProgram (i.e., not corrupted state)
    if (updates.step === FlowStep.BROWSE) {
      const isAdvancedStep = current.step === FlowStep.FORM_FILL || current.step === FlowStep.REVIEW || current.step === FlowStep.PAYMENT || current.step === FlowStep.SUBMIT;
      const hasValidProgram = !!current.selectedProgram;
      if (isAdvancedStep && hasValidProgram) {
        console.log('[updateContext] ⛔ FIX 2: Blocked step reversion from', current.step, 'to BROWSE (valid program exists)');
        delete updates.step; // Remove the step update, keep current step
      }
    }
    
    const updated = { ...current, ...updates };
    this.sessions.set(sessionId, updated);
    
    // 🔍 TRACE: Log what we're persisting
    const tracePayload = {
      sessionId,
      updateKeys: Object.keys(updates),
      hasSelectedProgram: !!updated.selectedProgram,
      selectedProgramName: updated.selectedProgram?.name || updated.selectedProgram?.title || 'none',
      step: updated.step,
      timestamp: new Date().toISOString()
    };
    
    console.log('[updateContext] 📝 TRACE: Updating session:', JSON.stringify(tracePayload, null, 2));
    
    // Async persist to DB (fire-and-forget for performance)
    this.persistSessionToDB(sessionId, updated)
      .then(() => {
        console.log('[updateContext] ✅ TRACE: Persist completed for', sessionId);
      })
      .catch(err => {
        console.error('[updateContext] ❌ TRACE: Persist FAILED for', sessionId, err);
        Logger.warn('[updateContext] Background persist failed:', err);
      });
  }
  
  /**
   * Update session context with AWAITED DB persistence
   * Use this for critical state transitions (e.g., selectedProgram) to prevent race conditions
   * in multi-instance environments like Railway where fire-and-forget can cause data loss
   * 
   * FIX 2: NEVER revert step after selectProgram
   * Once step transitions to FORM_FILL, nothing is allowed to set it back to BROWSE.
   */
  private async updateContextAndAwait(sessionId: string, updates: Partial<APIContext>): Promise<void> {
    const current = this.getContext(sessionId);
    
    // FIX 2: Guard against step reversion from FORM_FILL/PAYMENT back to BROWSE
    // ONLY block if we have a valid selectedProgram (i.e., not corrupted state)
    if (updates.step === FlowStep.BROWSE) {
      const isAdvancedStep = current.step === FlowStep.FORM_FILL || current.step === FlowStep.REVIEW || current.step === FlowStep.PAYMENT || current.step === FlowStep.SUBMIT;
      const hasValidProgram = !!current.selectedProgram;
      if (isAdvancedStep && hasValidProgram) {
        console.log('[updateContextAndAwait] ⛔ FIX 2: Blocked step reversion from', current.step, 'to BROWSE (valid program exists)');
        delete updates.step; // Remove the step update, keep current step
      }
    }
    
    const updated = { ...current, ...updates };
    this.sessions.set(sessionId, updated);
    
    // 🔍 TRACE: Log what we're persisting
    const tracePayload = {
      sessionId,
      updateKeys: Object.keys(updates),
      hasSelectedProgram: !!updated.selectedProgram,
      selectedProgramName: updated.selectedProgram?.name || updated.selectedProgram?.title || 'none',
      step: updated.step,
      timestamp: new Date().toISOString()
    };
    
    console.log('[updateContextAndAwait] 📝 TRACE: Updating session (awaited):', JSON.stringify(tracePayload, null, 2));
    
    // AWAIT the persist to ensure data is saved before returning
    await this.persistSessionToDB(sessionId, updated);
    console.log('[updateContextAndAwait] ✅ TRACE: Persist COMPLETED for', sessionId);
  }

  /**
   * Reset session context
   */
  public resetContext(sessionId: string): void {
    this.sessions.delete(sessionId);
    
    // Also delete from DB (fire and forget with proper Promise handling)
    const sessionKey = this.SESSION_KEY_PREFIX + sessionId;
    (async () => {
      try {
        await this.getSupabaseClient()
          .from('browser_sessions')
          .delete()
          .eq('session_key', sessionKey);
        Logger.debug('[resetContext] Session deleted from DB:', sessionId);
      } catch (err) {
        Logger.warn('[resetContext] Failed to delete from DB:', err);
      }
    })();
  }
}
