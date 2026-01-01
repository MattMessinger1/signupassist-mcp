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
  addResponsibleDelegateFooter,
  addAPISecurityContext,
} from "./complianceHelpers.js";
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
import crypto from "crypto";
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
  hasPaymentMethod?: boolean; // Source-of-truth: user_billing.default_payment_method_id exists
  userTimezone?: string;  // User's IANA timezone (e.g., 'America/Chicago')
  requestedActivity?: string;  // Track what activity user is looking for (e.g., 'swimming', 'coding')

  // Stripe Checkout (payment method setup)
  // Stored so we can re-send the same link if chat gets choppy or the user asks again.
  stripeCheckoutUrl?: string;
  stripeCheckoutSessionId?: string;
  stripeCheckoutCreatedAt?: string; // ISO timestamp

  // UX: show the trust/safety intro once per durable session
  trustIntroShown?: boolean;

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
    firstName?: string;
    lastName?: string;
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
  pendingDelegateInfo?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    dob?: string;
    relationship?: string;
  };
  awaitingDelegateEmail?: boolean;

  // Returning-user UX: store saved children for quick selection in chat
  savedChildren?: Array<{ id: string; first_name: string; last_name: string; dob?: string | null }>;
  awaitingChildSelection?: boolean;
  // Returning-user UX: for exactly 1 saved child, avoid silent auto-use.
  awaitingSingleChildChoice?: boolean;
  declinedSingleSavedChild?: boolean;

  // REVIEW UX: ensure we always show the full review summary before asking yes/cancel.
  reviewSummaryShown?: boolean;

  /**
   * Wizard UX: track consecutive assistant turns within the same wizard step so we can render
   * "Step N/5 continued — ..." on follow-up turns (e.g., Step 2 often takes multiple messages).
   */
  wizardProgress?: {
    wizardStep: "1" | "2" | "3" | "4" | "5";
    turnInStep: number;
    updatedAt: string; // ISO timestamp
  };

  /**
   * ChatGPT retry dedupe (prevents double-processing and prevents wizard headers rendering as
   * “continued” on the first visible message when ChatGPT retries the same tool call).
   *
   * IMPORTANT: Store only a short hash key (no raw user input).
   */
  lastReplyCache?: {
    key: string; // short hash
    at: string;  // ISO timestamp
    response: {
      message: string;
      step?: string;
      metadata?: any;
      cards?: CardSpec[];
      cta?: { buttons: ButtonSpec[] };
    };
  };

  /**
   * Text-only receipts UX: map displayed short codes (REG-xxxxxxxx / SCH-xxxxxxxx) to full UUIDs.
   * This avoids extra DB lookups (and avoids failures) when the user types e.g. "cancel REG-xxxx".
   */
  lastReceiptRefMap?: Record<string, string>;

  /**
   * Post-success replay (ChatGPT reliability):
   * If a booking completes but the client retries the final “book now” message (or a model-generated “yes”),
   * re-send the last confirmation instead of restarting Step 1 browse.
   *
   * IMPORTANT: Keep this minimal (avoid raw user input / PII); it is only used to re-print the user-facing confirmation.
   */
  lastCompletion?: {
    kind: "immediate" | "scheduled" | "cancel_registration" | "cancel_scheduled";
    completed_at: string; // ISO timestamp
    message: string; // user-facing confirmation text
    booking_number?: string;
    scheduled_registration_id?: string;
    org_ref?: string;
    program_ref?: string;
  };

  // Avoid repeated DB lookups for returning-user prefill within a session
  delegatePrefillAttempted?: boolean;

  // Text-only cancellation confirmation (ChatGPT has no buttons in v1)
  pendingCancellation?: {
    kind: 'registration' | 'scheduled';
    registration_id?: string;
    scheduled_registration_id?: string;
    requested_at: string;
  };

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
  // Ensure DB persists happen in-order per sessionId (prevents late writes overwriting newer state).
  private persistQueue: Map<string, Promise<void>> = new Map();

  private isProductionRuntime(): boolean {
    const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
    const railwayEnv = String(process.env.RAILWAY_ENVIRONMENT || "").toLowerCase();
    if (nodeEnv === "production") return true;
    if (railwayEnv === "production" || railwayEnv === "prod") return true;
    return false;
  }

  private normalizeEnvFlag(name: string): boolean {
    const raw = String(process.env[name] || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }

  private isDebugLoggingEnabled(): boolean {
    if (!this.normalizeEnvFlag("DEBUG_LOGGING")) return false;
    // In production, enforce scoping to reduce risk of capturing user data broadly.
    if (this.isProductionRuntime()) {
      const hasScope =
        !!String(process.env.DEBUG_USER_ID || "").trim() ||
        !!String(process.env.DEBUG_SESSION_ID || "").trim();
      return hasScope;
    }
    return true;
  }

  private getRetryDedupeWindowMs(): number {
    const raw = Number(process.env.MCP_RETRY_DEDUPE_WINDOW_MS || 5000);
    if (!Number.isFinite(raw) || raw <= 0) return 5000;
    // Clamp to sane bounds.
    return Math.max(250, Math.min(raw, 30_000));
  }

  private buildRetryDedupeKey(action: string | undefined, payload: any, input: string): string {
    const a = String(action || "").trim();
    const msg = String(input || "").trim();
    // Only include payload keys (not values) to reduce the chance of hashing PII.
    const payloadKeys =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload).sort().join(",")
        : "";
    const raw = `${a}|${payloadKeys}|${msg}`;
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  private getDebugUserFilter(): string | null {
    const v = String(process.env.DEBUG_USER_ID || "").trim();
    return v || null;
  }

  private getDebugSessionFilter(): string | null {
    const v = String(process.env.DEBUG_SESSION_ID || "").trim();
    return v || null;
  }

  private shouldEmitDebug(meta?: Record<string, any>): boolean {
    if (!this.isDebugLoggingEnabled()) return false;

    const userFilter = this.getDebugUserFilter();
    const sessionFilter = this.getDebugSessionFilter();
    if (!userFilter && !sessionFilter) return true;

    const m = meta || {};
    if (userFilter) {
      const candidate = String(m.userId || m.user_id || "").trim();
      if (!candidate) return false;
      if (candidate !== userFilter) return false;
    }
    if (sessionFilter) {
      const candidate = String(m.sessionId || m.durableSessionId || m.session_key || "").trim();
      if (!candidate) return false;
      if (candidate !== sessionFilter && !candidate.includes(sessionFilter)) return false;
    }
    return true;
  }

  private sanitizeDebugMeta(meta: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(meta || {})) {
      const lk = k.toLowerCase();
      if (v == null) {
        out[k] = v;
        continue;
      }

      // Always avoid logging raw free-text / PII-shaped fields.
      if (
        lk.includes("email") ||
        lk.includes("dob") ||
        lk.includes("birth") ||
        lk.includes("phone") ||
        lk.includes("card") ||
        lk.includes("ssn") ||
        lk === "input" ||
        lk === "userinput" ||
        lk.endsWith("_input") ||
        lk === "message" ||
        lk === "rawmessage" ||
        lk === "body" ||
        lk === "rawbody" ||
        lk === "payload" ||
        lk.endsWith("_payload")
      ) {
        out[k] = "[redacted]";
        continue;
      }

      if (typeof v === "string") {
        if (/[\w.+-]+@[\w.-]+\.\w{2,}/.test(v)) {
          out[k] = "[redacted]";
          continue;
        }
        if (this.containsPaymentCardNumber(v)) {
          out[k] = "[redacted]";
          continue;
        }
        out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
        continue;
      }

      out[k] = v;
    }
    return out;
  }

  private debugLog(message: string, meta?: Record<string, any>): void {
    if (!this.shouldEmitDebug(meta)) return;
    const safeMeta = meta ? this.sanitizeDebugMeta(meta) : undefined;
    if (safeMeta && Object.keys(safeMeta).length > 0) console.log(message, safeMeta);
    else console.log(message);
  }
  
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

  /**
   * Booking confirmation MUST be explicit.
   *
   * Why: In ChatGPT, the model may reuse a short "yes" across multiple tool calls
   * (e.g., confirming a saved card in Step 3 and then immediately confirming booking in Step 4),
   * which can cause the user to miss the final review/consent step.
   *
   * We therefore require an explicit verb like "book" or "register" for the final consent.
   */
  private isBookingConfirmation(input: string): boolean {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return false;
    const s = raw.replace(/[.!?]+$/g, "").trim();

    return (
      s === "book" ||
      s === "book now" ||
      s === "book it" ||
      s === "register" ||
      s === "register now" ||
      s === "confirm booking" ||
      /^yes[, ]+(book|book now|register|register now|confirm booking)$/.test(s) ||
      s === "i confirm booking"
    );
  }

  private isUserDenial(input: string): boolean {
    const denyPatterns = /^(no|nope|nah|don't|do not|dont|stop|never mind|nevermind|not now|cancel|abort)\.?!?$/i;
    return denyPatterns.test((input || "").trim());
  }

  // ---------------------------------------------------------------------------
  // PCI / App Store compliance: never accept card numbers in chat
  // ---------------------------------------------------------------------------
  private luhnCheck(digits: string): boolean {
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      const c = digits.charCodeAt(i);
      if (c < 48 || c > 57) return false;
      let n = c - 48;
      if (shouldDouble) {
        n = n * 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  private containsPaymentCardNumber(input: string): boolean {
    const s = String(input || "");
    if (!s) return false;

    // Match digit runs possibly separated by spaces or hyphens (common PAN formatting).
    // We then normalize to digits and Luhn-check.
    const candidates = s.match(/[0-9][0-9 \-]{11,30}[0-9]/g) || [];
    for (const cand of candidates) {
      const digits = cand.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) continue;
      if (this.luhnCheck(digits)) return true;
    }
    return false;
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

  private computeAgeYearsFromISODate(isoDate: string): number | null {
    const m = String(isoDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const birthdayThisYear = new Date(Date.UTC(todayUtc.getUTCFullYear(), month - 1, day));
    let age = todayUtc.getUTCFullYear() - year;
    if (todayUtc < birthdayThisYear) age -= 1;
    if (age < 0 || age > 130) return null;
    return age;
  }

  private normalizeDelegateRelationship(rel: string): "parent" | "guardian" | "grandparent" | "other" | null {
    const parsed = this.parseRelationshipFromText(rel);
    return parsed as any;
  }

  private formatStripeCheckoutLinkMessage(url: string): string {
    return (
      `💳 **Secure Stripe Checkout**\n` +
      `Please add your payment method using the link below. We never see your card details.\n\n` +
      `🔗 ${url}\n\n` +
      `When you've finished, come back here and type **done**.`
    );
  }

  private resolveDelegateEmailFromContext(context: APIContext): string | undefined {
    const fromPending = context.pendingDelegateInfo?.email;
    const fromForm =
      (context.formData as any)?.delegate_data?.email ||
      (context.formData as any)?.delegate_data?.delegate_email ||
      (context.formData as any)?.delegate?.delegate_email;
    const email = String(fromPending || fromForm || "").trim();
    return email || undefined;
  }

  private fieldLabelForPrompt(group: "delegate" | "participant", rawLabel: string): string {
    const s = String(rawLabel || "").trim() || (group === "delegate" ? "Parent/guardian info" : "Child info");
    const lower = s.toLowerCase();

    // Normalize common phrasing from provider schemas
    let core = s.replace(/^(your|participant|child)\s+/i, "").trim();
    if (lower.includes("email")) core = "email";
    else if (lower.includes("first") && lower.includes("name")) core = "first name";
    else if (lower.includes("last") && lower.includes("name")) core = "last name";
    else if (lower.includes("date of birth") || lower.includes("dob") || lower.includes("birth")) core = "date of birth (MM/DD/YYYY)";
    else if (lower.includes("relationship")) core = "relationship to the child (Parent/Guardian)";

    const prefix = group === "delegate" ? "Parent/guardian" : "Child";
    // Title-case the first letter of the core label for readability.
    const niceCore = core.length ? core[0].toUpperCase() + core.slice(1) : core;
    return `${prefix} ${niceCore}`;
  }

  private formatISODateForPrompt(iso?: string | null): string | null {
    const s = String(iso || "").trim();
    if (!s) return null;
    // Common stored format is YYYY-MM-DD
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return s;
  }

  private looksLikeDelegateChild(
    child: { first_name?: string; last_name?: string; dob?: string | null },
    currentFormData: Record<string, any>
  ): boolean {
    const dFirst = String(currentFormData?.delegate_firstName || "").trim();
    const dLast = String(currentFormData?.delegate_lastName || "").trim();
    const dDobRaw = String(currentFormData?.delegate_dob || "").trim();
    const dDob = this.parseDateFromText(dDobRaw) || dDobRaw;

    const cFirst = String(child?.first_name || "").trim();
    const cLast = String(child?.last_name || "").trim();
    const cDobRaw = String(child?.dob || "").trim();
    const cDob = this.parseDateFromText(cDobRaw) || cDobRaw;

    if (!dFirst || !dLast || !dDob) return false;
    if (!cFirst || !cLast || !cDob) return false;

    return (
      cFirst.toLowerCase() === dFirst.toLowerCase() &&
      cLast.toLowerCase() === dLast.toLowerCase() &&
      cDob.slice(0, 10) === dDob.slice(0, 10)
    );
  }

  /**
   * Historical data hygiene (no DB mutation):
   * Some users ended up with saved child records whose name contains directives like
   * "different child, Percy ..." or embedded DOB fragments. We never want to:
   * - show "different child" in the UI
   * - book using a polluted name
   *
   * This sanitizes the name we use in-session only.
   */
  private sanitizeSavedChildName(first: string, last: string): { first_name: string; last_name: string; display: string } {
    const combined = `${String(first || "")} ${String(last || "")}`.trim();

    let cleaned = combined
      // Strip leading directives like "different child," / "new child:" etc.
      .replace(/^\s*(different|another|new)\s+child\b[\s,:-]*/i, "")
      // Remove embedded DOB fragments (MM/DD[/YYYY] or MM/DD/YY) that sometimes got appended to names.
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "")
      // Remove ISO-ish date fragments.
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
      // Collapse punctuation/spaces.
      .replace(/[,\s]+/g, " ")
      .trim();

    if (!cleaned) cleaned = combined; // fallback: never blank the name

    const parts = cleaned.split(/\s+/).filter(Boolean);
    const first_name = parts[0] || "";
    const last_name = parts.slice(1).join(" ");
    const display = `${first_name} ${last_name}`.trim();

    return { first_name, last_name, display: display || "Saved child" };
  }

  private buildReviewSummaryFromContext(context: APIContext): string {
    const programName =
      context.selectedProgram?.title ||
      context.selectedProgram?.program_name ||
      context.selectedProgram?.name ||
      "Selected program";

    // Try to normalize whatever we have in context.formData into a two-tier structure.
    const fd: any = context.formData || {};
    const delegate =
      (fd && typeof fd === "object" && (fd.delegate_data || fd.delegate)) ||
      (fd?.formData && (fd.formData.delegate || fd.formData.delegate_data)) ||
      {};
    const participantsRaw =
      (fd && typeof fd === "object" && (fd.participant_data || fd.participants)) ||
      (fd?.formData && (fd.formData.participants || fd.formData.participant_data)) ||
      [];
    const participants = Array.isArray(participantsRaw) ? participantsRaw : [participantsRaw].filter(Boolean);
    const participant = participants[0] || {};

    const rawChildName = participant.firstName
      ? `${participant.firstName} ${participant.lastName || ""}`.trim()
      : (context.childInfo?.name || "");
    const childName = rawChildName
      ? this.sanitizeSavedChildName(rawChildName, "").display
      : "your child";
    const childDob = this.formatISODateForPrompt(participant.dob || participant.date_of_birth || context.childInfo?.dob);
    const childDetail = childDob ? ` (DOB: ${childDob})` : (participant.age ? ` (Age: ${participant.age})` : "");

    const parentFirst = String(delegate.delegate_firstName || delegate.firstName || delegate.first_name || "").trim();
    const parentLast = String(delegate.delegate_lastName || delegate.lastName || delegate.last_name || "").trim();
    const parentName = `${parentFirst} ${parentLast}`.trim();
    const parentDob = this.formatISODateForPrompt(delegate.delegate_dob || delegate.date_of_birth || delegate.dob);
    const parentRel = String(delegate.delegate_relationship || delegate.relationship || "").trim();

    const sessionDate = context.selectedProgram?.earliest_slot_time
      ? this.formatTimeForUser(context.selectedProgram.earliest_slot_time, context)
      : null;

    const scheduledIso = context.schedulingData?.scheduled_time;
    const opensAtDisplay = scheduledIso ? this.formatTimeForUser(scheduledIso, context) : null;

    const feeCents = Number(fd?.program_fee_cents ?? context.schedulingData?.program_fee_cents ?? 0);
    const formattedTotal = Number.isFinite(feeCents) && feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : (context.selectedProgram?.price || "TBD");

    let msg = "Please review the details below:\n\n";
    msg += `- **Program:** ${programName}\n`;
    msg += `- **Participant:** ${childName}${childDetail}\n`;
    if (parentName) msg += `- **Parent/Guardian:** ${parentName}\n`;
    if (parentRel) msg += `- **Relationship:** ${parentRel}\n`;
    if (parentDob) msg += `- **Parent DOB:** ${parentDob}\n`;
    if (sessionDate) msg += `- **Date:** ${sessionDate}\n`;
    if (opensAtDisplay) {
      msg += `- **Registration opens:** ${opensAtDisplay}\n`;
      msg += `- **Set & forget:** We’ll register you the moment it opens.\n`;
      msg += `- **Charges now:** $0.00 (no charges unless registration succeeds)\n`;
    }
    msg += opensAtDisplay
      ? `- **Program Fee:** ${formattedTotal} (paid to provider only if we successfully register you when it opens)\n`
      : `- **Program Fee:** ${formattedTotal} (paid to provider only if booking succeeds)\n`;
    msg += opensAtDisplay
      ? `- **SignupAssist Fee:** $20 (charged only if we successfully register you when it opens)\n`
      : `- **SignupAssist Fee:** $20 (charged only upon successful registration)\n`;

    if (context.hasPaymentMethod || context.cardLast4) {
      const display = context.cardLast4 ? `${context.cardBrand || "Card"} •••• ${context.cardLast4}` : "Yes";
      msg += `- **Payment method on file:** ${display}\n`;
    }

    msg +=
      "\nIf everything is correct, type **book now** to continue" +
      (opensAtDisplay ? " (I’ll schedule the auto‑registration)" : "") +
      " or **cancel** to abort.";
    return msg;
  }

  private toISODate(year: number, month: number, day: number): string | null {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const y = Math.trunc(year);
    const m = Math.trunc(month);
    const d = Math.trunc(day);
    if (y < 1900 || y > 2100) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;

    // Validate real date (e.g. reject 02/31)
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;

    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  private parseDateFromText(input: string): string | null {
    const s = String(input || "").trim();
    if (!s) return null;

    // YYYY-MM-DD (or YYYY/M/D)
    {
      const m = s.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
      if (m) {
        const iso = this.toISODate(Number(m[1]), Number(m[2]), Number(m[3]));
        if (iso) return iso;
      }
    }

    // M/D/YYYY or M-D-YYYY (accept 2-digit years with century heuristic)
    {
      const m = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
      if (m) {
        const month = Number(m[1]);
        const day = Number(m[2]);
        let year = Number(m[3]);
        if (m[3].length === 2) {
          const now = new Date();
          const two = now.getUTCFullYear() % 100;
          year = year <= two ? 2000 + year : 1900 + year;
        }
        const iso = this.toISODate(year, month, day);
        if (iso) return iso;
      }
    }

    // Month name formats: "June 15, 1984"
    {
      const m = s.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+)(\d{4})\b/i
      );
      if (m) {
        const monthName = m[1].toLowerCase();
        const monthMap: Record<string, number> = {
          jan: 1, january: 1,
          feb: 2, february: 2,
          mar: 3, march: 3,
          apr: 4, april: 4,
          may: 5,
          jun: 6, june: 6,
          jul: 7, july: 7,
          aug: 8, august: 8,
          sep: 9, sept: 9, september: 9,
          oct: 10, october: 10,
          nov: 11, november: 11,
          dec: 12, december: 12,
        };
        const month = monthMap[monthName];
        const day = Number(m[2]);
        const year = Number(m[3]);
        const iso = month ? this.toISODate(year, month, day) : null;
        if (iso) return iso;
      }
    }

    return null;
  }

  private parseRelationshipFromText(input: string): string | null {
    const s = String(input || "").toLowerCase();
    if (!s) return null;

    // Prefer explicit labels if present
    const labeled = s.match(/\brelationship\s*[:=]\s*([a-z\s]+)\b/i)?.[1]?.trim();
    const hay = labeled || s;

    if (/\b(parent|mother|mom|father|dad)\b/.test(hay)) return "parent";
    if (/\b(legal\s+guardian|guardian)\b/.test(hay)) return "guardian";
    if (/\b(grandparent|grandmother|grandma|grandfather|grandpa)\b/.test(hay)) return "grandparent";
    if (/\b(other|aunt|uncle|relative|caregiver)\b/.test(hay)) return "other";

    return null;
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

    const delegateFields = context.requiredFields?.delegate || [];
    const participantFields = context.requiredFields?.participant || [];

    const isEmpty = (v: any) => v == null || (typeof v === "string" && v.trim() === "");

    const needsDelegateFirstName = delegateFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return lk.includes("first") && lk.includes("name") && isEmpty(formData[f.key]);
    });
    const needsDelegateLastName = delegateFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return lk.includes("last") && lk.includes("name") && isEmpty(formData[f.key]);
    });
    const needsDelegateName = needsDelegateFirstName || needsDelegateLastName;
    const needsDelegateDob = delegateFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return (lk.includes("dob") || lk.includes("birth")) && isEmpty(formData[f.key]);
    });
    const needsDelegateRelationship = delegateFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return lk.includes("relationship") && isEmpty(formData[f.key]);
    });

    const needsParticipantFirstName = participantFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return lk.includes("first") && lk.includes("name") && isEmpty(formData[f.key]);
    });
    const needsParticipantLastName = participantFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return lk.includes("last") && lk.includes("name") && isEmpty(formData[f.key]);
    });
    const needsParticipantName = needsParticipantFirstName || needsParticipantLastName;
    const needsParticipantDob = participantFields.some((f) => {
      const lk = String(f.key || "").toLowerCase();
      return (lk.includes("dob") || lk.includes("birth")) && isEmpty(formData[f.key]);
    });

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

    // 3) DOB / relationship (schema-aware)
    const parsedDate = this.parseDateFromText(input);
    const parsedRelationship = this.parseRelationshipFromText(input);
    if (parsedDate) {
      if (needsDelegateDob) {
        context.pendingDelegateInfo = {
          ...(context.pendingDelegateInfo || {}),
          dob: context.pendingDelegateInfo?.dob || parsedDate,
        };
      } else if (needsParticipantDob) {
      context.childInfo = {
          ...(context.childInfo || { name: "" }),
          dob: context.childInfo?.dob || parsedDate,
        };
      }
    }
    if (parsedRelationship && needsDelegateRelationship) {
      context.pendingDelegateInfo = {
        ...(context.pendingDelegateInfo || {}),
        relationship: context.pendingDelegateInfo?.relationship || parsedRelationship,
      };
    }

    // 4) Adult name (delegate) — only when we still need it
    if (needsDelegateName) {
    const adult = this.parseAdultName(input);
    if (adult) {
      context.pendingDelegateInfo = {
        ...(context.pendingDelegateInfo || {}),
        firstName: context.pendingDelegateInfo?.firstName || adult.firstName,
        lastName: context.pendingDelegateInfo?.lastName || adult.lastName,
      };
      }
    }

    // 5) Child info — only when we’re collecting participant fields (and delegate name is already done)
    if (needsParticipantName && !needsDelegateName) {
      const child = this.parseChildInfoFromMessage(input);
      if (child) {
        const firstName = String(child.firstName || child.name?.split(/\s+/)[0] || "").trim();
        const lastName = String(child.lastName || child.name?.split(/\s+/).slice(1).join(" ") || "").trim();
        // Guardrail: if user accidentally repeats their own (delegate) name while we’re asking for child info,
        // don’t auto-accept it as the child unless they included an age (or a DOB elsewhere).
        const dFirst = String(context.pendingDelegateInfo?.firstName || "").trim();
        const dLast = String(context.pendingDelegateInfo?.lastName || "").trim();
        const looksLikeDelegate =
          !child.age &&
          dFirst &&
          dLast &&
          firstName.toLowerCase() === dFirst.toLowerCase() &&
          lastName.toLowerCase() === dLast.toLowerCase();

        if (!looksLikeDelegate) {
          context.childInfo = {
            ...(context.childInfo || { name: "" }),
            name: child.name,
            age: child.age,
            firstName: context.childInfo?.firstName || firstName,
            lastName: context.childInfo?.lastName || lastName,
          };
        }
      }
    }

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
      else if (d.dob && (lk.includes('dob') || lk.includes('birth'))) formData[k] = d.dob;
      else if (d.relationship && lk.includes('relationship')) formData[k] = d.relationship;
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

      if (c?.firstName && (lk.includes('first') && lk.includes('name'))) formData[k] = c.firstName;
      else if (c?.lastName && (lk.includes('last') && lk.includes('name'))) formData[k] = c.lastName;
      else if (c?.name && !lk.includes('first') && !lk.includes('last') && lk.includes('name')) formData[k] = c.name;
      else if (c?.dob && (lk.includes('dob') || lk.includes('birth'))) formData[k] = c.dob;
      else if (typeof c?.age === 'number' && (lk.includes('age') || lk.includes('years'))) formData[k] = c.age;
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
    if (!displayedPrograms || displayedPrograms.length === 0) {
      this.debugLog('[parseProgramSelection] TRACE: No displayed programs to match against');
      return null;
    }
    
    const normalized = input.toLowerCase().trim();
    this.debugLog('[parseProgramSelection] TRACE: Starting parse', {
      inputLen: normalized.length,
      displayedProgramsCount: displayedPrograms.length,
      displayedTitles: displayedPrograms.map(p => p.title).join(', ')
    });
    
    // CONFIRMATION PHRASE DETECTION: When user says "yes" and only 1 program is displayed
    const confirmationPatterns = /^(yes|yep|yeah|yup|sure|ok|okay|do it|go ahead|sign me up|let's do it|let's go|sounds good|book it|register|proceed|continue|absolutely|definitely|i confirm|yes please|that's right|correct|sign up|start signup|start registration)\.?!?$/i;
    if (confirmationPatterns.test(normalized) && displayedPrograms.length === 1) {
      this.debugLog('[parseProgramSelection] TRACE: Confirmation phrase with single program - auto-selecting');
      Logger.info('[NL Parse] Confirmation phrase matched with single program', { 
        source: 'natural_language', 
        input_len: normalized.length,
        matchedTitle: displayedPrograms[0].title 
      });
      return displayedPrograms[0];
    }
    
    // Strip common prefixes from input: "select ", "choose ", "I want ", etc.
    const cleanedInput = normalized
      .replace(/^(select|choose|pick|i want|i'd like|sign up for|register for|book)\s+/i, '')
      .trim();

    // If the user typed a bare number (e.g., "1"), treat it as an ordinal choice.
    // This must run BEFORE title matching, because program titles often contain digits (e.g., ages "7–11"),
    // which can cause accidental matches when cleanedInput is "1".
    if (/^\d+$/.test(cleanedInput)) {
      const n = Number(cleanedInput);
      const idx = Number.isFinite(n) ? n - 1 : -1;
      if (idx >= 0 && idx < displayedPrograms.length) {
        this.debugLog('[parseProgramSelection] TRACE: Matched by bare numeric ordinal', {
          idx,
          matchedTitle: displayedPrograms[idx].title,
          program_ref: displayedPrograms[idx].program_ref
        });
        return displayedPrograms[idx];
      }
    }
    
    // Match by title (fuzzy contains match with improved keyword extraction)
    const titleMatch = displayedPrograms.find(p => {
      const progTitle = (p.title || '').toLowerCase();
      // Never do "contains" title matching for very short inputs like "1" / "2".
      // (Ordinal matching is handled separately above.)
      if (cleanedInput.length < 3) return false;
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
      this.debugLog('[parseProgramSelection] TRACE: Matched by title', { 
        matchedTitle: titleMatch.title,
        program_ref: titleMatch.program_ref
      });
      Logger.info('[NL Parse] Program matched by title', { 
        source: 'natural_language', 
        matchedTitle: titleMatch.title,
        input_len: normalized.length
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
        this.debugLog('[parseProgramSelection] TRACE: Ordinal match attempt', {
          pattern: pattern.source,
          matched,
          idx,
          programsAvailable: displayedPrograms.length
        });
        if (idx >= 0 && idx < displayedPrograms.length) {
          this.debugLog('[parseProgramSelection] TRACE: Matched by ordinal', {
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
    
    this.debugLog('[parseProgramSelection] TRACE: No match found');
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

    // Extract an optional reference token for receipts/audit/cancel flows.
    // Supports:
    // - Full UUID
    // - Short codes like REG-1a2b3c4d / SCH-1a2b3c4d (scheduled)
    // - Bare short hex token (8+) as fallback
    const extractRef = (): string | null => {
      const uuidMatch = normalized.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
      if (uuidMatch) return uuidMatch[0];

      const coded = normalized.match(/\b(reg|registration|sch|scheduled|schedule)[\s\-:#]*([0-9a-f]{6,12})\b/i);
      if (coded) {
        const prefix = coded[1].toLowerCase().startsWith('sch') || coded[1].toLowerCase().startsWith('schedule') ? 'SCH' : 'REG';
        return `${prefix}-${coded[2].toLowerCase()}`;
      }

      const loose = normalized.match(/\b[0-9a-f]{8,12}\b/i);
      return loose ? loose[0].toLowerCase() : null;
    };
    const ref = extractRef();

    // Only treat UUIDs or explicit REG-/SCH- codes as "safe" references.
    // Avoid accidentally interpreting dates/years (e.g. "20251229") as an ID.
    const safeRef = (() => {
      if (!ref) return null;
      const uuidMatch = ref.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      if (uuidMatch) return ref;
      const coded = ref.match(/^(REG|SCH)-[0-9a-f]{6,12}$/i);
      if (coded) return ref;
      // Allow bare short hex refs ONLY if they include at least one hex letter (a-f).
      // This avoids accidentally interpreting dates/years (all digits) as an ID.
      if (/^[0-9a-f]{8,12}$/i.test(ref) && /[a-f]/i.test(ref)) return ref;
      return null;
    })();

    // Text-only v1 shortcuts:
    // - "cancel SCH-xxxx" / "cancel REG-xxxx"
    // - "audit SCH-xxxx" / "audit REG-xxxx"
    if (safeRef) {
      if (/\b(cancel|remove|delete|undo)\b/i.test(normalized)) {
        Logger.info('[NL Parse] Secondary action detected: cancel_registration', { source: 'natural_language', input_len: normalized.length, hasRef: true });
        return { action: 'cancel_registration', payload: { registration_ref: safeRef } };
      }
      if (/\b(audit|trail|history|log|activity)\b/i.test(normalized)) {
        Logger.info('[NL Parse] Secondary action detected: view_audit_trail', { source: 'natural_language', input_len: normalized.length, hasRef: true });
        return { action: 'view_audit_trail', payload: { registration_ref: safeRef } };
      }
    }
    
    // View registrations / receipts / bookings
    if (/\b(show|view|see|list|my)\b.*\b(registrations?|bookings?|receipts?|signups?|enrollments?)\b/i.test(normalized) ||
        /\b(registrations?|bookings?|receipts?)\b.*\b(please|show|view)?\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: view_receipts', { source: 'natural_language', input_len: normalized.length });
      return { action: 'view_receipts' };
    }
    
    // Cancel registration
    if (/\b(cancel|remove|delete|undo)\b.*\b(registration|booking|signup|enrollment)\b/i.test(normalized) ||
        /\b(registration|booking)\b.*\b(cancel|remove)\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: cancel_registration', { source: 'natural_language', input_len: normalized.length, hasRef: !!safeRef });
      return safeRef ? { action: 'cancel_registration', payload: { registration_ref: safeRef } } : { action: 'cancel_registration' };
    }
    
    // View audit trail / history
    if (/\b(audit|trail|history|log|activity)\b/i.test(normalized) && 
        /\b(show|view|see|my)\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: view_audit_trail', { source: 'natural_language', input_len: normalized.length, hasRef: !!safeRef });
      return safeRef ? { action: 'view_audit_trail', payload: { registration_ref: safeRef } } : { action: 'view_audit_trail' };
    }

    // Allow terse commands: "audit" / "audit <id>" / "trail <id>"
    if (/^(audit|trail|history|log|activity)\b/i.test(normalized)) {
      Logger.info('[NL Parse] Secondary action detected: view_audit_trail', { source: 'natural_language', input_len: normalized.length, hasRef: !!safeRef });
      return safeRef ? { action: 'view_audit_trail', payload: { registration_ref: safeRef } } : { action: 'view_audit_trail' };
    }
    
    return null;
  }

  private async resolveRegistrationRef(
    registrationRef: string,
    userId?: string
  ): Promise<{ registration_id?: string; scheduled_registration_id?: string } | null> {
    if (!registrationRef) return null;
    const ref = String(registrationRef).trim();

    const uuidMatch = ref.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    if (uuidMatch) {
      // Could be either table; try registrations first in callers.
      return { registration_id: ref, scheduled_registration_id: ref };
    }

    const coded = ref.match(/^(REG|SCH)-([0-9a-f]{6,12})$/i);
    const token = coded ? coded[2].toLowerCase() : ref.toLowerCase();
    const kind = coded ? coded[1].toUpperCase() : null;

    const supabase = this.getSupabaseClient();

    // Helper: fetch a small recent set of IDs and match locally.
    // This avoids server-side LIKE/ILIKE operators that may not work on UUID columns.
    const fetchRecentIds = async (
      table: 'registrations' | 'scheduled_registrations'
    ): Promise<Array<{ id: string }>> => {
      const run = async (withUser: boolean) => {
        let q = supabase.from(table).select('id').order('created_at', { ascending: false }).limit(100);
        if (withUser && userId) q = q.eq('user_id', userId);
        return await q;
      };

      if (userId) {
        const { data, error } = await run(true);
        if (!error && Array.isArray(data)) return data as any;
        if (error) {
          Logger.warn(`[resolveRegistrationRef] user_id filtered lookup failed for ${table}; retrying without user filter`, {
            table,
            hasUserId: true,
            error: error.message
          });
        }
      }

      const { data, error } = await run(false);
      if (error) {
        Logger.warn(`[resolveRegistrationRef] lookup failed for ${table}`, { table, error: error.message });
        return [];
      }
      return Array.isArray(data) ? (data as any) : [];
    };

    const matchByPrefix = (rows: Array<{ id: string }>) => {
      const t = token.toLowerCase();
      return rows.find((r) => String(r.id).toLowerCase().startsWith(t))?.id || null;
    };

    if (kind === 'SCH') {
      const rows = await fetchRecentIds('scheduled_registrations');
      const id = matchByPrefix(rows);
      return id ? { scheduled_registration_id: id } : null;
    }

    if (kind === 'REG') {
      const rows = await fetchRecentIds('registrations');
      const id = matchByPrefix(rows);
      return id ? { registration_id: id } : null;
    }

    // Unknown kind: try registrations first, then scheduled.
    {
      const regRows = await fetchRecentIds('registrations');
      const regId = matchByPrefix(regRows);
      if (regId) return { registration_id: regId };
    }
    {
      const schRows = await fetchRecentIds('scheduled_registrations');
      const schId = matchByPrefix(schRows);
      if (schId) return { scheduled_registration_id: schId };
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
      Logger.info('[classifyInputType] Tier 3 LLM fallback', { input_len: String(input || '').length });
      
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
    // Prevent "app hangs" if Supabase becomes slow/unreachable.
    // Without a fetch timeout, awaited session persistence can block the entire tool response.
    const timeoutMsRaw = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 8000);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 8000;

    const fetchWithTimeout: typeof fetch = async (input, init) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(input, { ...(init || {}), signal: controller.signal });
      } finally {
        clearTimeout(id);
      }
    };

    return createClient(supabaseUrl, supabaseServiceKey, {
      global: { fetch: fetchWithTimeout }
    });
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
  ): Promise<OrchestratorResponse | null> {
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
      let context = await this.getContextAsync(contextSessionId);

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
      // NOTE: updateContext is immutable (it replaces the stored context object).
      // If we don't refresh `context` here, downstream logic may incorrectly treat
      // the user as anonymous or miss timezone/session updates within the same request.
      let shouldRefreshContext = false;
      if (userId) {
        this.updateContext(contextSessionId, { user_id: userId });
        shouldRefreshContext = true;
        Logger.info('[APIOrchestrator] User authenticated', { userId });
      }

      // Store user timezone in context
      if (userTimezone && userTimezone !== context.userTimezone) {
        this.updateContext(contextSessionId, { userTimezone });
        shouldRefreshContext = true;
      }

      if (shouldRefreshContext) {
        context = this.getContext(contextSessionId);
      }

      // ----------------------------------------------------------------
      // ChatGPT reliability: short-window retry dedupe
      // - prevents accidental double-processing (e.g., booking/cancel twice)
      // - prevents wizardProgress from drifting (causing “continued” on first visible turn)
      // ----------------------------------------------------------------
      const dedupeKey = this.buildRetryDedupeKey(action, payload, input);
      const cache = context.lastReplyCache;
      if (cache?.key === dedupeKey && cache?.response?.message) {
        const atMs = Date.parse(String(cache.at || ""));
        const ageMs = Number.isFinite(atMs) ? Date.now() - atMs : NaN;
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < this.getRetryDedupeWindowMs()) {
          const cached = cache.response;
          const cachedResp: OrchestratorResponse = {
            message: cached.message,
            cards: cached.cards,
            cta: cached.cta,
            step: cached.step,
            metadata: { ...(cached.metadata || {}), skipWizardProgress: true }
          };
          return this.attachContextSnapshot(cachedResp, contextSessionId);
        }
      }

      let response: OrchestratorResponse | null;

      // Handle explicit actions (button clicks)
      if (action) {
        response = await this.handleAction(action, payload, contextSessionId, context, input);
      } else {
        // Handle natural language messages
        response = await this.handleMessage(input, contextSessionId, context);
      }

      if (!response) return null;

      const final = this.attachContextSnapshot(response, contextSessionId);
      // Cache the final response for fast retry replay (store only the user-facing response, no context snapshot).
      try {
        this.updateContext(contextSessionId, {
          lastReplyCache: {
            key: dedupeKey,
            at: new Date().toISOString(),
            response: {
              message: final.message,
              step: final.step,
              metadata: final.metadata,
              cards: final.cards,
              cta: final.cta
            }
          }
        });
      } catch {
        // ignore
      }

      return final;
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
      // NOTE: authorize_payment is handled inside the authorize_payment case
      // to support ChatGPT legacy actions from REVIEW (confirm_booking → authorize_payment).
    };
    const requiredStep = STEP_REQUIREMENTS[resolvedAction];
    if (requiredStep && context.step !== requiredStep) {
      Logger.warn(`[${resolvedAction}] ⛔ STEP GATE: Not in ${requiredStep} step`, { currentStep: context.step });
      // ChatGPT sometimes sends stale/incorrect actions (e.g., answer_questions → submit_form)
      // even after the session has advanced (REVIEW/PAYMENT). Recover by treating it as NL input.
      if (resolvedAction === 'submit_form' && typeof input === 'string' && input.trim().length > 0) {
        const recovered = await this.handleMessage(input, sessionId, context);
        if (recovered) return recovered;
      }

      return this.formatResponse(
        `We need to collect some information first before I can continue.`,
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
          wizardProgress: undefined,
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
          const inputText = typeof input === "string" ? input : "";
          // Chat-native directive: allow users to say "different child, <name>, <dob>".
          // Strip the directive before hydration so it doesn't become part of the child's name.
          const normalizedInputText = inputText
            .replace(/^\s*(?:different|another|new)\s+(?:child|kid)\b\s*[:,]?\s*/i, "")
            .trim();

          // -------------------------------------------------------------------
          // Returning-user UX: if we asked the user to pick from saved children,
          // accept a simple numeric selection and hydrate participant fields.
          // -------------------------------------------------------------------
          if (
            context.awaitingChildSelection &&
            inputText.trim().length > 0 &&
            Array.isArray(context.savedChildren) &&
            context.savedChildren.length > 0
          ) {
            const m = inputText.trim().match(/\b(\d{1,2})\b/);
            const n = m ? Number(m[1]) : NaN;
            const idx = Number.isFinite(n) ? n - 1 : -1;
            const chosen = idx >= 0 && idx < context.savedChildren.length ? context.savedChildren[idx] : null;

            if (chosen) {
              const updated: Record<string, any> = { ...(context.formData || {}) };
              const participantFields = (context.requiredFields?.participant || []).filter((f: any) => f?.required);
              for (const f of participantFields) {
                const k = String(f.key || "");
                const lk = k.toLowerCase();
                if (updated[k] != null && String(updated[k]).trim() !== "") continue;
                if (chosen.first_name && lk.includes("first") && lk.includes("name")) updated[k] = chosen.first_name;
                else if (chosen.last_name && lk.includes("last") && lk.includes("name")) updated[k] = chosen.last_name;
                else if (chosen.dob && (lk.includes("dob") || lk.includes("birth"))) updated[k] = chosen.dob;
              }

              context.childInfo = {
                name: `${chosen.first_name} ${chosen.last_name}`.trim(),
                firstName: chosen.first_name,
                lastName: chosen.last_name,
                dob: chosen.dob || undefined,
              };
              context.formData = updated;

              this.updateContext(sessionId, {
                awaitingChildSelection: false,
                childInfo: context.childInfo,
                formData: updated,
              });
            }
          }

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
            const hydrated = this.hydrateFormDataFromText(normalizedInputText || inputText, context);
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
          let current = context.formData || {};
          if (!this.hasAllRequiredFields(context, current)) {
            // Returning-user UX: prefill delegate fields from saved profile once per session.
            if (context.user_id && !context.delegatePrefillAttempted) {
              try {
                const profileRes = await this.invokeMCPTool("user.get_delegate_profile", { user_id: context.user_id });
                const p = profileRes?.data?.profile;
                if (p) {
                  const updated: Record<string, any> = { ...(context.formData || {}) };
                  const delegateFields = (context.requiredFields?.delegate || []).filter((f: any) => f?.required);
                  for (const f of delegateFields) {
                    const k = String(f.key || "");
                    const lk = k.toLowerCase();
                    if (updated[k] != null && String(updated[k]).trim() !== "") continue;
                    if (p.first_name && lk.includes("first") && lk.includes("name")) updated[k] = p.first_name;
                    else if (p.last_name && lk.includes("last") && lk.includes("name")) updated[k] = p.last_name;
                    else if (p.date_of_birth && (lk.includes("dob") || lk.includes("birth"))) updated[k] = String(p.date_of_birth);
                    else if (p.default_relationship && lk.includes("relationship")) updated[k] = String(p.default_relationship);
                    else if (p.phone && (lk.includes("phone") || lk.includes("mobile") || lk.includes("cell"))) updated[k] = String(p.phone);
                  }
                  context.formData = updated;
                  this.updateContext(sessionId, { formData: updated });
                  // Keep payload formData in sync so normalization -> submitForm includes prefills.
                  payload = { ...(payload || {}), formData: updated };
                  current = updated;
                }
              } catch {
                // ignore
              } finally {
                context.delegatePrefillAttempted = true;
                this.updateContext(sessionId, { delegatePrefillAttempted: true });
              }
            }

            // Returning-user UX: if participant fields are missing and we have saved children,
            // offer a quick selection instead of asking for first/last/DOB one-by-one.
            const missingParticipantKeys = (context.requiredFields?.participant || [])
              .filter((f: any) => f?.required)
              .map((f: any) => String(f.key))
              .filter((k: string) => current[k] == null || (typeof current[k] === "string" && current[k].trim() === ""));

            if (missingParticipantKeys.length > 0 && context.user_id) {
              // Lazy-load children once per session if not already present
              if (!Array.isArray(context.savedChildren)) {
                try {
                  const listRes = await this.invokeMCPTool("user.list_children", { user_id: context.user_id });
                  const children = Array.isArray(listRes?.data?.children) ? listRes.data.children : [];
                  context.savedChildren = children
                    .map((c: any) => {
                      const rawFirst = String(c.first_name || "");
                      const rawLast = String(c.last_name || "");
                      const sanitized = this.sanitizeSavedChildName(rawFirst, rawLast);
                      return {
                        id: String(c.id),
                        first_name: sanitized.first_name,
                        last_name: sanitized.last_name,
                        dob: c.dob || null,
                      };
                    })
                    // Defensive: don't keep totally-empty names.
                    .filter((c: any) => Boolean(String(c.first_name || "").trim() || String(c.last_name || "").trim()));
                  this.updateContext(sessionId, { savedChildren: context.savedChildren });
                } catch (e) {
                  // Ignore — we can still ask manually.
                }
              }

              const saved = Array.isArray(context.savedChildren) ? context.savedChildren : [];
              const filteredSaved = saved.filter((c: any) => !this.looksLikeDelegateChild(c, current));
              if (filteredSaved.length !== saved.length) {
                // Hide obviously-bad “saved child” records (historical bug: child == delegate).
                // We persist the filtered list so the UX stays consistent across turns.
                context.savedChildren = filteredSaved;
                this.updateContext(sessionId, { savedChildren: filteredSaved });
              }
              const savedEffective = filteredSaved;
              const hasPickedChild = !!(context.childInfo?.firstName || context.childInfo?.name);

              // If exactly one saved child and none selected yet, do NOT silently auto-use it.
              // Show what we will reuse + ask only what's missing (often email), with an easy “different child” path.
              if (savedEffective.length === 1 && !hasPickedChild && !context.declinedSingleSavedChild) {
                const only = savedEffective[0];
                const childName = `${only.first_name} ${only.last_name}`.trim() || "Saved child";
                const childDob = this.formatISODateForPrompt(only.dob || undefined);

                // Derive parent/guardian info from current (prefilled) delegate fields if available.
                const parentFirst = String((current as any).delegate_firstName || "").trim();
                const parentLast = String((current as any).delegate_lastName || "").trim();
                const parentName = `${parentFirst} ${parentLast}`.trim();
                const parentDob = this.formatISODateForPrompt(String((current as any).delegate_dob || "").trim());
                const parentRel = String((current as any).delegate_relationship || "").trim();

                const wantsDifferentChild =
                  /\b(different|another|new)\s+child\b/i.test(inputText) ||
                  /\bnot\s+this\b/i.test(inputText) ||
                  /\bchange\s+child\b/i.test(inputText) ||
                  this.isUserDenial(inputText);

                // If we already asked and the user did NOT request a different child, treat their message as confirmation
                // and prefill participant fields from the saved child.
                if (context.awaitingSingleChildChoice && !wantsDifferentChild) {
                  const updated: Record<string, any> = { ...(context.formData || {}) };
                  const participantFields = (context.requiredFields?.participant || []).filter((f: any) => f?.required);
                  for (const f of participantFields) {
                    const k = String(f.key || "");
                    const lk = k.toLowerCase();
                    if (updated[k] != null && String(updated[k]).trim() !== "") continue;
                    if (only.first_name && lk.includes("first") && lk.includes("name")) updated[k] = only.first_name;
                    else if (only.last_name && lk.includes("last") && lk.includes("name")) updated[k] = only.last_name;
                    else if (only.dob && (lk.includes("dob") || lk.includes("birth"))) updated[k] = only.dob;
                  }

                  context.childInfo = {
                    name: childName,
                    firstName: only.first_name,
                    lastName: only.last_name,
                    dob: only.dob || undefined,
                  };
                  context.formData = updated;
                  this.updateContext(sessionId, {
                    awaitingSingleChildChoice: false,
                    childInfo: context.childInfo,
                    formData: updated,
                  });
                  // Keep payload formData in sync so normalization -> submitForm includes prefills.
                  payload = { ...(payload || {}), formData: updated };
                  current = updated;
                }

                // If the user explicitly wants a different child, stop prompting for the saved one.
                if (wantsDifferentChild) {
                  // Clear any previously hydrated child fields so we don't carry over mistakes.
                  const cleared: Record<string, any> = { ...(context.formData || {}) };
                  for (const f of context.requiredFields?.participant || []) {
                    if (f?.key && cleared[f.key] != null) delete cleared[f.key];
                  }
                  context.childInfo = undefined;
                  context.formData = cleared;
                  context.awaitingSingleChildChoice = false;
                  context.declinedSingleSavedChild = true;
                  this.updateContext(sessionId, {
                    awaitingSingleChildChoice: false,
                    declinedSingleSavedChild: true,
                    childInfo: undefined,
                    formData: cleared,
                  });
                } else if (!context.awaitingSingleChildChoice && !this.hasAllRequiredFields(context, current)) {
                  // First time: show the explicit reuse prompt (fast + transparent).
                  context.awaitingSingleChildChoice = true;
                  this.updateContext(sessionId, { awaitingSingleChildChoice: true });

                  const missingDelegateLabels = (context.requiredFields?.delegate || [])
                    .filter((x: any) => x?.required)
                    .filter((f: any) => current[f.key] == null || (typeof current[f.key] === "string" && current[f.key].trim() === ""))
                    .map((f: any) => this.fieldLabelForPrompt("delegate", f.label || f.key));

                  const stillNeeded = missingDelegateLabels.length
                    ? `Still needed:\n- ${missingDelegateLabels.join("\n- ")}`
                    : `Still needed: nothing else for parent/child info.`;

                  const parentLines: string[] = [];
                  if (parentName) parentLines.push(`- Parent/guardian: ${parentName}`);
                  if (parentRel) parentLines.push(`- Relationship: ${parentRel}`);
                  if (parentDob) parentLines.push(`- Parent DOB: ${parentDob}`);

                  const childLine = childDob ? `- Child: ${childName} (DOB: ${childDob})` : `- Child: ${childName}`;

                  return this.formatResponse(
                    `Step 2/5 — Parent & child info\n\nOn file:\n${childLine}\n${parentLines.length ? parentLines.join("\n") : "- Parent/guardian: (not saved yet)"}\n\n${stillNeeded}\n\nReply with the missing field(s) to use this info. Or reply **different child** and provide the child’s name + DOB.\n\nNext: I’ll confirm your payment method (Stripe), then show a final review before booking.`,
                    undefined,
                    []
                  );
                }
              }

              // If multiple saved children and none selected yet, prompt for selection.
              if (savedEffective.length > 1 && !hasPickedChild) {
                this.updateContext(sessionId, { awaitingChildSelection: true });
                const lines = savedEffective.slice(0, 6).map((c, i) => {
                  const name = `${c.first_name} ${c.last_name}`.trim() || "Saved child";
                  return `${i + 1}. ${name}`;
                });
                return this.formatResponse(
                  `Step 2/5 — Parent & child info\n\nI found ${savedEffective.length} saved participant${savedEffective.length === 1 ? "" : "s"}.\n\n${lines.join("\n")}\n\nReply with a number (e.g., "1"), or type a new child name + DOB.`,
                  undefined,
                  []
                );
              }
            }

            const delegateMissing = (context.requiredFields?.delegate || [])
              .filter((x: any) => x?.required)
              .filter((f: any) => current[f.key] == null || (typeof current[f.key] === "string" && current[f.key].trim() === ""))
              .map((f: any) => ({ group: "delegate" as const, key: f.key, label: this.fieldLabelForPrompt("delegate", f.label || f.key) }));

            const participantMissing = (context.requiredFields?.participant || [])
              .filter((x: any) => x?.required)
              .filter((f: any) => current[f.key] == null || (typeof current[f.key] === "string" && current[f.key].trim() === ""))
              .map((f: any) => ({ group: "participant" as const, key: f.key, label: this.fieldLabelForPrompt("participant", f.label || f.key) }));

            const missingAll = [...delegateMissing, ...participantMissing];

            if (missingAll.length > 0) {
              // Ask parent/guardian fields first, then child fields (less confusing).
              const source = delegateMissing.length > 0 ? delegateMissing : participantMissing;
              // Streamline: ask a few items per turn to reduce back-and-forth, but keep it calm.
              const chunkSize = 3;
              const nextChunk = source.slice(0, chunkSize);
              const remainingCount = Math.max(missingAll.length - nextChunk.length, 0);
              const footer =
                remainingCount > 0
                  ? `After these, I'll ask for the remaining ${remainingCount} item${remainingCount === 1 ? "" : "s"}.`
                  : `That should be everything I need for parent/child info. Next: I’ll confirm your payment method (Stripe), then show a final review before booking.`;
              const groupIntro =
                delegateMissing.length > 0
                  ? `First, for the **parent/guardian (you)**:`
                  : `Now, for the **child**:`;

              return this.formatResponse(
                `Step 2/5 — Parent & child info\n\n${groupIntro}\n- ${nextChunk.map((x) => x.label).join("\n- ")}\n\n${footer}\nReply in one message (commas are fine).`,
                undefined,
                []
              );
            }
          }

          // ✅ We have required fields -> advance flow to PAYMENT (before final review/consent)
          context.step = FlowStep.PAYMENT;
          this.updateContext(sessionId, { step: FlowStep.PAYMENT });
          Logger.info("[submit_form] ✅ Required fields satisfied; advancing to PAYMENT", {
            sessionId,
            formKeys: Object.keys(context.formData || {}),
          });

          // Normalize flat schema-key formData into the two-tier structure expected by submitForm:
          // { delegate: {...}, participants: [{...}], numParticipants }
          if (payload?.formData && typeof payload.formData === "object") {
            const fd: any = payload.formData;
            const alreadyTwoTier =
              (fd && typeof fd === "object" && typeof fd.delegate === "object") ||
              Array.isArray(fd.participants);

            if (!alreadyTwoTier) {
              const delegate: Record<string, any> = {};
              const participant: Record<string, any> = {};
              for (const f of context.requiredFields?.delegate || []) {
                if (fd[f.key] != null) delegate[f.key] = fd[f.key];
              }
              for (const f of context.requiredFields?.participant || []) {
                if (fd[f.key] != null) participant[f.key] = fd[f.key];
              }

              payload = {
                ...payload,
                formData: {
                  delegate,
                  participants: [participant],
                  numParticipants: 1,
                },
              };
            }
          }

          // COPPA / eligibility enforcement (hard gate):
          // Only a parent/legal guardian age 18+ can proceed.
          const twoTier: any = payload?.formData;
          const delegate = twoTier?.delegate || {};
          const relRaw = String(
            delegate?.delegate_relationship ||
              delegate?.relationship ||
              delegate?.default_relationship ||
              ""
          ).trim();
          const rel = relRaw ? this.normalizeDelegateRelationship(relRaw) : null;

          const dobRaw = String(
            delegate?.delegate_dob ||
              delegate?.dob ||
              delegate?.date_of_birth ||
              ""
          ).trim();
          const dobIso = dobRaw ? this.parseDateFromText(dobRaw) : null;
          const ageYears = dobIso ? this.computeAgeYearsFromISODate(dobIso) : null;

          if (!rel || (rel !== "parent" && rel !== "guardian")) {
            return this.formatResponse(
              `To keep this COPPA-compliant, I can only proceed if you're the **parent** or **legal guardian (18+)**.\n\nPlease reply with:\n- Relationship (Parent or Guardian)`,
              undefined,
              []
            );
          }

          if (!dobIso || ageYears == null) {
            return this.formatResponse(
              `To keep this COPPA-compliant, I need to confirm the responsible adult is **18+**.\n\nPlease reply with your date of birth as **MM/DD/YYYY**.`,
              undefined,
              []
            );
          }

          if (ageYears < 18) {
            // Do not proceed; do not persist children/profile.
            this.updateContext(sessionId, { step: FlowStep.BROWSE, selectedProgram: undefined, formData: undefined });
            return this.formatResponse(
              `Sorry — SignupAssist can only be used by a **parent/legal guardian age 18+**.\n\nPlease have a parent/guardian sign in to continue.`,
              undefined,
              []
            );
          }

          // Normalize delegate dob back into payload so downstream storage is consistent.
          if (twoTier?.delegate && typeof twoTier.delegate === "object") {
            twoTier.delegate.delegate_dob = dobIso;
            if (rel) {
              twoTier.delegate.delegate_relationship = rel;
            }
            payload = { ...payload, formData: twoTier };
          }

          // Returning-user UX: persist profile + any new children for future runs (auth only).
          if (context.user_id && payload?.formData && typeof payload.formData === "object") {
            const fd: any = payload.formData;
            payload = { ...payload, saveDelegateProfile: true };

            const existing = Array.isArray(context.savedChildren) ? context.savedChildren : [];
            const participants = Array.isArray(fd.participants) ? fd.participants : [];

            const dFirst = String(fd?.delegate?.delegate_firstName || "").trim();
            const dLast = String(fd?.delegate?.delegate_lastName || "").trim();
            const dDob = String(fd?.delegate?.delegate_dob || "").trim();

            const toSave: Array<{ first_name: string; last_name: string; dob?: string }> = [];
            for (const p of participants) {
              const first = String(p?.firstName || p?.first_name || "").trim();
              const last = String(p?.lastName || p?.last_name || "").trim();
              const dob = String(p?.dob || p?.dateOfBirth || p?.date_of_birth || "").trim();
              if (!first || !last) continue;

              // Guardrail: don’t save a “child” that matches the delegate (common UX mistake).
              const looksLikeDelegate =
                dFirst &&
                dLast &&
                first.toLowerCase() === dFirst.toLowerCase() &&
                last.toLowerCase() === dLast.toLowerCase() &&
                (!dob || !dDob || dob.slice(0, 10) === dDob.slice(0, 10));
              if (looksLikeDelegate) continue;

              const exists = existing.some((c) => {
                const sameName =
                  String(c.first_name || "").toLowerCase() === first.toLowerCase() &&
                  String(c.last_name || "").toLowerCase() === last.toLowerCase();
                const sameDob = dob ? String(c.dob || "").slice(0, 10) === dob.slice(0, 10) : true;
                return sameName && sameDob;
              });
              if (!exists) toSave.push({ first_name: first, last_name: last, ...(dob ? { dob } : {}) });
            }
            if (toSave.length > 0) {
              payload = { ...payload, saveNewChildren: toSave };
            }
          }

          // After collecting registration details, confirm/set up payment BEFORE final review & consent.
          return await this.submitForm(payload, sessionId, context, { nextStep: 'payment' });
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
        // Text-only UX: allow "audit REG-xxxx" / "audit SCH-xxxx"
        if (!payload?.registration_ref && !payload?.registration_id && !payload?.scheduled_registration_id) {
          // If the user asks for "audit trail" without specifying which one, show their registrations list
          // so they can pick a REG-/SCH- code. This avoids a dead-end error message.
          const receipts = await this.viewReceipts({ user_id: context.user_id }, sessionId, context);
          const intro =
            `To view an audit trail, reply with one of the codes below, e.g. **audit REG-xxxxxxxx** (or **audit SCH-xxxxxxxx**).\n\n`;
          return {
            ...receipts,
            message: `${intro}${receipts.message}`,
            // Hint for guardrails: this is a post-signup management view (Step 5/5).
            step: FlowStep.COMPLETED,
          };
        }
        if (payload?.registration_ref && !payload.registration_id && !payload.scheduled_registration_id) {
          const resolved = await this.resolveRegistrationRef(payload.registration_ref, context.user_id);
          if (resolved?.registration_id) payload.registration_id = resolved.registration_id;
          if (resolved?.scheduled_registration_id) payload.scheduled_registration_id = resolved.scheduled_registration_id;
        }
        return await this.viewAuditTrail(payload, sessionId, context);

      case "cancel_registration":
        // Text-only UX: allow "cancel REG-xxxx" / "cancel SCH-xxxx"
        if (payload?.registration_ref && !payload.registration_id && !payload.scheduled_registration_id) {
          const ref = String(payload.registration_ref || "").trim();
          const key = ref.toLowerCase();
          const mapped = context.lastReceiptRefMap?.[key];
          if (mapped) {
            // If the user used SCH- prefix, keep it typed as scheduled; otherwise treat as REG.
            if (/^sch-/i.test(ref)) payload.scheduled_registration_id = mapped;
            else payload.registration_id = mapped;
          } else {
            const resolved = await this.resolveRegistrationRef(payload.registration_ref, context.user_id);
            if (resolved?.registration_id) payload.registration_id = resolved.registration_id;
            if (resolved?.scheduled_registration_id) payload.scheduled_registration_id = resolved.scheduled_registration_id;
          }
        }
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

        // ChatGPT OpenAPI mode bug: it may call legacy `confirm_booking` / `authorize_payment`
        // while we're still in REVIEW. In that case, we *want* the normal NL path to run
        // (generate Stripe Checkout link, move to PAYMENT, etc.).
        if (context.step === FlowStep.REVIEW && typeof input === 'string' && input.trim().length > 0) {
          const recovered = await this.handleMessage(input, sessionId, context);
          if (recovered) return recovered;
        }
        
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
        if (!context.hasPaymentMethod && !context.cardLast4) {
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
  ): Promise<OrchestratorResponse | null> {
    // PCI / compliance: do not allow card numbers in chat (even Stripe test cards).
    // Always route users through Stripe Checkout (hosted) for payment method entry.
    if (this.containsPaymentCardNumber(input)) {
      const msg =
        context.step === FlowStep.PAYMENT
          ? `For security, please don’t share card numbers in chat.\n\nUse the **secure Stripe Checkout link** I sent above to enter your card details (we never see them). When you’re done, come back here and type **done**.`
          : `For security, please don’t share card numbers in chat.\n\nWhen it’s time to add a payment method, I’ll provide a **secure Stripe Checkout link** (we never see your card details).`;
      return this.formatResponse(msg);
    }

    // ChatGPT Apps sometimes call tools with an empty message on connect / refresh.
    // Never "get stuck" on empty input — treat it as "browse programs".
    const trimmed = String(input || "").trim();
    if (!trimmed) {
      // If a consequential flow just completed, ChatGPT may send an empty follow-up call
      // (transport retry / reconnect). Re-send the last confirmation instead of restarting Step 1.
      if (context.lastCompletion?.message) {
        const completedAtMs = Date.parse(context.lastCompletion.completed_at);
        const ageMs = Number.isFinite(completedAtMs) ? Date.now() - completedAtMs : NaN;
        const isRecent = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 2 * 60 * 1000; // 2 minutes
        if (isRecent) {
          const isCancelCompletion =
            context.lastCompletion.kind === "cancel_registration" ||
            context.lastCompletion.kind === "cancel_scheduled";
          const meta = {
            // Receipts/audit/cancel are account-management views; suppress wizard headers on retries.
            ...(isCancelCompletion ? { suppressWizardHeader: true } : {}),
            // Wizard UX: empty-message "connect/refresh" should not count as a user-visible wizard turn.
            skipWizardProgress: true
          };
          return this.formatResponse(
            `${context.lastCompletion.message}\n\nIf you'd like to do something else, say **view my registrations** or **browse classes**.`,
            undefined,
            undefined,
            meta
          );
        }
      }
      const orgRef = context.orgRef || "aim-design";
      this.updateContext(sessionId, {
        orgRef,
        requestedActivity: undefined,
        pendingProviderConfirmation: undefined,
        step: FlowStep.BROWSE,
        // Wizard UX: empty-message "connect/refresh" should not render as "Step 1/5 continued".
        wizardProgress: undefined,
      });
      const resp = await this.searchPrograms(orgRef, sessionId);
      return {
        ...resp,
        metadata: { ...(resp.metadata || {}), skipWizardProgress: true }
      };
    }

    // ChatGPT NL: Check for secondary actions FIRST (view receipts, cancel, audit trail)
    const secondaryAction = this.parseSecondaryAction(input);
    if (secondaryAction) {
      Logger.info('[NL Parse] Secondary action detected at start of handleMessage', {
        source: 'natural_language',
        action: secondaryAction.action,
        input_len: trimmed.length
      });
      return await this.handleAction(secondaryAction.action, secondaryAction.payload || {}, sessionId, context);
    }
    
    // Text-only confirmation for cancellations (ChatGPT has no buttons in v1)
    if (context.pendingCancellation) {
      if (this.isUserConfirmation(input)) {
        const pending = context.pendingCancellation;
        this.updateContext(sessionId, { pendingCancellation: undefined });
        return await this.handleAction(
          'confirm_cancel_registration',
          pending.kind === 'scheduled'
            ? { scheduled_registration_id: pending.scheduled_registration_id }
            : { registration_id: pending.registration_id, is_confirmed: true },
          sessionId,
          context
        );
      }
      if (this.isUserDenial(input)) {
        this.updateContext(sessionId, { pendingCancellation: undefined });
        return this.formatResponse("Okay — I won’t cancel anything. If you want, say “view my registrations” to see options.");
      }
      return this.formatResponse(
        `To confirm cancellation, reply **yes**. To keep it, reply **no**.`,
        undefined,
        []
      );
    }
    
    // Step 2/5: schema-driven form fill (Bookeo required fields).
    // First principles: we must collect ALL required fields before REVIEW.
    // Treat any free-text message in FORM_FILL as "submit_form" so we can hydrate + ask only what's missing.
    if (context.step === FlowStep.FORM_FILL && context.requiredFields) {
      return await this.handleAction("submit_form", {}, sessionId, context, input);
    }
    
    // ============================================================================
    // SESSION STATE RECOVERY: Fix corrupted states from race conditions
    // If we're in FORM_FILL or PAYMENT but missing critical context, reset to BROWSE
    // ============================================================================
    const isInvalidFormFillState = context.step === FlowStep.FORM_FILL && !context.selectedProgram;
    const isInvalidReviewState = context.step === FlowStep.REVIEW && !context.selectedProgram;
    const isInvalidPaymentState = (context.step === FlowStep.PAYMENT || context.step === FlowStep.SUBMIT || context.step === FlowStep.COMPLETED) && !context.selectedProgram;
    
    if (isInvalidFormFillState || isInvalidReviewState || isInvalidPaymentState) {
      this.debugLog('[handleMessage] RECOVERY: Detected invalid session state, resetting to BROWSE', {
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
    // This code attempts to determine whether the user's input is a location-related response.
    // First, it normalizes the input for location extraction (handling fuzzy entries such as "near Chicago").
    // Then, it checks if the normalized input looks like a location and that the current workflow step is BROWSE
    // or there is no selected program, in which case it should be handled as a location.
    const normalizedForLocation = this.normalizeLocationInput(input);
    const shouldHandleAsLocation =
      this.isLocationResponse(normalizedForLocation) &&
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
        step: FlowStep.BROWSE,
        wizardProgress: undefined
      });
      return await this.searchPrograms("aim-design", sessionId);
    }

    // If user says "browse/show/list/anything" and we already have a provider context,
    // list programs now (don't ask follow-ups).
    if (this.isBrowseAllIntent(input) && (context.orgRef || context.pendingProviderConfirmation)) {
      const orgRef = context.orgRef || context.pendingProviderConfirmation?.toLowerCase().replace(/\s+/g, '-') || "aim-design";
      this.updateContext(sessionId, {
        orgRef,
        requestedActivity: undefined,
        pendingProviderConfirmation: undefined,
        step: FlowStep.BROWSE,
        wizardProgress: undefined
      });
      return await this.searchPrograms(orgRef, sessionId);
    }

    // ------------------------------------------------------------------------
    // STREAMLINING: activation/provider-matching is only relevant in Step 1/5 (BROWSE).
    // Once the user is in REVIEW/PAYMENT/SUBMIT, extra matching + profile lookups
    // add latency and can cause repetitive/choppy UX.
    // ------------------------------------------------------------------------
    let storedCity: string | undefined;
    let storedState: string | undefined;
    if (context.step === FlowStep.BROWSE) {
    
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
            step: FlowStep.BROWSE,
            wizardProgress: undefined
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
            step: FlowStep.BROWSE,
            wizardProgress: undefined
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
        this.updateContext(sessionId, { orgRef, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
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
          this.updateContext(sessionId, { orgRef, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // Otherwise keep conservative behavior
        if (context.user_id && !storedCity) {
          return this.askForLocation(confidence.matchedProvider, sessionId);
        }
        return this.showFallbackClarification(confidence.matchedProvider, sessionId);
      }
    }

    // LOW confidence for ANONYMOUS users = usually DON'T ACTIVATE (so we don't annoy).
    // BUT: if we're already in an in-flight flow (program list shown, program selected, etc),
    // we MUST continue even for anonymous users — value-first, sign-in later.
    if (!context.user_id) {
      const hasInFlightFlow =
        context.step !== FlowStep.BROWSE ||
        !!context.selectedProgram ||
        (Array.isArray(context.displayedPrograms) && context.displayedPrograms.length > 0) ||
        !!context.pendingProviderConfirmation;

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

      if (!hasInFlightFlow) {
        // In the ChatGPT Apps surface, the user explicitly chose this app/tool.
        // Returning null here makes the app feel broken ("got stuck"). Instead, provide a safe prompt.
        Logger.info('[handleMessage] LOW confidence + anonymous user = returning safe prompt');
        return this.formatResponse(
          `Tell me what you're looking for (e.g., “robotics for a 10‑year‑old”), or say **browse classes** to see everything.`,
          undefined,
          [{ label: "Browse classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }]
        );
      }

      Logger.info('[handleMessage] Anonymous user but in-flow context — continuing', {
        step: context.step,
        hasDisplayedPrograms: Array.isArray(context.displayedPrograms) && context.displayedPrograms.length > 0,
        hasSelectedProgram: !!context.selectedProgram,
        hasPendingProviderConfirmation: !!context.pendingProviderConfirmation,
      });
    }
    }

    // LOW confidence for AUTHENTICATED users: Context-aware responses based on flow step
    // Also handles ChatGPT NL parsing for form fill and payment steps
    switch (context.step) {
      case FlowStep.COMPLETED:
      case FlowStep.BROWSE: {
        // -------------------------------------------------------------------
        // Post-booking retry safety:
        // ChatGPT can retry the same user message after a long-running booking call.
        // If the user (or model) repeats "book now"/"yes" shortly after completion,
        // re-send the confirmation instead of restarting discovery.
        // -------------------------------------------------------------------
        if (
          context.lastCompletion?.message &&
          (this.isBookingConfirmation(input) || this.isUserConfirmation(input))
        ) {
          const completedAtMs = Date.parse(context.lastCompletion.completed_at);
          const ageMs = Number.isFinite(completedAtMs) ? Date.now() - completedAtMs : NaN;
          const isRecent = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 2 * 60 * 1000; // 2 minutes
          if (isRecent) {
            const isCancelCompletion =
              context.lastCompletion.kind === "cancel_registration" ||
              context.lastCompletion.kind === "cancel_scheduled";

            // For booking completions, ensure the session still reflects completion so Step 5/5 header renders.
            if (context.step !== FlowStep.COMPLETED) {
              this.updateContext(sessionId, { step: FlowStep.COMPLETED });
            }
            return this.formatResponse(
              `${context.lastCompletion.message}\n\nIf you'd like to sign up for another class, say **browse classes**.`,
              undefined,
              undefined,
              // Receipts/audit/cancel are account-management views; suppress wizard headers on retries.
              isCancelCompletion ? { suppressWizardHeader: true } : undefined
            );
          }
        }

        // If user expresses signup/browse intent but we didn't match a specific provider,
        // default to the current org (v1: AIM Design) rather than falling through.
        if (this.hasSignupIntent(input) || this.hasProgramWords(input)) {
          const orgRef = context.orgRef || "aim-design";
          // Wizard UX: treat explicit browse/signup intent as a fresh Step 1 turn (no "continued").
          this.updateContext(sessionId, { orgRef, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // If user says "browse/show/list/anything", list programs now.
        if (this.isBrowseAllIntent(input)) {
          const orgRef = context.orgRef || "aim-design";
          // Wizard UX: explicit "browse" is a fresh Step 1 turn (no "continued").
          this.updateContext(sessionId, { orgRef, requestedActivity: undefined, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
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
          // Wizard UX: treat this as a fresh program list render (no "continued").
          this.updateContext(sessionId, { orgRef, requestedActivity: undefined, pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
          return await this.searchPrograms(orgRef, sessionId);
        }

        // ChatGPT NL: Check for program selection by title or ordinal
        if (context.displayedPrograms?.length) {
          const selectedProgram = this.parseProgramSelection(input, context.displayedPrograms);
          if (selectedProgram) {
            Logger.info('[NL Parse] Auto-selecting program from NL input', {
              source: 'natural_language',
              program_ref: selectedProgram.program_ref,
              input_len: String(input || '').trim().length
            });
            return await this.selectProgram({
              program_ref: selectedProgram.program_ref,
              program_name: selectedProgram.title,
              program_data: selectedProgram.program_data
            }, sessionId, context);
          }
        }

        // If a program list is on screen, but the user replied with something that isn't a valid
        // selection (common in ChatGPT preview when the model asks an extra question like “age”),
        // don't fall back to a generic “what are you looking for?” prompt. Keep the user in-flow.
        if (Array.isArray(context.displayedPrograms) && context.displayedPrograms.length > 0) {
          const n = context.displayedPrograms.length;
          const trimmed = String(input || "").trim();
          const m = trimmed.match(/^(\d{1,2})$/);
          if (m) {
            const maybeAge = Number(m[1]);
            // If it's not a valid ordinal selection (1..n), treat it as likely child age and
            // ask the user to pick a class. This avoids the “Step 1 restart” feeling.
            if (Number.isFinite(maybeAge) && (maybeAge < 1 || maybeAge > n)) {
              this.updateContext(sessionId, {
                childInfo: { ...(context.childInfo || { name: "" }), age: maybeAge }
              });
              const options = context.displayedPrograms
                .slice(0, Math.min(n, 10))
                .map((p, idx) => `${idx + 1}. ${p.title}`)
                .join("\n");
              return this.formatResponse(
                `Got it — **age ${maybeAge}**.\n\nHere are the options again:\n${options}\n\nNow pick a class: reply with **1-${n}** (or type the program name).`
              );
            }
          }

          const options = context.displayedPrograms
            .slice(0, Math.min(n, 10))
            .map((p, idx) => `${idx + 1}. ${p.title}`)
            .join("\n");
          return this.formatResponse(
            `Here are the options again:\n${options}\n\nPlease reply with a class number **1-${n}** (or type the program name).`
          );
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

        // Safe fallback in browse step: ask for intent instead of "getting stuck".
        return this.formatResponse(
          `Tell me what you're looking for (e.g., “robotics for a 10‑year‑old”), or say **browse classes** to see everything.`,
          undefined,
          [{ label: "Browse classes", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
        );
      }
      
      case FlowStep.FORM_FILL: {
        // ChatGPT NL: Multi-participant flow - check for "done" indicator first
        if (this.isDoneIndicator(input) && context.pendingParticipants?.length) {
          Logger.info('[NL Parse] Done indicator detected - submitting with pending participants', {
            source: 'natural_language',
            participantCount: context.pendingParticipants.length,
            input_len: String(input || '').trim().length
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
          }, sessionId, context, { nextStep: 'payment' });
        }
        
        // ChatGPT NL: Try to parse multiple children from natural language
        const parsedChildren = this.parseMultipleChildrenFromMessage(input);
        if (parsedChildren.length > 0) {
          Logger.info('[NL Parse] Child info extracted from NL input', {
            source: 'natural_language',
            parsedCount: parsedChildren.length,
            input_len: String(input || '').trim().length
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
            Logger.info('[NL Parse] Implicit done indicator detected', { source: 'natural_language', input_len: String(input || '').trim().length });
            
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
            }, sessionId, context, { nextStep: 'payment' });
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
        // Ensure the user always sees a full review summary before we accept consent.
        if (!context.reviewSummaryShown) {
          const summary = this.buildReviewSummaryFromContext(context);
          this.updateContext(sessionId, { reviewSummaryShown: true });
          return this.formatResponse(summary);
        }

        // Await user confirmation of details
        if (this.isBookingConfirmation(input)) {
          Logger.info('[Review] User confirmed details', {
            hasCardOnFile: !!(context.hasPaymentMethod || context.cardLast4),
            futureBooking: !!context.schedulingData
          });
          if (!context.hasPaymentMethod && !context.cardLast4) {
            Logger.info('[Review] No saved card on file – initiating Stripe Checkout');
            const userEmail = this.resolveDelegateEmailFromContext(context);
            const userId = context.user_id;
            try {
              if (!userId) {
                return this.formatError("Missing user identity for payment setup. Please sign in again.");
              }
              if (!userEmail) {
                return this.formatResponse(
                  `To set up payment, please share the parent/guardian email address.`,
                  undefined,
                  []
                );
              }
              const base =
                (process.env.RAILWAY_PUBLIC_DOMAIN
                  ? (process.env.RAILWAY_PUBLIC_DOMAIN.startsWith('http')
                      ? process.env.RAILWAY_PUBLIC_DOMAIN
                      : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
                  : 'https://signupassist.shipworx.ai');

              const sessionRes = await this.invokeMCPTool('stripe.create_checkout_session', {
                user_id: userId,
                user_email: userEmail,
                success_url: `${base}/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${base}/stripe_return?payment_setup=canceled`
              });
              if (!sessionRes.success || !sessionRes.data?.url) {
                throw new Error(sessionRes.error?.message || "Unknown error");
              }
              // Advance to PAYMENT step awaiting verification
              this.updateContext(sessionId, {
                step: FlowStep.PAYMENT,
                hasPaymentMethod: false,
                stripeCheckoutUrl: sessionRes.data.url,
                stripeCheckoutSessionId: sessionRes.data.session_id,
                stripeCheckoutCreatedAt: new Date().toISOString(),
              });
              const stripeUrl = sessionRes.data.url;
              return this.formatResponse(this.formatStripeCheckoutLinkMessage(stripeUrl));
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
        // If the user types a generic "yes" here, do NOT book — but ALWAYS re-show the full summary
        // so the user can see the details (class/date/fees) even if a previous summary message was
        // dropped/duplicated by ChatGPT transport retries.
        if (this.isUserConfirmation(input)) {
          const summary = this.buildReviewSummaryFromContext(context);
          return this.formatResponse(
            `${summary}\n\n(For final consent, please type **book now** — we don’t accept a generic “yes” here.)`
          );
        }
        if (/cancel/i.test(input.trim())) {
          Logger.info('[Review] User cancelled during review');
          // Reset context for safety
          this.updateContext(sessionId, { step: FlowStep.BROWSE, selectedProgram: undefined });
          return this.formatResponse("Okay, I've canceled that signup. Let me know if you need help with anything else.");
        }
        // If user says something else, treat it as edits: rehydrate via submit_form and re-render summary.
        this.updateContext(sessionId, { reviewSummaryShown: false });
        return await this.handleAction("submit_form", {}, sessionId, context, input);
      }

      case FlowStep.PAYMENT: {
        const hasCardOnFile = !!(context.hasPaymentMethod || context.cardLast4);

        // If user wants to change the payment method, always (re)send Stripe link.
        if (/\b(change|update|different)\s+(card|payment)\b/i.test(input.trim())) {
          // If we already generated a link, re-send it.
          if (context.stripeCheckoutUrl) {
            return this.formatResponse(this.formatStripeCheckoutLinkMessage(context.stripeCheckoutUrl));
          }

          // Otherwise, generate a new Stripe Checkout session (even if a card is already on file).
          const userId = context.user_id;
          const userEmail = this.resolveDelegateEmailFromContext(context);
          if (!userId) return this.formatError("Missing user identity for payment setup. Please sign in again.");
          if (!userEmail) {
            return this.formatResponse(`To set up payment, please share the parent/guardian email address.`);
          }

          try {
            const base =
              (process.env.RAILWAY_PUBLIC_DOMAIN
                ? (process.env.RAILWAY_PUBLIC_DOMAIN.startsWith('http')
                    ? process.env.RAILWAY_PUBLIC_DOMAIN
                    : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
                : 'https://signupassist.shipworx.ai');

            const sessionRes = await this.invokeMCPTool('stripe.create_checkout_session', {
              user_id: userId,
              user_email: userEmail,
              success_url: `${base}/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${base}/stripe_return?payment_setup=canceled`
            });
            if (!sessionRes.success || !sessionRes.data?.url) {
              throw new Error(sessionRes.error?.message || "Unknown error");
            }

            this.updateContext(sessionId, {
              stripeCheckoutUrl: sessionRes.data.url,
              stripeCheckoutSessionId: sessionRes.data.session_id,
              stripeCheckoutCreatedAt: new Date().toISOString(),
            });

            return this.formatResponse(this.formatStripeCheckoutLinkMessage(sessionRes.data.url));
          } catch (e) {
            Logger.error("[stripe] Checkout session creation failed (change card):", e);
            return this.formatError("Failed to start payment setup. Please try again.");
          }
        }

        // Detect if user indicates they've added/updated a payment method (e.g., "done", "finished", "added my card")
        const trimmedPaymentInput = input.trim();
        const indicatesPaymentDone =
          this.isDoneIndicator(trimmedPaymentInput) ||
          /\b(done|finished|complete|completed|all\s+set)\b/i.test(trimmedPaymentInput) ||
          (/\b(added|updated|changed)\b/i.test(trimmedPaymentInput) && /\b(card|payment)\b/i.test(trimmedPaymentInput));
        if (indicatesPaymentDone) {
          Logger.info('[Payment] User indicates payment method setup is done, checking status...');
          if (context.user_id) {
            const checkRes = await this.invokeMCPTool('stripe.check_payment_status', { user_id: context.user_id });
            if (checkRes.success && checkRes.data?.hasPaymentMethod) {
              const { last4, brand } = checkRes.data;
              // After payment method is confirmed, proceed to REVIEW (final consent).
              this.updateContext(sessionId, {
                hasPaymentMethod: true,
                cardLast4: last4,
                cardBrand: brand,
                step: FlowStep.REVIEW,
                // We're about to include the full review summary in this response.
                reviewSummaryShown: true,
              });
              const display =
                brand && last4 ? `${brand} •••• ${last4}` : last4 ? `Card •••• ${last4}` : 'payment method on file';
              // Immediately show the final review summary (so the user sees exactly what they'll approve).
              const refreshed = this.getContext(sessionId);
              return this.formatResponse(
                `✅ Payment method saved (${display}).\n\n${this.buildReviewSummaryFromContext(refreshed)}`
              );
            }
          }
          return this.formatResponse("I haven't detected a new payment method yet. If you've completed the Stripe form, please wait a moment and type \"done\" again.");
        }

        // If there is NO card on file, we should keep re-sending the Stripe link (not asking for “yes”).
        if (!hasCardOnFile) {
          // If we already generated a link, re-send it.
          if (context.stripeCheckoutUrl) {
            return this.formatResponse(this.formatStripeCheckoutLinkMessage(context.stripeCheckoutUrl));
          }

          // Otherwise, generate a new Stripe Checkout session and store it for re-send.
          const userId = context.user_id;
          const userEmail = this.resolveDelegateEmailFromContext(context);
          if (!userId) return this.formatError("Missing user identity for payment setup. Please sign in again.");
          if (!userEmail) {
            return this.formatResponse(`To set up payment, please share the parent/guardian email address.`);
          }

          try {
            const base =
              (process.env.RAILWAY_PUBLIC_DOMAIN
                ? (process.env.RAILWAY_PUBLIC_DOMAIN.startsWith('http')
                    ? process.env.RAILWAY_PUBLIC_DOMAIN
                    : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
                : 'https://signupassist.shipworx.ai');

            const sessionRes = await this.invokeMCPTool('stripe.create_checkout_session', {
              user_id: userId,
              user_email: userEmail,
              success_url: `${base}/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${base}/stripe_return?payment_setup=canceled`
            });
            if (!sessionRes.success || !sessionRes.data?.url) {
              throw new Error(sessionRes.error?.message || "Unknown error");
            }

            this.updateContext(sessionId, {
              stripeCheckoutUrl: sessionRes.data.url,
              stripeCheckoutSessionId: sessionRes.data.session_id,
              stripeCheckoutCreatedAt: new Date().toISOString(),
            });

            return this.formatResponse(this.formatStripeCheckoutLinkMessage(sessionRes.data.url));
          } catch (e) {
            Logger.error("[stripe] Checkout session creation failed (payment step):", e);
            return this.formatError("Failed to start payment setup. Please try again.");
          }
        }

        // Card IS on file — confirm we can proceed to the final review step (not booking yet).
        if (this.isUserConfirmation(input)) {
          // We are about to show the full summary now, so mark it as shown to avoid requiring "yes" twice.
          this.updateContext(sessionId, { step: FlowStep.REVIEW, reviewSummaryShown: true });
          const refreshed = this.getContext(sessionId);
          return this.formatResponse(this.buildReviewSummaryFromContext(refreshed));
        }

        // Show which card is on file so the user can verify it (first-principles UX + consent clarity).
        let display =
          context.cardBrand && context.cardLast4
            ? `${context.cardBrand} •••• ${context.cardLast4}`
            : context.cardLast4
              ? `Card •••• ${context.cardLast4}`
              : "";

        // If we know a card exists but don't have display details yet, fetch once from source-of-truth.
        if (!display && context.user_id && context.hasPaymentMethod) {
          const checkRes = await this.invokeMCPTool("stripe.check_payment_status", { user_id: context.user_id });
          if (checkRes.success && checkRes.data?.hasPaymentMethod) {
            const { last4, brand } = checkRes.data;
            this.updateContext(sessionId, {
              hasPaymentMethod: true,
              cardLast4: last4,
              cardBrand: brand,
            });
            display =
              brand && last4 ? `${brand} •••• ${last4}` : last4 ? `Card •••• ${last4}` : "payment method on file";
          }
        }

        const displayText = display || "payment method on file";
        return this.formatResponse(
          `I found a payment method on file: **${displayText}**.\n\nReply **yes** to use it, or reply **change card** to add a new one in Stripe.`
        );
      }

      case FlowStep.SUBMIT: {
        // ChatGPT (and/or Railway multi-instance) can retry calls while we're finalizing a booking.
        // Never fall through to the low-confidence default "unsupported" messaging from this step.
        const buttons = context.user_id
          ? [{ label: "View My Registrations", action: "view_receipts", payload: { user_id: context.user_id }, variant: "accent" as const }]
          : [];
        return this.formatResponse(
          `I'm finishing your registration now. If you just typed **yes**, it can take a moment.\n\nIf you don't see a confirmation, say **view my registrations**.`,
          undefined,
          buttons
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

    // Defensive fallback: if a code path falls through without returning.
    // Never return a generic error for end users; provide a safe recovery prompt.
    Logger.warn('[handleMessage] Fell through without response; returning safe recovery prompt', {
      step: context.step,
    });
    return this.formatResponse(
      `Tell me what you're trying to do, or say **browse classes** to start over.`,
      undefined,
      [{ label: "Browse classes", action: "search_programs", payload: { orgRef: context.orgRef || "aim-design" }, variant: "accent" }]
    );
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
    this.updateContext(sessionId, { pendingProviderConfirmation: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
    
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
    this.updateContext(sessionId, { step: FlowStep.BROWSE, wizardProgress: undefined });
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
    this.updateContext(sessionId, { step: FlowStep.BROWSE, wizardProgress: undefined });
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
    this.updateContext(sessionId, { requestedActivity: undefined, step: FlowStep.BROWSE, wizardProgress: undefined });
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
      orgRef: payload.orgRef,
      step: FlowStep.BROWSE,
      wizardProgress: undefined
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
      // Wizard UX: program list renders should start fresh (avoid "Step 1/5 continued" due to stale counters).
      this.updateContext(sessionId, { wizardProgress: undefined });
      Logger.info(`Searching programs for org: ${orgRef}`);

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

      // Hard filter: remove deprecated SkiClubPro remnants.
      // IMPORTANT: Do NOT filter by title keywords (e.g., "ski") because Bookeo may legitimately
      // host classes with those words (and we still want to show them).
      programs = programs.filter((p: any) => {
        const providerRef = (p.provider_ref || p.org_ref || "").toLowerCase();
        return !providerRef.includes("skiclubpro");
      });

      // Do NOT filter by requestedActivity; always show all programs for the org.
      // We rely on the user selecting from the full list (AIM Design currently has 4).
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
      
      // Catalog posture: show the full program list returned by Bookeo (do not drop items).
      // We still label/disable items whose next session has already passed.
      // This avoids “only 3 of 4 classes” when the cached feed is slightly stale around start times.
      const programsToDisplay = sortedPrograms.slice(0, 8);
      if (programsToDisplay.length === 0) {
        return this.formatError("No programs found at this time.");
      }
      
      // Activity filtering removed: always surface the full catalog for AIM Design/Bookeo.
      // (requestedActivity is still tracked for analytics but no longer used to trim results)

      // Audience mismatch check using the shared audienceParser utility
      if (context.requestedAdults && !context.ignoreAudienceMismatch) {
        const mismatch = checkAudienceMismatch(
          programsToDisplay.map((p: any) => ({
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
          available_slots: prog.available_slots,
          next_available_slot: prog.next_available_slot,
          booking_limits: prog.booking_limits,
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
        // Clear stale selection/form/payment state in the SAME persisted write as displayedPrograms.
        // This prevents late background persists from overwriting newer state (multi-instance Railway).
        selectedProgram: null,
        formData: undefined,
        schedulingData: undefined,
        paymentAuthorized: false,
        requiredFields: undefined,
        pendingParticipants: undefined,
        pendingDelegateInfo: undefined,
        awaitingDelegateEmail: false,
        childInfo: undefined,
        displayedPrograms, // For ChatGPT NL program selection by title/ordinal
        pendingProviderConfirmation: undefined, // Clear any pending confirmation
      });

      // Build program cards with timing badges and cleaned descriptions
      // IMPORTANT: Use same programsToDisplay slice to ensure consistency with displayedPrograms
      const cards: CardSpec[] = programsToDisplay.map((prog: any, index: number) => {
        // Determine booking status at runtime (don't trust stale cached data)
        // Bookeo nuance: booking can be closed even if slots exist (maxAdvanceTime window not open yet).
        const now = new Date();
        const hasAvailableSlots = prog.next_available_slot || (prog.available_slots && prog.available_slots > 0);
        const isSoldOut = prog.booking_status === 'sold_out';

        const slotStart = prog.earliest_slot_time ? new Date(prog.earliest_slot_time) : null;
        const isPast =
          slotStart && Number.isFinite(slotStart.getTime()) && slotStart.getTime() < (now.getTime() - 5 * 60 * 1000);
        const maxAdvance = prog.booking_limits?.maxAdvanceTime;
        const computedOpensAt =
          slotStart && maxAdvance
            ? new Date(slotStart.getTime() - maxAdvance.amount * this.getMilliseconds(maxAdvance.unit))
            : (prog.booking_opens_at ? new Date(prog.booking_opens_at) : null);

        const bookingStatus: string = (() => {
          const raw = String(prog.booking_status || "").toLowerCase().trim();
          if (isPast) return 'closed';
          if (isSoldOut || raw === 'sold_out') return 'sold_out';
          // First principles: trust explicit provider classification when present.
          if (raw === 'open_now' || raw === 'open') return 'open_now';
          if (hasAvailableSlots) return 'open_now';
          if (raw === 'opens_later' || raw === 'coming_soon') return 'opens_later';
          if (computedOpensAt && computedOpensAt > now) return 'opens_later';
          return raw || 'open_now';
        })();

        // Use slot start for "class date", and computedOpensAt for "registration opens"
        const classDate = slotStart;
        
        // Generate timing badge
        let timingBadge = '';
        let isDisabled = false;
        let buttonLabel = "Select this program";
        
        if (bookingStatus === 'closed') {
          timingBadge = '⛔ Registration Closed';
          isDisabled = true;
          buttonLabel = "Not available";
        } else if (bookingStatus === 'sold_out') {
          timingBadge = '🚫 Sold Out';
          isDisabled = true;
          buttonLabel = "Waitlist (Coming Soon)";
        } else if (bookingStatus === 'opens_later') {
          if (computedOpensAt) {
            timingBadge = `📅 Registration opens ${this.formatTimeForUser(computedOpensAt, context)}`;
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
                  available_slots: prog.available_slots,
                  next_available_slot: prog.next_available_slot,
                  booking_limits: prog.booking_limits,
                  booking_status: bookingStatus,
                  earliest_slot_time: prog.earliest_slot_time,
                  booking_opens_at: computedOpensAt ? computedOpensAt.toISOString() : prog.booking_opens_at,
                  first_available_event_id: prog.first_available_event_id || null
                }
              },
              variant: buttonVariant,
              disabled: isDisabled
            }
          ]
        };
      });

      // Build program list for inline text display in native ChatGPT.
      // IMPORTANT: use the SAME slice as displayedPrograms (programsToDisplay) so numeric selection (1..N) is consistent.
      const programListForMessage = programsToDisplay.map((prog: any, idx: number) => {
        const now = new Date();
        const hasAvailableSlots = prog.next_available_slot || (prog.available_slots && prog.available_slots > 0);
        const isSoldOut = prog.booking_status === 'sold_out';

        const slotStart = prog.earliest_slot_time ? new Date(prog.earliest_slot_time) : null;
        const isPast =
          slotStart && Number.isFinite(slotStart.getTime()) && slotStart.getTime() < (now.getTime() - 5 * 60 * 1000);
        const maxAdvance = prog.booking_limits?.maxAdvanceTime;
        const computedOpensAt =
          slotStart && maxAdvance
            ? new Date(slotStart.getTime() - maxAdvance.amount * this.getMilliseconds(maxAdvance.unit))
            : (prog.booking_opens_at ? new Date(prog.booking_opens_at) : null);

        const bookingStatus: 'open_now' | 'opens_later' | 'sold_out' | 'unknown' = (() => {
          if (isPast) return 'closed' as any;
          if (isSoldOut) return 'sold_out';
          if (hasAvailableSlots) return 'open_now';
          if (computedOpensAt && computedOpensAt > now) return 'opens_later';
          return (prog.booking_status as any) || 'unknown';
        })();

        const schedule = slotStart ? this.formatTimeForUser(slotStart, context) : prog.schedule;
        const opensAtDisplay =
          bookingStatus === 'opens_later' && computedOpensAt
            ? this.formatTimeForUser(computedOpensAt, context)
            : undefined;
        
        return {
          index: idx + 1,
          title: prog.title || "Untitled",
          description: stripHtml(prog.description || ""),
          price: prog.price,
          schedule,
          status: bookingStatus,
          opens_at: opensAtDisplay,
        };
      });

      // Use Design DNA-compliant message template with inline program list
      const message = getAPIProgramsReadyMessage({
        provider_name: orgRef === "aim-design" ? "AIM Design" : orgRef,
        program_count: programsToDisplay.length,
        programs: programListForMessage
      });

      const orchestratorResponse: OrchestratorResponse = {
        message,
        // V1 chat-only: don't return cards unless widget mode is explicitly enabled
        ...(WIDGET_ENABLED ? { cards } : {}),
        metadata: {
          // Keep metadata minimal; no widget component routing in v1
          orgRef,
          programCount: programsToDisplay.length,
          _build: APIOrchestrator.BUILD_STAMP
        },
        // Keep structuredContent for model reasoning (works great without widgets)
        structuredContent: {
          type: 'program_list',
          orgRef,
          programCount: programsToDisplay.length,
          programs: programListForMessage.map(p => ({
            index: p.index,
            title: p.title,
            price: p.price,
            status: p.status
          }))
        }
        // NOTE: no _meta in v1 (widget-only metadata removed)
      };

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
    
    this.debugLog('[selectProgram] TRACE: start', {
      sessionId,
      inputLen: String(input || '').trim().length,
      payloadKeys: Object.keys(payload || {}),
      step: context.step,
      hasSelectedProgram: !!context.selectedProgram,
      displayedProgramsCount: context.displayedPrograms?.length || 0,
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
      this.debugLog('[selectProgram] TRACE: RECOVERY L-1 auto-selecting single displayed program', {
        sessionId,
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
      this.debugLog('[selectProgram] TRACE: RECOVERY L0 attempting NL parse', {
        sessionId,
        inputLen: String(input || '').trim().length,
        displayedProgramsCount: context.displayedPrograms.length,
      });
      const nlMatch = this.parseProgramSelection(input, context.displayedPrograms);
      if (nlMatch) {
        programData = nlMatch.program_data;
        programRef = nlMatch.program_ref;
        this.debugLog('[selectProgram] TRACE: RECOVERY L0 matched program from NL input', {
          sessionId,
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
        this.debugLog('[selectProgram] TRACE: RECOVERY L1 found programData from displayedPrograms', {
          sessionId,
          program_ref: programRef,
          program_name: programData?.name || programData?.title
        });
      }
    }
    
    // LAYER 2: If still missing, query cached_provider_feed database
    if (!programData && programRef) {
      this.debugLog('[selectProgram] TRACE: RECOVERY L2 querying cached_provider_feed', { sessionId, program_ref: programRef });
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
          this.debugLog('[selectProgram] TRACE: RECOVERY L2 found programData from cached_provider_feed', {
            sessionId,
            program_ref: programRef,
            program_name: programData?.name || programData?.title,
            org_ref: feedData.org_ref
          });
        } else if (error) {
          Logger.warn('[selectProgram] RECOVERY L2 DB error', { message: error.message });
        }
      } catch (dbError) {
        Logger.warn('[selectProgram] RECOVERY L2 exception', { message: (dbError as any)?.message || String(dbError) });
      }
    }
    
    // LAYER 3: If still missing, return error
    if (!programData) {
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
    this.debugLog('[selectProgram] TRACE: About to persist selectedProgram', {
      sessionId,
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
    this.debugLog('[selectProgram] TRACE: Context after update', {
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
        const slotStart = program?.earliest_slot_time ? new Date(program.earliest_slot_time) : null;
        if (slotStart && Number.isFinite(slotStart.getTime())) {
          const graceMs = 5 * 60 * 1000;
          if (slotStart.getTime() < (Date.now() - graceMs)) return 'closed';
        }
        const hasAvailableSlots = program?.next_available_slot || (program?.available_slots && program.available_slots > 0);
        if (hasAvailableSlots) return 'open_now';
        if (program?.booking_status === 'sold_out') return 'sold_out';
        return program?.booking_status || 'open_now';
      };
      
      const bookingStatus = determineBookingStatus(programData);
      const earliestSlot = programData?.earliest_slot_time ? new Date(programData.earliest_slot_time) : null;

      if (bookingStatus === 'closed') {
        // Keep the user in BROWSE; this program’s next session has already passed.
        // Re-render the catalog so they can pick an available class.
        const orgRefForBrowse = context.orgRef || programData?.org_ref || 'aim-design';
        this.updateContext(sessionId, { step: FlowStep.BROWSE, selectedProgram: null });
        const browse = await this.searchPrograms(orgRefForBrowse, sessionId);
        const list = String(browse?.message || "");
        const listWithoutHeader = list
          .replace(/^\s*\*{0,2}step\s+1\/5(?:\s+continued)?\s+—[^\n]*\n*/i, "")
          .trim();
        return {
          ...browse,
          message:
            `That class is no longer available (its session has already started/passed).\n\n` +
            `Please choose another class from the list below:\n\n` +
            `${listWithoutHeader}`,
          // Don’t let this retry increment wizard progress.
          metadata: { ...(browse.metadata || {}), skipWizardProgress: true }
        };
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
      
      // Start Step 2 with a short prompt (email first)
      const message = getAPIFormIntroMessage({ program_name: programName });

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

      // Prompt for delegate email first and clear any stale form fragments
      this.updateContext(sessionId, { 
        // v1 chat-only: we route FORM_FILL messages through submit_form hydration,
        // so we don't need a separate awaitingDelegateEmail fast-path.
        awaitingDelegateEmail: false,
        pendingDelegateInfo: undefined,
        childInfo: undefined,
        formData: undefined,
        savedChildren: undefined,
        awaitingChildSelection: false,
      awaitingSingleChildChoice: false,
      declinedSingleSavedChild: false,
      reviewSummaryShown: false,
        paymentAuthorized: false
      });

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
    context: APIContext,
    opts?: { nextStep?: 'payment' | 'review' }
  ): Promise<OrchestratorResponse> {
    this.debugLog('[submitForm] TRACE: start', {
      sessionId,
      payloadKeys: Object.keys(payload || {}),
      step: context.step,
      hasSelectedProgram: !!context.selectedProgram,
    });
    
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

    // Get user_id from payload (frontend) or context (Auth0/JWT session)
    const userId = payload.user_id || context.user_id;
    
    if (!userId) {
      Logger.warn('[submitForm] No user_id in payload - success fee charge may fail');
      Logger.warn('[submitForm] Delegate email present (user_id missing)', { hasDelegateEmail: !!formData?.delegate?.delegate_email });
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

    // Persist user identity + raw form submission (no step change; final step decided below).
    this.updateContext(sessionId, {
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
    // Bookeo nuance: booking can be closed even if slots exist (maxAdvanceTime window not open yet).
    const now = new Date();
    const hasAvailableSlots =
      context.selectedProgram?.next_available_slot ||
      (context.selectedProgram?.available_slots && context.selectedProgram.available_slots > 0);
    const isSoldOut = context.selectedProgram?.booking_status === 'sold_out';

    const slotStart = context.selectedProgram?.earliest_slot_time
      ? new Date(context.selectedProgram.earliest_slot_time) 
        : null;
    const maxAdvance = context.selectedProgram?.booking_limits?.maxAdvanceTime;
    const computedOpensAt =
      slotStart && maxAdvance
        ? new Date(slotStart.getTime() - maxAdvance.amount * this.getMilliseconds(maxAdvance.unit))
        : (context.selectedProgram?.booking_opens_at ? new Date(context.selectedProgram.booking_opens_at) : null);

      const bookingStatus: string = (() => {
        const raw = String(context.selectedProgram?.booking_status || "").toLowerCase().trim();
        if (isSoldOut || raw === 'sold_out') return 'sold_out';
        // First principles: if provider says it's open now, trust it (even if slots metadata is missing).
        if (raw === 'open_now' || raw === 'open') return 'open_now';
        if (hasAvailableSlots) return 'open_now';
        if (raw === 'opens_later' || raw === 'coming_soon') return 'opens_later';
        if (computedOpensAt && computedOpensAt > now) return 'opens_later';
        return raw || 'open_now';
      })();

    // For "opens_later" programs, treat as future booking; schedule against opensAt (not class start time).
    const isFutureBooking = bookingStatus === 'opens_later';

    // Build review summary and store state for payment/confirmation
    let hasPaymentMethod = false;
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
      hasPaymentMethod = !!billingData?.default_payment_method_id;
      Logger.info('[submitForm] Payment method check result', { hasPaymentMethod, cardBrand, cardLast4 });
    }

    const scheduledTimeStr = computedOpensAt?.toISOString() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // For Bookeo, the booking API needs a slot eventId. However, for "opens later" programs
    // Bookeo may not return any slots yet (so cached feed has no first_available_event_id).
    // In that case we fall back to the productId/program_ref and let bookeo.confirm_booking
    // resolve the real slot eventId at execution time via /availability/slots.
    const eventIdForBooking = context.selectedProgram?.first_available_event_id || context.selectedProgram?.program_ref;

    const nextStep: FlowStep =
      (opts?.nextStep || 'review') === 'payment' ? FlowStep.PAYMENT : FlowStep.REVIEW;

    this.updateContext(sessionId, {
      step: nextStep,
      formData: {
        delegate_data: formData.delegate,
        participant_data: formData.participants,
        num_participants: numParticipants,
        event_id: eventIdForBooking,
        program_fee_cents: Math.round(totalPrice * 100)
      },
      schedulingData: isFutureBooking ? {
        scheduled_time: scheduledTimeStr,
        event_id: eventIdForBooking,
        total_amount: grandTotal,
        program_fee: formattedTotal,
        program_fee_cents: Math.round(totalPrice * 100),
        formData: {
          delegate: formData.delegate,
          participants: formData.participants,
          num_participants: numParticipants
        }
      } : undefined,
      user_id: userId,
      hasPaymentMethod,
      cardLast4,
      cardBrand,
      // Ensure review summary renders after payment setup/confirmation.
      reviewSummaryShown: false,
    });

    if (nextStep === FlowStep.PAYMENT) {
      Logger.info('[submitForm] All required fields collected; transitioning to PAYMENT confirmation step');

      // If a payment method exists, explicitly confirm before REVIEW.
      if (hasPaymentMethod || cardLast4) {
        const display = cardLast4 ? `${cardBrand || 'Card'} •••• ${cardLast4}` : 'Yes';
        if (isFutureBooking && computedOpensAt) {
          const opensAtDisplay = this.formatTimeForUser(computedOpensAt, context);
          return this.formatResponse(
            `I found a payment method on file: **${display}**.\n\n` +
              `⏰ **Registration opens:** ${opensAtDisplay}\n` +
              `🕒 If you confirm this card, I’ll schedule an auto‑registration to run **the moment it opens**.\n` +
              `💳 **No charge now** — the $20 SignupAssist fee is charged **only if registration succeeds**.\n\n` +
              `Reply **yes** to use it, or reply **change card** to add a new one in Stripe.`,
            undefined,
            []
          );
        }
        return this.formatResponse(
          `I found a payment method on file: **${display}**.\n\nReply **yes** to use it, or reply **change card** to add a new one in Stripe.`,
          undefined,
          []
        );
      }

      // No payment method: start Stripe Checkout now (before review/consent).
      const userEmail = this.resolveDelegateEmailFromContext(context) || (formData?.delegate?.delegate_email as string | undefined);
      const userIdForStripe = userId;
      if (!userIdForStripe) return this.formatError("Missing user identity for payment setup. Please sign in again.");
      if (!userEmail) {
        return this.formatResponse(`To set up payment, please share the parent/guardian email address.`, undefined, []);
      }
      try {
        const base =
          (process.env.RAILWAY_PUBLIC_DOMAIN
            ? (process.env.RAILWAY_PUBLIC_DOMAIN.startsWith('http')
                ? process.env.RAILWAY_PUBLIC_DOMAIN
                : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
            : 'https://signupassist.shipworx.ai');

        const sessionRes = await this.invokeMCPTool('stripe.create_checkout_session', {
          user_id: userIdForStripe,
          user_email: userEmail,
          success_url: `${base}/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}/stripe_return?payment_setup=canceled`
        });
        if (!sessionRes.success || !sessionRes.data?.url) {
          throw new Error(sessionRes.error?.message || "Unknown error");
        }
        this.updateContext(sessionId, {
          stripeCheckoutUrl: sessionRes.data.url,
          stripeCheckoutSessionId: sessionRes.data.session_id,
          stripeCheckoutCreatedAt: new Date().toISOString(),
        });
        return this.formatResponse(this.formatStripeCheckoutLinkMessage(sessionRes.data.url));
      } catch (e) {
        Logger.error("[stripe] Checkout session creation failed (pre-review):", e);
        return this.formatError("Failed to start payment setup. Please try again.");
      }
    }

    Logger.info('[submitForm] All required fields collected; transitioning to REVIEW phase');
    return this.formatResponse(this.buildReviewSummaryFromContext(this.getContext(sessionId)));
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
      if (!context.hasPaymentMethod && !context.cardLast4 && !context.cardBrand) {
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
      
      // Avoid logging raw formData (can contain PII). Only log high-level shape.
      Logger.info("[confirmPayment] 🔍 FormData source:", {
        fromPayload: !!payload.formData,
        fromContext: !!context.formData,
        hasFormData: !!formData,
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
            scopes: ['bookeo:create_booking', 'platform:success_fee'],
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
      const providerPaymentRequired: boolean | undefined = bookingResponse.data?.provider_payment_required;
      const providerPaymentStatus: 'paid' | 'unpaid' | 'unknown' | undefined = bookingResponse.data?.provider_payment_status;
      const providerAmountDueCents: number | null | undefined = bookingResponse.data?.provider_amount_due_cents;
      const providerAmountPaidCents: number | null | undefined = bookingResponse.data?.provider_amount_paid_cents;
      const providerCurrency: string | null | undefined = bookingResponse.data?.provider_currency;
      const providerPaymentLastCheckedAt: string | undefined = bookingResponse.data?.provider_payment_last_checked_at;
      const providerCheckoutUrl: string | undefined = bookingResponse.data?.provider_checkout_url;
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
            participant_names: participantNames,
            // Only store provider checkout URL if the program fee is non-zero.
            provider_checkout_url: amountCents > 0 ? (providerCheckoutUrl || `https://bookeo.com/book/${programRef}?ref=signupassist`) : null,
            provider_payment_status: providerPaymentStatus || 'unknown',
            provider_amount_due_cents: providerAmountDueCents ?? null,
            provider_amount_paid_cents: providerAmountPaidCents ?? null,
            provider_currency: providerCurrency ?? null,
            provider_payment_last_checked_at: providerPaymentLastCheckedAt || new Date().toISOString()
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

      // Step 5: Reset context (awaited so other Railway instances don't briefly see stale SUBMIT state)
      // Use Design DNA-compliant success message
      const message = getAPISuccessMessage({
        program_name: programName,
        booking_number,
        start_time: start_time || "TBD",
        user_timezone: context.userTimezone
      });
      const providerPaymentNote = providerCheckoutUrl
        ? `\n\n💳 **Provider payment:** ${providerCheckoutUrl}\n_Program-fee refunds/disputes are handled by the provider. SignupAssist can refund the $20 success fee._`
        : `\n\n💳 **Provider payment:** The provider will collect the program fee via their official checkout (often sent by email).\n_Program-fee refunds/disputes are handled by the provider. SignupAssist can refund the $20 success fee._`;

      const finalMessage = `${message}${providerPaymentNote}`;

      // Step 5: Reset context (awaited so other Railway instances don't briefly see stale SUBMIT state)
      // Also store a minimal lastCompletion record so ChatGPT retry/duplication can re-print the confirmation.
      await this.updateContextAndAwait(sessionId, {
        step: FlowStep.COMPLETED,
        selectedProgram: undefined,
        requiredFields: undefined,
        formData: undefined,
        childInfo: undefined,
        schedulingData: undefined,
        reviewSummaryShown: false,
        paymentAuthorized: false,
        stripeCheckoutUrl: undefined,
        stripeCheckoutSessionId: undefined,
        stripeCheckoutCreatedAt: undefined,
        lastCompletion: {
          kind: "immediate",
          completed_at: new Date().toISOString(),
          message: finalMessage,
          booking_number,
          org_ref: orgRef,
          program_ref: programRef,
        },
      });

      const successResponse: OrchestratorResponse = {
        message: finalMessage,
        // Hint for HTTP guardrails: success should render as Step 5/5
        step: FlowStep.COMPLETED,
        cta: {
          buttons: [
            ...(providerCheckoutUrl ? [{
              label: providerPaymentRequired === false ? "Provider payment not required" : "Pay Provider",
              action: "open_external_url",
              payload: { url: providerCheckoutUrl },
              variant: "outline" as const
            }] : []),
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
          `**Program Fee:** $${programFee} (charged by the provider via their official checkout)\n` +
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
    const scheduledDisplay = this.formatTimeForUser(scheduledDate, context);
    return {
      message: `We'll automatically register you on ${scheduledDisplay}.\n\n` +
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
    if (!context.hasPaymentMethod && !context.cardLast4 && !context.cardBrand) {
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
      const scheduledDate = scheduledTime ? this.formatTimeForUser(new Date(scheduledTime), context) : null;
      
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

      // Step 2: Create scheduled_registrations row via scheduler tool (full execution payload)
      Logger.info("[confirmScheduledRegistration] Creating scheduled registration payload...");
      
      const delegate = formData.delegate || {};
      const participants = formData.participants || [];
      const programFeeCents = Math.round(parseFloat(program_fee?.replace(/[^0-9.]/g, '') || '0') * 100);
      
      Logger.info("[confirmScheduledRegistration] Scheduling job via scheduler.schedule_signup...");
      const scheduleResponse = await this.invokeMCPTool(
        'scheduler.schedule_signup',
        {
        user_id: context.user_id,
        mandate_id: mandateId,
        org_ref: context.selectedProgram.org_ref,
          program_ref: context.selectedProgram.program_ref,
          program_name: programName,
          event_id,
          scheduled_time,
          delegate_data: delegate,
          participant_data: participants,
          program_fee_cents: programFeeCents,
          success_fee_cents: 2000
        },
        { mandate_id: mandateId, user_id: context.user_id }
      );

      if (!scheduleResponse.success || !scheduleResponse.data?.scheduled_registration_id) {
        Logger.error("[confirmScheduledRegistration] Job scheduling failed", scheduleResponse);
        return this.formatError("Failed to schedule auto-registration. Please try again.");
      }

      const scheduledRegistrationId = scheduleResponse.data.scheduled_registration_id;
      Logger.info("[confirmScheduledRegistration] ✅ Scheduled registration created:", scheduledRegistrationId);
      
      // Mandate expiry is already an ISO string (UTC). Keep ISO for storage and format for display in templates.
      const validUntilIso = mandateResponse.data?.valid_until || scheduled_time;
      
      // Use the Responsible Delegate disclosure template
      const successMessage = getScheduledRegistrationSuccessMessage({
        program_name: programName,
        scheduled_date: scheduled_time,
        total_cost: total_amount,
        provider_name: 'AIM Design', // TODO: get from context
        mandate_id: mandateId,
        valid_until: validUntilIso,
        user_timezone: context.userTimezone
      });
      
      const scheduledDisplay = this.formatTimeForUser(scheduledDate, context);
      const code = `SCH-${String(scheduledRegistrationId).slice(0, 8)}`;

      const finalMessage = addResponsibleDelegateFooter(
        `${successMessage}\n\n` +
          `📌 Reference: **${code}**\n\n` +
          `To cancel before it runs: **cancel ${code}**\n` +
          `To check status: **view my registrations**`
      );

      // Reset context (awaited so other Railway instances don't briefly see stale SUBMIT/REVIEW state),
      // and store a replay-safe completion snapshot (ChatGPT can send an empty follow-up call on reconnect).
      await this.updateContextAndAwait(sessionId, {
        step: FlowStep.COMPLETED,
        selectedProgram: undefined,
        requiredFields: undefined,
        formData: undefined,
        childInfo: undefined,
        schedulingData: undefined,
        reviewSummaryShown: false,
        paymentAuthorized: false,
        stripeCheckoutUrl: undefined,
        stripeCheckoutSessionId: undefined,
        stripeCheckoutCreatedAt: undefined,
        lastCompletion: {
          kind: "scheduled",
          completed_at: new Date().toISOString(),
          message: finalMessage,
          scheduled_registration_id: scheduledRegistrationId,
          org_ref: context.selectedProgram.org_ref,
          program_ref: context.selectedProgram.program_ref,
        },
      });
      
      return {
        message: finalMessage,
        // Hint for HTTP guardrails: completion should render as Step 5/5
        step: FlowStep.COMPLETED,
        cards: [{
          title: '🎉 You\'re All Set!',
          subtitle: programName,
          description:
            `📅 **Auto-Registration Scheduled**\n` +
            `We'll register you at: ${scheduledDisplay}\n\n` +
            `💰 **Total (if successful):** ${total_amount}\n` +
            `📌 **Reference:** ${code}\n\n` +
            `🔐 **Mandate ID:** ${mandateId.substring(0, 8)}...`
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

      const { data: scheduledRegs, error: scheduledError } = await supabase
        .from('scheduled_registrations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (scheduledError) {
        Logger.warn("[viewReceipts] Failed to fetch scheduled_registrations:", scheduledError);
      }

      const anyReceipts = (registrations && registrations.length > 0) || (scheduledRegs && scheduledRegs.length > 0);
      if (!anyReceipts) {
        return {
          ...this.formatResponse(
          "📋 **Your Registrations**\n\nYou don't have any registrations yet.",
          undefined,
            [{ label: "Browse Classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }],
            // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
            { suppressWizardHeader: true }
          ),
          // Receipts/management is a post-signup view (render as Step 5/5).
          step: FlowStep.COMPLETED,
        };
      }

      // Format currency helper (cents → dollars)
      const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

      // Format date/time for display
      const formatDateTime = (dateStr: string | null) => {
        if (!dateStr) return 'Date TBD';
        // IMPORTANT: never rely on server-local timezone.
        // Use user timezone when available; fall back to UTC.
        return this.formatTimeForUser(dateStr, context);
      };

      // Categorize registrations
      const now = new Date();
      const upcoming = registrations.filter(r => 
        r.status === 'confirmed' && r.start_date && new Date(r.start_date) > now
      );
      // Scheduled jobs live in scheduled_registrations (both active + historical).
      const scheduledActive = (scheduledRegs || []).filter(
        (r: any) => r.status === 'pending' || r.status === 'executing'
      );
      const scheduledHistory = (scheduledRegs || []).filter(
        (r: any) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled'
      );
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
          case 'executing': return '⚡ Executing';
          default: return status;
        }
      };

      // Build cards for each registration
      const buildRegCard = (reg: any, isUpcoming: boolean = false): CardSpec => {
        const buttons: any[] = [];
        
        // Always show View Audit Trail for non-pending registrations (including cancelled)
        if (reg.status !== 'pending') {
          buttons.push({ label: 'View Audit Trail', action: 'view_audit_trail', payload: { registration_id: reg.id }, variant: 'outline' as const });
        }
        
        // Show Cancel button for pending OR upcoming (but not cancelled/failed/completed)
        if ((reg.status === 'pending' || isUpcoming) && reg.status !== 'cancelled' && reg.status !== 'failed' && reg.status !== 'completed') {
          buttons.push({ label: 'Cancel', action: 'cancel_registration', payload: { registration_id: reg.id }, variant: 'secondary' as const });
        }

        // Provider payment (provider is merchant-of-record)
        if (reg.provider_checkout_url) {
          buttons.push({
            label: 'Pay Provider (if needed)',
            action: 'open_external_url',
            payload: { url: reg.provider_checkout_url },
            variant: 'outline' as const
          });
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
            `**Total:** ${formatDollars((reg.amount_cents || 0) + (reg.success_fee_cents || 0))}`,
            ...(reg.provider_checkout_url ? [``, `**Provider checkout:** ${reg.provider_checkout_url}`] : [])
          ].join('\n'),
          buttons
        };
      };

      const buildScheduledCard = (sr: any): CardSpec => {
        const pricing = sr?.delegate_data?._pricing || {};
        const programFeeCents = pricing.program_fee_cents || 0;
        const successFeeCents = pricing.success_fee_cents || 2000;
        const participantNames = Array.isArray(sr?.participant_data)
          ? sr.participant_data.map((p: any) => `${p.firstName || ''} ${p.lastName || ''}`.trim()).filter(Boolean)
          : [];

        const buttons: any[] = [];
        // Always allow audit trail for scheduled jobs (text-only users can also say "audit SCH-xxxx").
        buttons.push({
          label: 'View Audit Trail',
          action: 'view_audit_trail',
          payload: { scheduled_registration_id: sr.id },
          variant: 'outline' as const
        });
        if (sr.status === 'pending') {
          buttons.push({
            label: 'Cancel',
            action: 'cancel_registration',
            payload: { scheduled_registration_id: sr.id },
            variant: 'secondary' as const
          });
        }

        const badge = getStatusBadge(sr.status || 'pending');
        const titleWithStatus = sr.status && sr.status !== 'pending'
          ? `${sr.program_name} ${badge}`
          : sr.program_name;

        return {
          title: titleWithStatus,
          subtitle: formatDateTime(sr.scheduled_time),
          description: [
            `**Auto-registration:** ${getStatusBadge(sr.status || 'pending')}`,
            `**Participants:** ${participantNames.join(', ') || 'N/A'}`,
            `**Program Fee:** ${formatDollars(programFeeCents)} (charged by provider)`,
            `**SignupAssist Fee:** ${formatDollars(successFeeCents)} (charged only if registration succeeds)`,
            `**Total:** ${formatDollars(programFeeCents + successFeeCents)}`
          ].join('\n'),
          buttons
        };
      };

      const cards: CardSpec[] = [
        ...upcoming.map(r => buildRegCard(r, true)),             // isUpcoming = true, show Cancel button
        ...scheduledActive.map((r: any) => buildScheduledCard(r)),
        ...scheduledHistory.map((r: any) => buildScheduledCard(r)),
        ...past.map(r => buildRegCard(r, false))                 // past (includes cancelled/failed), no cancel option
      ];

      // TEXT-ONLY (ChatGPT): include a plain-text list with short codes the user can reference.
      const shortCode = (prefix: 'REG' | 'SCH', id: string) => `${prefix}-${String(id).slice(0, 8)}`;
      const fmtWhen = (iso: string | null) => (iso ? formatDateTime(iso) : 'TBD');
      const lines: string[] = [];
      const pushSection = (title: string, items: string[]) => {
        if (items.length === 0) return;
        lines.push(`\n**${title}**`);
        lines.push(...items.map((x) => `- ${x}`));
      };

      const upcomingLines = upcoming.slice(0, 10).map((r: any) => {
        const code = shortCode('REG', r.id);
        return `${code}: ${r.program_name} — ${getStatusBadge(r.status)} — ${fmtWhen(r.start_date || null)}`;
      });

      // Map booking_number -> REG receipt (if present) so SCH history can link to the resulting receipt.
      const regByBooking = new Map<string, any>();
      for (const r of (registrations || [])) {
        if (r?.booking_number) regByBooking.set(String(r.booking_number), r);
      }

      const scheduledLines = scheduledActive.slice(0, 10).map((s: any) => {
        const code = shortCode('SCH', s.id);
        const when = s.scheduled_time ? fmtWhen(s.scheduled_time) : 'TBD';
        return `${code}: ${s.program_name} — ${getStatusBadge(s.status || 'pending')} — executes ${when}`;
      });

      const scheduledHistoryLines = scheduledHistory.slice(0, 10).map((s: any) => {
        const code = shortCode('SCH', s.id);
        const scheduledWhen = s.scheduled_time ? fmtWhen(s.scheduled_time) : 'TBD';
        const executedWhen = s.executed_at ? fmtWhen(s.executed_at) : null;
        const badge = getStatusBadge(s.status || 'pending');

        let receiptSuffix = '';
        const booking = s.booking_number ? String(s.booking_number) : '';
        if (booking && regByBooking.has(booking)) {
          const reg = regByBooking.get(booking);
          receiptSuffix = ` → receipt ${shortCode('REG', reg.id)}`;
        }

        if (String(s.status) === 'completed') {
          return `${code}: ${s.program_name} — ${badge} — executed ${executedWhen || scheduledWhen}${receiptSuffix}`;
        }
        if (String(s.status) === 'failed') {
          const em = String(s.error_message || '').trim();
          const msg = em ? ` — ${em.slice(0, 60)}${em.length > 60 ? '…' : ''}` : '';
          return `${code}: ${s.program_name} — ${badge} — scheduled ${scheduledWhen}${msg}`;
        }
        if (String(s.status) === 'cancelled') {
          return `${code}: ${s.program_name} — ${badge} — was scheduled ${scheduledWhen}`;
        }
        return `${code}: ${s.program_name} — ${badge} — scheduled ${scheduledWhen}`;
      });

      const pastLines = past.slice(0, 10).map((r: any) => {
        const code = shortCode('REG', r.id);
        return `${code}: ${r.program_name} — ${getStatusBadge(r.status)} — ${fmtWhen(r.start_date || null)}`;
      });

      const textMessage =
        `📋 **Your Registrations**\n\n` +
          `✅ **Upcoming:** ${upcoming.length}\n` +
        `📅 **Scheduled:** ${scheduledActive.length}\n` +
        `🗂 **Scheduled history:** ${scheduledHistory.length}\n` +
          `📦 **Past:** ${past.length}\n\n` +
        `To manage items, reply with one of:\n` +
        `- **cancel REG-xxxxxxxx** (cancel a confirmed booking request)\n` +
        `- **cancel SCH-xxxxxxxx** (cancel a scheduled auto-registration)\n` +
        `- **audit REG-xxxxxxxx** (view audit trail)\n` +
        `- **audit SCH-xxxxxxxx** (view audit trail)\n\n` +
        `Examples: "cancel SCH-1a2b3c4d", "audit REG-9f8e7d6c"\n` +
        `_(Program-fee refunds are handled by the provider. SignupAssist can refund the $20 success fee when applicable.)_`;

      // Add sections with actual items (kept short to avoid huge messages)
      const listMessage = [
        textMessage,
        upcomingLines.length ? `\n**Upcoming (top ${upcomingLines.length}):**\n${upcomingLines.map(x => `- ${x}`).join('\n')}` : '',
        scheduledLines.length ? `\n**Scheduled (top ${scheduledLines.length}):**\n${scheduledLines.map(x => `- ${x}`).join('\n')}` : '',
        scheduledHistoryLines.length ? `\n**Scheduled history (top ${scheduledHistoryLines.length}):**\n${scheduledHistoryLines.map(x => `- ${x}`).join('\n')}` : '',
        pastLines.length ? `\n**Past (top ${pastLines.length}):**\n${pastLines.map(x => `- ${x}`).join('\n')}` : ''
      ].join('');

      // Cache displayed short codes → UUIDs so text commands like "cancel REG-xxxxxxxx" never depend on DB prefix lookups.
      // Keep it scoped to the items we actually show to the user to avoid bloating session state.
      const refMap: Record<string, string> = {};
      const remember = (prefix: "REG" | "SCH", id: string) => {
        const uuid = String(id || "").trim();
        if (!uuid) return;
        const token = uuid.slice(0, 8).toLowerCase();
        const code = `${prefix}-${token}`.toLowerCase();
        refMap[code] = uuid;
        // Also allow bare tokens (only helpful for hex-containing tokens; safeRef already gates digits-only).
        refMap[token] = uuid;
      };
      upcoming.slice(0, 10).forEach((r: any) => remember("REG", r.id));
      scheduledActive.slice(0, 10).forEach((s: any) => remember("SCH", s.id));
      scheduledHistory.slice(0, 10).forEach((s: any) => remember("SCH", s.id));
      past.slice(0, 10).forEach((r: any) => remember("REG", r.id));
      this.updateContext(sessionId, { lastReceiptRefMap: refMap });

      return {
        message: listMessage + `\n\n` + getReceiptsFooterMessage(),
        // Receipts/management is a post-signup view (render as Step 5/5).
        step: FlowStep.COMPLETED,
        cards,
        cta: {
          buttons: [
            { label: "Browse Classes", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
          ]
        },
        // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
        metadata: {
          suppressWizardHeader: true,
          _build: APIOrchestrator.BUILD_STAMP
        }
      };
    } catch (err) {
      Logger.error("[viewReceipts] Exception:", err);
      const errResp = this.formatError("An error occurred while loading your registrations.");
      return {
        ...errResp,
        metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
      };
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
    let { registration_id, scheduled_registration_id, registration_ref } = payload;

    // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
    const withSuppressWizardHeader = (r: OrchestratorResponse): OrchestratorResponse => ({
      ...r,
      metadata: {
        ...(r.metadata || {}),
        suppressWizardHeader: true,
        _build: (r.metadata || {})._build || APIOrchestrator.BUILD_STAMP
      }
    });

    const coerceScopeList = (scope: any): string[] => {
      if (Array.isArray(scope)) return scope.filter((s) => typeof s === 'string');
      if (typeof scope === 'string' && scope.trim()) return [scope];
      return [];
    };

    const safeTime = (value: any): string => {
      try {
        if (!value) return 'N/A';
        const d = value instanceof Date ? value : new Date(value);
        if (!Number.isFinite(d.getTime())) return 'N/A';
        return this.formatTimeForUser(d, context);
      } catch {
        return 'N/A';
      }
    };
    
    // Allow text-only reference codes (REG-xxxx / SCH-xxxx / uuid)
    if (!registration_id && !scheduled_registration_id && registration_ref) {
      const resolved = await this.resolveRegistrationRef(registration_ref, context.user_id);
      registration_id = resolved?.registration_id;
      scheduled_registration_id = resolved?.scheduled_registration_id;
    }

    if (!registration_id && !scheduled_registration_id) {
      return withSuppressWizardHeader(
        this.formatError("Registration reference required to view audit trail. Try: “audit REG-xxxxxxxx” or “audit SCH-xxxxxxxx”.")
      );
    }
    
    try {
      const supabase = this.getSupabaseClient();

      const renderScheduledAudit = async (id: string): Promise<OrchestratorResponse> => {
        const { data: scheduled, error: schError } = await supabase
          .from('scheduled_registrations')
          .select('id, mandate_id, program_name, program_ref, org_ref, scheduled_time, status, booking_number, executed_at, error_message, created_at')
          .eq('id', id)
          .maybeSingle();

        if (schError || !scheduled) {
          Logger.error("[viewAuditTrail] Scheduled registration not found:", schError);
          return withSuppressWizardHeader(this.formatError("Scheduled registration not found."));
        }

        const mandateId = scheduled.mandate_id;
        const when = scheduled.scheduled_time ? safeTime(scheduled.scheduled_time) : 'TBD';
        const code = `SCH-${String(scheduled.id).slice(0, 8)}`;

        const { data: mandate, error: mandateError } = await supabase
          .from('mandates')
          .select('id, scope, valid_from, valid_until, status, provider, jws_compact')
          .eq('id', mandateId)
          .maybeSingle();

        if (mandateError) {
          Logger.warn("[viewAuditTrail] Mandate lookup failed:", mandateError);
        }

        const { data: auditEvents, error: auditError } = await supabase
          .from('audit_events')
          .select('tool, decision, started_at, finished_at, event_type, args_json, result_json, args_hash, result_hash')
          .eq('mandate_id', mandateId)
          .order('started_at', { ascending: true });

        if (auditError) {
          Logger.warn("[viewAuditTrail] Audit events lookup failed:", auditError);
        }

        const header =
          `📋 **Audit Trail (Scheduled Auto-Registration)**\n\n` +
          `**Reference:** ${code}\n` +
          `**Program:** ${scheduled.program_name}\n` +
          `**Scheduled for:** ${when}\n` +
          `**Status:** ${scheduled.status || 'pending'}\n` +
          (scheduled.error_message ? `**Last error:** ${scheduled.error_message}\n` : '') +
          `\nTo cancel this scheduled signup, say: **cancel ${code}**`;

        const eventsList = (auditEvents || []).map((event, idx) => {
          const time = safeTime(event.started_at);
          const status = event.decision === 'allowed' ? '✅' : (event.decision === 'denied' ? '❌' : '⏳');
          const toolName = event.tool || event.event_type || 'Unknown action';
          return `${idx + 1}. ${status} ${toolName} — ${time}`;
        });

        const mandateLines = mandate
          ? [
              ``,
              `**Mandate:** ${String(mandate.id).slice(0, 8)}…`,
              `**Scopes:** ${coerceScopeList(mandate.scope).map((s: string) => this.mapScopeToFriendly(s)).join(', ') || 'N/A'}`,
              `**Valid until:** ${mandate.valid_until ? safeTime(mandate.valid_until) : 'N/A'}`,
            ].join('\n')
          : '';

        const message =
          header +
          (eventsList.length ? `\n\n**Events (${eventsList.length}):**\n${eventsList.map(e => `- ${e}`).join('\n')}` : `\n\n_No events recorded yet._`) +
          mandateLines;

        return withSuppressWizardHeader(this.formatResponse(message));
      };

      // Scheduled auto-registration audit trail (before execution)
      if (scheduled_registration_id && (!registration_id || /^sch-/i.test(String(registration_ref || '').trim()))) {
        return await renderScheduledAudit(scheduled_registration_id);
      }
      
      // 1. Get registration to find mandate_id
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select('mandate_id, program_name, booking_number, delegate_name, amount_cents, success_fee_cents, created_at')
        .eq('id', registration_id)
        .maybeSingle();
      
      // If the reference was ambiguous (UUID) and it wasn't in registrations, fall back to scheduled.
      if ((regError || !registration) && scheduled_registration_id) {
        return await renderScheduledAudit(scheduled_registration_id);
      }
      
      if (regError || !registration) {
        Logger.error("[viewAuditTrail] Registration not found:", regError);
        return withSuppressWizardHeader(this.formatError("Registration not found."));
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
          },
          metadata: {
            suppressWizardHeader: true,
            _build: APIOrchestrator.BUILD_STAMP
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
        const time = safeTime(event.started_at);
        const status = event.decision === 'allowed' ? '✅' : (event.decision === 'denied' ? '❌' : '⏳');
        const toolName = event.tool || event.event_type || 'Unknown action';
        return `${index + 1}. ${status} **${toolName}** - ${time}`;
      });
      
      // Build detailed event cards with SHA256 hashes for integrity verification
      const eventCards: CardSpec[] = (auditEvents || []).map((event, index) => {
        const time = safeTime(event.started_at);
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
      const friendlyScopes = coerceScopeList(mandate?.scope).map((s: string) => this.mapScopeToFriendly(s)).join(', ');
      
      const mandateDescriptionParts = [
        `**Provider:** ${mandate?.provider || 'N/A'}`,
        `**Scopes:** ${friendlyScopes || 'N/A'}`,
        `**Valid From:** ${mandate ? safeTime(mandate.valid_from) : 'N/A'}`,
        `**Valid Until:** ${mandate ? safeTime(mandate.valid_until) : 'N/A'}`,
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
        },
        // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
        metadata: {
          suppressWizardHeader: true,
          _build: APIOrchestrator.BUILD_STAMP
        }
      };
    } catch (err) {
      Logger.error("[viewAuditTrail] Exception", {
        errName: (err as any)?.name,
        errMessage: (err as any)?.message,
        registration_id,
        scheduled_registration_id
      });
      return withSuppressWizardHeader(this.formatError("An error occurred while loading the audit trail."));
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
    const { registration_id, scheduled_registration_id } = payload;
    
    if (!registration_id && !scheduled_registration_id) {
      // Friendly recovery: show the registrations list so the user can pick a REG-/SCH- code.
      if (!context.user_id) {
        const errResp = this.formatError("Please sign in to cancel a registration.");
        return {
          ...errResp,
          metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
        };
      }
      const receipts = await this.viewReceipts({ user_id: context.user_id }, sessionId, context);
      const intro =
        `To cancel a registration, reply with one of the codes below, e.g. **cancel REG-xxxxxxxx** (confirmed booking) or **cancel SCH-xxxxxxxx** (scheduled).\n\n`;
      return {
        ...receipts,
        message: `${intro}${receipts.message}`,
        // Hint for guardrails: this is a post-signup management view (Step 5/5).
        step: FlowStep.COMPLETED,
      };
    }
    
    try {
      const supabase = this.getSupabaseClient();
      
      // First: try receipts table (confirmed bookings)
      let registration: any = null;
      if (registration_id) {
        let q = supabase
          .from('registrations')
          .select('id, program_name, booking_number, status, start_date, delegate_name, amount_cents, success_fee_cents, org_ref, provider, charge_id')
          .eq('id', registration_id);
        if (context.user_id) q = q.eq('user_id', context.user_id);
        const { data, error } = await q.maybeSingle();
        if (error) Logger.warn("[cancelRegistration] registrations lookup error:", error);
        registration = data || null;
      }

      // Second: try scheduled_registrations (auto-registration jobs not yet executed)
      if (!registration) {
        const id = scheduled_registration_id || registration_id;
        let q = supabase
          .from('scheduled_registrations')
          .select('id, program_name, status, scheduled_time, delegate_data, participant_data')
          .eq('id', id);
        if (context.user_id) q = q.eq('user_id', context.user_id);
        const { data: scheduled, error: scheduledError } = await q.maybeSingle();

        if (scheduledError || !scheduled) {
          Logger.error("[cancelRegistration] Registration not found:", scheduledError);
          const errResp = this.formatError("Registration not found.");
          return {
            ...errResp,
            metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
          };
        }

        // Scheduled job cancellation confirmation (text-only)
        const when = scheduled.scheduled_time ? this.formatTimeForUser(new Date(scheduled.scheduled_time), context) : 'TBD';

        let message = getPendingCancelConfirmMessage({
          program_name: scheduled.program_name
        });
        message = addResponsibleDelegateFooter(message);

        const code = `SCH-${String(scheduled.id).slice(0, 8)}`;
        await this.updateContextAndAwait(sessionId, {
          pendingCancellation: {
            kind: 'scheduled',
            scheduled_registration_id: scheduled.id,
            requested_at: new Date().toISOString()
          }
        });

        return this.formatResponse(
          `${message}\n\n📌 Reference: **${code}**\n\nReply **yes** to confirm cancellation, or **no** to keep it.\n\nNo provider booking has been made yet, so no charges apply.`,
          undefined,
          [],
          // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
          { suppressWizardHeader: true }
        );
      }
      
      // Check if cancellation is allowed
      if (registration.status === 'cancelled') {
        const errResp = this.formatError(`This registration has already been cancelled.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
        return {
          ...errResp,
          metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
        };
      }
      
      if (registration.status === 'completed') {
        const errResp = this.formatError(`Completed registrations cannot be cancelled.\n\n_Questions? Email ${SUPPORT_EMAIL}_`);
        return {
          ...errResp,
          metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
        };
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
          message += `\n\n💳 **Refunds:** SignupAssist can refund the $20 success fee if the provider accepts cancellation. Program-fee refunds (if any) are handled by ${providerName}.`;
        // ✅ COMPLIANCE: Include Responsible Delegate reminder for cancellation
        message = addResponsibleDelegateFooter(message);
        
        const code = `REG-${String(registration.id).slice(0, 8)}`;
        await this.updateContextAndAwait(sessionId, {
          pendingCancellation: {
            kind: 'registration',
            registration_id: registration.id,
            requested_at: new Date().toISOString()
          }
        });

        return this.formatResponse(
          `${message}\n\n📌 Reference: **${code}**\n\nReply **yes** to confirm cancellation, or **no** to keep it.`,
          undefined,
          [],
          // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
          { suppressWizardHeader: true }
        );
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
        cta: { buttons: [] },
        // Receipts/audit/cancel are "account management" views; don't force wizard step headers.
        metadata: {
          suppressWizardHeader: true,
          _build: APIOrchestrator.BUILD_STAMP
        }
      };
      
    } catch (err) {
      Logger.error("[cancelRegistrationStep1] Exception:", err);
      const errResp = this.formatError("An error occurred while preparing cancellation.");
      return {
        ...errResp,
        metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
      };
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
    const { registration_id, is_confirmed, scheduled_registration_id } = payload;
    const userId = context.user_id;
    
    if (!registration_id && !scheduled_registration_id) {
      const errResp = this.formatError("Registration ID required to cancel.");
      return {
        ...errResp,
        metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
      };
    }
    
    if (!userId) {
      const errResp = this.formatError("You must be logged in to cancel a registration.");
      return {
        ...errResp,
        metadata: { ...(errResp.metadata || {}), suppressWizardHeader: true }
      };
    }

    const withSuppressWizardHeader = (r: OrchestratorResponse): OrchestratorResponse => ({
      ...r,
      metadata: {
        ...(r.metadata || {}),
        suppressWizardHeader: true,
        _build: (r.metadata || {})._build || APIOrchestrator.BUILD_STAMP
      }
    });
    
    try {
      const supabase = this.getSupabaseClient();

      // Scheduled auto-registration cancellation (no provider booking exists yet)
      if (scheduled_registration_id) {
        const { data: scheduled, error: scheduledError } = await supabase
          .from('scheduled_registrations')
          .select('id, program_name, status')
          .eq('id', scheduled_registration_id)
          .maybeSingle();

        if (scheduledError || !scheduled) {
          return withSuppressWizardHeader(this.formatError("Scheduled registration not found."));
        }

        if (scheduled.status === 'completed') {
          return withSuppressWizardHeader(this.formatError("This auto-registration already completed. If you need to cancel the booking, cancel the confirmed registration instead."));
        }

        if (scheduled.status === 'cancelled') {
          return withSuppressWizardHeader(this.formatError("This auto-registration has already been cancelled."));
        }

        const { error: cancelError } = await supabase
          .from('scheduled_registrations')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', scheduled_registration_id);

        if (cancelError) {
          Logger.error("[cancelRegistration] Failed to cancel scheduled registration:", cancelError);
          return withSuppressWizardHeader(this.formatError(`Failed to cancel auto-registration.\n\n_Questions? Email ${SUPPORT_EMAIL}_`));
        }

        const baseMessage = getPendingCancelSuccessMessage({
          program_name: scheduled.program_name
        });
        const message = addResponsibleDelegateFooter(baseMessage);

        const finalMessage =
          `${message}\n\n✅ Auto-registration cancelled.\n\nIf you'd like, say **view my registrations** to confirm the updated status.`;

        await this.updateContextAndAwait(sessionId, {
          step: FlowStep.COMPLETED,
          lastCompletion: {
            kind: "cancel_scheduled",
            completed_at: new Date().toISOString(),
            message: finalMessage,
            scheduled_registration_id,
            org_ref: context.orgRef || "aim-design",
          },
        });

        return withSuppressWizardHeader({
          message: finalMessage,
          step: FlowStep.COMPLETED,
          cards: [],
          cta: {
            buttons: [
              { label: "View Registrations", action: "view_receipts", variant: "outline" },
              { label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
            ]
          }
        });
      }
      
      // Get full registration details
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select('*')
        .eq('id', registration_id)
        .single();
      
      if (regError || !registration) {
        return withSuppressWizardHeader(this.formatError("Registration not found."));
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
          return withSuppressWizardHeader(this.formatError(`Failed to cancel registration.\n\n_Questions? Email ${SUPPORT_EMAIL}_`));
        }
        
        const baseMessage = getPendingCancelSuccessMessage({
          program_name: registration.program_name
        });
        const message = addResponsibleDelegateFooter(baseMessage);
        const finalMessage =
          `${message}\n\n✅ Cancellation confirmed.\n\nSay **view my registrations** to see the updated list.`;

        await this.updateContextAndAwait(sessionId, {
          step: FlowStep.COMPLETED,
          lastCompletion: {
            kind: "cancel_registration",
            completed_at: new Date().toISOString(),
            message: finalMessage,
            org_ref: registration.org_ref,
            program_ref: registration.program_ref,
          },
        });
        
        return withSuppressWizardHeader({
          message: finalMessage,
          step: FlowStep.COMPLETED,
          cards: [],
          cta: {
            buttons: [
              { label: "View Registrations", action: "view_receipts", variant: "outline" },
              { label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
            ]
          }
        });
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
          
          const baseMessage = getCancelFailedMessage({
            program_name: registration.program_name,
            provider_name: providerName,
            booking_number: registration.booking_number
          });
          const message = addResponsibleDelegateFooter(baseMessage);

          await this.updateContextAndAwait(sessionId, {
            step: FlowStep.COMPLETED,
            lastCompletion: {
              kind: "cancel_registration",
              completed_at: new Date().toISOString(),
            message,
              booking_number: registration.booking_number,
              org_ref: registration.org_ref,
              program_ref: registration.program_ref,
            },
          });
          
          return withSuppressWizardHeader({
            message,
            step: FlowStep.COMPLETED,
            cards: [],
            cta: {
              buttons: [
                { label: "View Registrations", action: "view_receipts", variant: "outline" }
              ]
            }
          });
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
        
        // Build an accurate cancellation confirmation (don’t claim refund succeeded if it didn’t).
        const bookingNumber = String(registration.booking_number || "");
        const code = `REG-${String(registration.id).slice(0, 8)}`;
        const refundLine =
          !registration.charge_id
            ? `✅ **SignupAssist fee:** No $20 success fee charge was found for this registration, so no refund is needed.`
            : refundSuccessful
              ? `✅ **SignupAssist fee:** $20 refund initiated (most banks post within 2–5 business days).`
              : `⚠️ **SignupAssist fee:** We cancelled the booking, but the $20 refund couldn’t be processed automatically right now. Please email ${SUPPORT_EMAIL} and we’ll take care of it.`;

        const finalMessage = [
          `✅ **Cancellation confirmed**`,
          ``,
          `**${registration.program_name}**`,
          bookingNumber ? `Booking #${bookingNumber}` : ``,
          ``,
          `✅ **Provider:** ${providerName} cancellation requested/accepted.`,
          refundLine,
          ``,
          `📌 Reference: **${code}**`,
        ].filter(Boolean).join("\n");

        const message = addResponsibleDelegateFooter(finalMessage);

        await this.updateContextAndAwait(sessionId, {
          step: FlowStep.COMPLETED,
          lastCompletion: {
            kind: "cancel_registration",
            completed_at: new Date().toISOString(),
            message,
            booking_number: registration.booking_number,
            org_ref: registration.org_ref,
            program_ref: registration.program_ref,
          },
        });
        
        return withSuppressWizardHeader({
          message,
          step: FlowStep.COMPLETED,
          cards: [],
          cta: {
            buttons: [
              { label: "View Registrations", action: "view_receipts", variant: "outline" },
              { label: "Browse Programs", action: "search_programs", payload: { orgRef: "aim-design" }, variant: "accent" }
            ]
          }
        });
      }
      
      // Fallback - shouldn't reach here
      return withSuppressWizardHeader(this.formatError(`Unable to cancel this registration. Status: ${registration.status}\n\n_Questions? Email ${SUPPORT_EMAIL}_`));
      
    } catch (err) {
      Logger.error("[cancelRegistrationStep2] Exception:", err);
      return withSuppressWizardHeader(this.formatError(`An error occurred while cancelling.\n\n_Questions? Email ${SUPPORT_EMAIL}_`));
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
  private inferWizardStepNumber(ctxStep: FlowStep | string | undefined): "1" | "2" | "3" | "4" | "5" {
    if (ctxStep === FlowStep.FORM_FILL) return "2";
    if (ctxStep === FlowStep.PAYMENT) return "3";
    if (ctxStep === FlowStep.REVIEW) return "4";
    if (ctxStep === FlowStep.SUBMIT || ctxStep === FlowStep.COMPLETED) return "5";
    return "1";
  }

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

    // Wizard UX: account-management views (receipts/audit/cancel) should break the "continued" streak.
    // Otherwise the next wizard header can incorrectly render as "continued" even if the user hasn't seen
    // the wizard header for that step in the immediately prior turn.
    if (response?.message && response?.metadata?.suppressWizardHeader) {
      this.updateContext(sessionId, { wizardProgress: undefined });
    }

    // Wizard UX: if we're sending multiple assistant turns within the same wizard step,
    // tag follow-ups as "continued" so users understand they're still on the same step.
    // (Skip for account-management views like receipts/audit/cancel.)
    if (response?.message && !response?.metadata?.suppressWizardHeader) {
      const skipWizardProgress = !!response?.metadata?.skipWizardProgress;
      const effectiveStep = (response.step || ctx.step) as FlowStep | string | undefined;
      const wizardStep = this.inferWizardStepNumber(effectiveStep);
      const prev = ctx.wizardProgress;
      const nextTurnInStep = skipWizardProgress
        ? 1
        : (prev && prev.wizardStep === wizardStep ? (Number(prev.turnInStep || 0) + 1) : 1);

      // Attach metadata for the HTTP boundary to render the correct header variant.
      response = {
        ...response,
        metadata: {
          ...(response.metadata || {}),
          wizardStep,
          wizardTurnInStep: nextTurnInStep,
          wizardContinued: !skipWizardProgress && nextTurnInStep > 1,
          _build: (response.metadata || {})._build || APIOrchestrator.BUILD_STAMP
        }
      };

      if (!skipWizardProgress) {
        // Persist for the next turn (fire-and-forget; do not block user-facing reply).
        this.updateContext(sessionId, {
          wizardProgress: {
            wizardStep,
            turnInStep: nextTurnInStep,
            updatedAt: new Date().toISOString()
          }
        });
      }
    }

    // One-time trust intro (first principles): establish who we are + safety posture.
    // We keep this short and only show it once per durable session, only while browsing.
    if (ctx.user_id && !ctx.trustIntroShown && ctx.step === FlowStep.BROWSE && response?.message) {
      const trust = [
        "✅ You're working with **SignupAssist** — your responsible delegate.",
        "- Eligibility: only a **parent/legal guardian age 18+** can use SignupAssist (COPPA).",
        "- You stay in control: I ask before booking or charging.",
        "- Card entry happens on **Stripe-hosted checkout** (we never see card numbers).",
        "- Every consequential action is logged — say **“view receipts”** anytime.",
      ].join("\n");

      // Insert after the first line if it's a Step header, otherwise just append.
      const msg = String(response.message || "");
      const parts = msg.split("\n");
      if (parts.length > 0 && /^\s*\*{0,2}step\s+1\/5\s+—/i.test(parts[0])) {
        response = { ...response, message: [parts[0], "", trust, "", ...parts.slice(1)].join("\n") };
      } else {
        response = { ...response, message: `${msg}\n\n${trust}` };
      }

      // Persist the "shown" flag so we don't repeat in later turns.
      this.updateContext(sessionId, { trustIntroShown: true });
    }

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
    input?: string
  ): Promise<OrchestratorResponse> {
    Logger.info('[handleSelectChild] Processing child selection', { 
      hasPayload: !!payload, 
      payloadKeys: payload ? Object.keys(payload) : [],
      input 
    });

    // Extract child info from payload first (UI action)
    let childInfo: { firstName: string; lastName: string; age?: number } | null = null;
    
    if (payload?.first_name && payload?.last_name) {
      childInfo = {
        firstName: payload.first_name,
        lastName: payload.last_name,
        age: payload.age ? Number(payload.age) : undefined
      };
    } else if (payload?.child_id) {
      // Child selected from saved children - look it up
      Logger.info('[handleSelectChild] Child selected by ID:', payload.child_id);
      const userId = context.user_id || payload.user_id;
      if (userId) {
        try {
          const listRes = await this.invokeMCPTool('user.list_children', { user_id: userId });
          const children = listRes?.data?.children || [];
          const match = children.find((c: any) => c.id === payload.child_id);
          if (match) {
            childInfo = {
              firstName: match.first_name,
              lastName: match.last_name,
              age: undefined
            };
          }
        } catch (e) {
          Logger.warn('[handleSelectChild] Failed to load saved child record', e);
        }
      }
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
            firstName: String(fallbackParsed.firstName || fallbackParsed.name?.split(' ')[0] || '').trim(),
            lastName: String(fallbackParsed.lastName || fallbackParsed.name?.split(' ').slice(1).join(' ') || '').trim(),
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
    }, sessionId, this.getContext(sessionId), { nextStep: 'payment' });
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
      
      this.debugLog('[loadSessionFromDB] TRACE: Looking up session', {
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
        this.debugLog('[loadSessionFromDB] TRACE: No session found in DB', {
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
      this.debugLog('[loadSessionFromDB] TRACE: Session restored from DB', {
        sessionId,
        sessionKey,
        isAuth0Key,
        step: sessionData.step,
        hasSelectedProgram: !!sessionData.selectedProgram,
        programName: sessionData.selectedProgram?.name || sessionData.selectedProgram?.title,
        hasFormData: !!sessionData.formData,
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
        this.debugLog('[persistSessionToDB] TRACE: Session saved to DB', {
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
   * Enqueue session persistence so writes for the same sessionId execute in-order.
   * This prevents earlier "fire-and-forget" writes from racing and overwriting newer context.
   */
  private enqueuePersist(sessionId: string, context: APIContext): Promise<void> {
    const prior = this.persistQueue.get(sessionId) || Promise.resolve();

    const next = prior
      .catch(() => {
        // Keep the chain alive even if a prior persist threw unexpectedly.
      })
      .then(() => this.persistSessionToDB(sessionId, context));

    this.persistQueue.set(sessionId, next);

    // Cleanup once the latest queued write completes (avoid unbounded growth).
    next.finally(() => {
      if (this.persistQueue.get(sessionId) === next) {
        this.persistQueue.delete(sessionId);
      }
    });

    return next;
  }

  /**
   * Get session context (auto-initialize if needed)
   * Now checks Supabase if not in memory (for ChatGPT multi-turn support)
   */
  private getContext(sessionId: string): APIContext {
    const exists = this.sessions.has(sessionId);
    this.debugLog('[getContext] TRACE', {
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
      // Allow explicit resets that also clear selectedProgram (e.g., user asked to browse/start over).
      // This prevents background/late writes from accidentally rewinding the flow, while still allowing
      // intentional navigation back to BROWSE.
      const isExplicitProgramClear =
        ("selectedProgram" in updates) && (updates.selectedProgram == null);
      if (isAdvancedStep && hasValidProgram && !isExplicitProgramClear) {
        this.debugLog('[updateContext] TRACE: Blocked step reversion to BROWSE (valid program exists)', {
          sessionId,
          fromStep: current.step,
        });
        delete updates.step; // Remove the step update, keep current step
      }
    }

    // Wizard UX: reset the "continued" counter when we transition to a different orchestrator step.
    // This prevents stale persisted wizardProgress from causing "continued" on the first turn of a step.
    if (updates.step !== undefined && updates.step !== current.step) {
      updates.wizardProgress = undefined;
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
    
    this.debugLog('[updateContext] TRACE: Updating session', tracePayload);
    
    // Async persist to DB (fire-and-forget for performance)
    this.enqueuePersist(sessionId, updated)
      .then(() => {
        this.debugLog('[updateContext] TRACE: Persist completed', { sessionId });
      })
      .catch(err => {
        this.debugLog('[updateContext] TRACE: Persist failed', { sessionId, errName: err?.name, errMessage: err?.message });
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
      // Allow explicit resets that also clear selectedProgram (e.g., user asked to browse/start over).
      const isExplicitProgramClear =
        ("selectedProgram" in updates) && (updates.selectedProgram == null);
      if (isAdvancedStep && hasValidProgram && !isExplicitProgramClear) {
        this.debugLog('[updateContextAndAwait] TRACE: Blocked step reversion to BROWSE (valid program exists)', {
          sessionId,
          fromStep: current.step,
        });
        delete updates.step; // Remove the step update, keep current step
      }
    }

    // Wizard UX: reset the "continued" counter when we transition to a different orchestrator step.
    // This prevents stale persisted wizardProgress from causing "continued" on the first turn of a step.
    if (updates.step !== undefined && updates.step !== current.step) {
      updates.wizardProgress = undefined;
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
    
    this.debugLog('[updateContextAndAwait] TRACE: Updating session (awaited)', tracePayload);
    
    // AWAIT the persist to ensure data is saved before returning
    await this.enqueuePersist(sessionId, updated);
    this.debugLog('[updateContextAndAwait] TRACE: Persist completed (awaited)', { sessionId });
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
