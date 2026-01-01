/**
 * API-First Message Templates
 * Concise, parent-friendly messages for Bookeo and other API providers
 */

import { formatInTimeZone } from "date-fns-tz";

// V1 (no widget): we must render progress in plain text (not only tool metadata)
function stepHeader(step: number, title: string): string {
  return `Step ${step}/5 — ${title}`;
}

function trustLine(kind: "privacy" | "stripe"): string {
  if (kind === "privacy") return "🔐 I'll only ask for what the provider requires.";
  return "🔒 Stripe hosts the card form — we never see card numbers.";
}

function normalizeTimeZone(tz?: string): string {
  const raw = String(tz || "").trim();
  if (!raw) return "UTC";
  if (/^(utc|etc\/utc|gmt)$/i.test(raw)) return "UTC";
  return raw;
}

// Support email for refunds and issues
export const SUPPORT_EMAIL = 'refunds@signupassist.ai';

export interface APIMessageVariables {
  provider_name?: string;
  program_count?: number;
  program_name?: string;
  participant_name?: string;
  total_cost?: string;
  num_participants?: number;
  booking_number?: string;
  start_time?: string;
  scheduled_date?: string;
  mandate_id?: string;
  valid_until?: string;
  scopes?: string[];
  user_timezone?: string;
}

/**
 * Format ISO timestamp to user-friendly display
 * "2025-12-19T13:00:00-06:00" → "Dec 19 at 1:00 PM"
 */
export function formatDisplayTime(isoTime: string, userTimezone?: string): string {
  try {
    const date = new Date(isoTime);
    if (isNaN(date.getTime())) return isoTime;
    // Important: never rely on server-local timezone. Use user timezone when provided; fall back to UTC.
    const tz = normalizeTimeZone(userTimezone);
    try {
      return formatInTimeZone(date, tz, "MMM d, yyyy 'at' h:mm a zzz");
    } catch {
      return formatInTimeZone(date, "UTC", "MMM d, yyyy 'at' h:mm a zzz");
    }
  } catch {
    return isoTime;
  }
}

/**
 * Program info for text-based listing
 */
export interface ProgramListItem {
  index: number;
  title: string;
  description?: string;
  price?: string;
  schedule?: string;
  /** open_now | opens_later | sold_out | closed | unknown */
  status?: string;
  /** Human-friendly "registration opens" display (when status=opens_later) */
  opens_at?: string;
}

/**
 * BROWSE step: Programs ready message with inline listing for native ChatGPT
 */
export function getAPIProgramsReadyMessage(vars: APIMessageVariables & { programs?: ProgramListItem[] }): string {
  const providerName = vars.provider_name || "your provider";
  const count = vars.program_count || 0;
  const programs = vars.programs || [];

  let message =
    `${stepHeader(1, "Finding classes")}\n` +
    `Here are the available classes at **${providerName}**:\n\n`;
  
  // Add program listings directly in the message for native ChatGPT
  if (programs.length > 0) {
    programs.forEach((prog, idx) => {
      const num = idx + 1;
      const s = (prog.status || '').toLowerCase();
      const statusEmoji =
        s === 'open' || s === 'open_now' ? '✅'
        : s === 'sold_out' ? '🚫'
        : s === 'closed' ? '⛔'
        : s === 'opens_later' || s === 'coming_soon' ? '📅'
        : 'ℹ️';

      const statusLabel =
        s === 'open' || s === 'open_now' ? 'Open'
        : s === 'sold_out' ? 'Sold Out'
        : s === 'closed' ? 'Registration Closed'
        : s === 'opens_later'
          ? (prog.opens_at ? `Registration opens ${prog.opens_at}` : 'Registration opens soon')
          : 'Status unknown';

      message += `**${num}. ${prog.title}**\n`;
      if (prog.price) message += `   💲 ${prog.price}`;
      if (prog.schedule) message += ` · 📅 ${prog.schedule}`;
      message += ` · ${statusEmoji} ${statusLabel}\n`;

      // Description (if present) + fallback so it never feels "missing"
      const desc = (prog.description || "").trim();
      message += desc
        ? `   🧠 ${desc}\n\n`
        : `   ℹ️ Details coming soon — you can still register.\n\n`;
    });
    message += `Reply with a number (1-${programs.length}) or program name to sign up.`;
  } else {
    message += `Reply with a program name or number to sign up.`;
  }
  
  return message;
}

/**
 * FORM step: Signup form intro
 * V1 (no widget): never dump the whole form. Ask 1 field at a time.
 * APIOrchestrator already tracks pendingDelegateInfo/awaitingDelegateEmail in session context.
 */
export function getAPIFormIntroMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";

  return (
    `${stepHeader(2, "Parent & child info")}\n` +
    `${trustLine("privacy")}\n\n` +
    `To start **${programName}**, what's the parent/guardian **email**?\n` +
    `Reply like: Email: name@example.com`
  );
}

/**
 * PAYMENT step: Booking summary (legacy - kept for backward compatibility)
 */
export function getAPIPaymentSummaryMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `${stepHeader(4, "Payment (Stripe)")}\n` +
  `${trustLine("stripe")}\n\n` +
  `Ready to complete registration for **${programName}**?

Review the charges below. By confirming, you authorize SignupAssist to complete this registration on your behalf.`;
}

/**
 * PAYMENT AUTHORIZATION: Clean message (fees shown by FeeBreakdown component)
 */
export function getPaymentAuthorizationMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `${stepHeader(4, "Payment (Stripe)")}\n` +
  `${trustLine("stripe")}\n\n` +
  `Ready to complete registration for **${programName}**?

Review the charges below. By confirming, you authorize SignupAssist to complete this registration on your behalf.

Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * SUCCESS: Booking confirmed
 */
export function getAPISuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const bookingNumber = vars.booking_number || "N/A";
  const startTime = vars.start_time ? formatDisplayTime(vars.start_time, vars.user_timezone) : "TBD";
  const rawProviderName = vars.provider_name || "the provider";
  // Capitalize first letter since it starts a sentence
  const providerName = rawProviderName.charAt(0).toUpperCase() + rawProviderName.slice(1);
  
  return `You're registered for **${programName}**!

Booking #${bookingNumber} · ${startTime}

${providerName} will email your confirmation. Questions about the class? Contact them directly.`;
}

/**
 * ERROR: Booking failed
 */
export function getAPIErrorMessage(vars: APIMessageVariables): string {
  const providerName = vars.provider_name || "the provider";
  
  return `Something went wrong connecting to ${providerName}. Ready to try again?`;
}

// ============================================
// CANCELLATION FLOW MESSAGES
// ============================================

/**
 * CANCEL STEP 1: Pending registration confirmation
 */
export function getPendingCancelConfirmMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `Cancel scheduled registration for **${programName}**?

No booking has been made yet, so no charges apply.

Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * CANCEL STEP 1: Confirmed booking cancellation (with refund policy)
 */
export function getConfirmedCancelConfirmMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  const bookingNumber = vars.booking_number || "N/A";
  
  return `Cancel **${programName}** (Booking #${bookingNumber})?

Cancellation is subject to ${providerName}'s policy.

**If accepted:** Booking cancelled, $20 SignupAssist fee refunded.
**If blocked:** Booking remains active, no refund issued.

Program fees are handled by ${providerName}. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * CANCEL SUCCESS: Booking cancelled and refunded
 */
export function getCancelSuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  
  return `**Booking Cancelled**

Your registration for **${programName}** has been cancelled.

$20 SignupAssist fee refunded — most banks post refunds within 2-5 business days.

For program fee refunds, contact ${providerName}. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * CANCEL FAILED: Provider blocked cancellation
 */
export function getCancelFailedMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  const bookingNumber = vars.booking_number || "N/A";
  
  return `**Cancellation Not Accepted**

${providerName} was unable to cancel **${programName}** (Booking #${bookingNumber}).

Your booking remains active. Contact ${providerName} directly to discuss options.

No refund is issued unless the booking is cancelled. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * CANCEL SUCCESS: Pending registration (no booking was made)
 */
export function getPendingCancelSuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `**Registration Cancelled**

Your scheduled auto-registration for **${programName}** has been cancelled. No charges apply.

You can schedule a new registration anytime. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * RECEIPTS FOOTER: Support info
 */
export function getReceiptsFooterMessage(): string {
  return `Your payment info is securely stored with Stripe. Questions? Email ${SUPPORT_EMAIL}`;
}

// ============================================
// SCHEDULED REGISTRATION MESSAGES
// ============================================

/**
 * SCHEDULED SUCCESS: Authorization confirmation with Responsible Delegate disclosure
 */
export function getScheduledRegistrationSuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const scheduledDate = vars.scheduled_date ? formatDisplayTime(vars.scheduled_date, vars.user_timezone) : "the scheduled time";
  const totalCost = vars.total_cost || "$0.00";
  const mandateId = vars.mandate_id ? vars.mandate_id.substring(0, 8) + '...' : 'N/A';
  const validUntil = vars.valid_until ? formatDisplayTime(vars.valid_until, vars.user_timezone) : "until booking opens";
  
  return `**Auto-Registration Scheduled**

**${programName}**
Registration opens: ${scheduledDate}

✅ We'll attempt to register you **the moment it opens**.
💳 **No charge now** — the $20 SignupAssist fee is charged **only if registration succeeds**.
🏫 Program fees (if any) are handled by the provider.

Total (if successful): ${totalCost}

Authorization ID: ${mandateId}
Valid until: ${validUntil}

All actions are logged. View your audit trail anytime via "view my registrations" (then "audit ...").

You can cancel before execution at no charge. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * SCHEDULED PAYMENT AUTH: Pre-authorization disclosure for Set-and-Forget
 */
export function getScheduledPaymentAuthorizationMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const scheduledDate = vars.scheduled_date ? formatDisplayTime(vars.scheduled_date, vars.user_timezone) : "the scheduled time";
  
  return `**Schedule Auto-Registration**

**${programName}**
Opens: ${scheduledDate}

Review the charges below. By confirming, you authorize SignupAssist to register you when booking opens and charge your card only if successful.

All actions are logged. Cancel anytime before execution at no charge.

Questions? Email ${SUPPORT_EMAIL}`;
}

// ============================================
// DISCOVERY ACTIVATION MESSAGES
// ============================================

/**
 * Initial activation message (with Set & Forget promotion)
 */
export function getInitialActivationMessage(vars: { provider_name: string }): string {
  const providerName = vars.provider_name || "your provider";
  
  return `I can help you sign up for programs at **${providerName}**.

If registration isn't open yet, I'll set up auto-registration so you're first in line when signups open.

What would you like to do?`;
}

/**
 * Fallback clarification message (MEDIUM confidence)
 */
export function getFallbackClarificationMessage(vars: { 
  provider_name: string; 
  provider_city?: string;
}): string {
  const providerName = vars.provider_name || "this provider";
  const cityPart = vars.provider_city ? ` in ${vars.provider_city}` : '';
  
  return `Are you looking to sign up with **${providerName}**${cityPart}?

If not, let me know what you're searching for.`;
}

/**
 * Graceful decline message (LOW confidence - optional)
 */
export function getGracefulDeclineMessage(): string {
  return `I can help with class signups and registrations. Tell me the organization name and I'll see what's available.`;
}

// ============================================
// INTENT ASSERTION MESSAGES (ACT FIRST, ASK LATER)
// ============================================

/**
 * INTENT_ASSERTION: Assertive first response - claims the domain immediately
 * Use this instead of hedging/asking clarification questions
 */
export function getIntentAssertionMessage(vars: {
  provider_name: string;
  activity_type?: string;
  location?: string;
}): string {
  const { provider_name, activity_type, location } = vars;
  const activityText = activity_type ? `${activity_type} programs` : 'programs';
  const locationText = location ? ` in ${location}` : '';
  
  return `I can help you sign up for **${provider_name}**'s ${activityText}${locationText}.
Let me show you the available classes.`;
}

/**
 * INTENT_ASSERTION_SIMPLE: Shorter version for known providers
 */
export function getIntentAssertionSimpleMessage(vars: {
  provider_name: string;
}): string {
  const { provider_name } = vars;
  
  return `I can help with that. Here are the programs currently available at **${provider_name}**.`;
}

/**
 * SOFT_DISAMBIGUATION: Polite fallback shown AFTER programs are displayed
 * (Not before - we show programs first, disambiguate later)
 */
export function getSoftDisambiguationMessage(vars: {
  provider_name: string;
  location?: string;
}): string {
  const { provider_name, location } = vars;
  const locationText = location ? ` in ${location}` : '';
  
  return `If you were looking for a different organization${locationText}, just let me know.`;
}

/**
 * PROGRAMS_WITH_DISAMBIGUATION: Programs message with soft disambiguation footer
 */
export function getProgramsWithDisambiguationMessage(vars: {
  provider_name: string;
  program_count: number;
  location?: string;
}): string {
  const { provider_name, program_count, location } = vars;
  const locationText = location ? ` in ${location}` : '';
  
  return `Here are ${program_count} program${program_count !== 1 ? 's' : ''} at **${provider_name}**${locationText}.

Which one would you like to sign up for?

_(If you were looking for a different organization, let me know.)_`;
}

/**
 * POST_DISCOVERY_CTA: Follow-up after showing programs
 */
export function getPostDiscoveryCTAMessage(vars: {
  provider_name?: string;
}): string {
  return `Which one would you like to sign up for, and how old is your child?`;
}

/**
 * Location question for authenticated users without stored location
 */
export function getLocationQuestionMessage(): string {
  return `Which city are you in? This helps me find local programs faster.`;
}

/**
 * Out-of-area programs offer message
 * Shows when we have programs but not in the user's location
 */
export function getOutOfAreaProgramsMessage(vars: {
  requested_city: string;
  available_city: string;
  available_state?: string;
  program_count?: number;
  activity_type?: string;
}): string {
  const { requested_city, available_city, available_state, program_count, activity_type } = vars;
  const activityText = activity_type ? `${activity_type} programs` : 'programs';
  const locationText = available_state ? `${available_city}, ${available_state}` : available_city;
  const countText = program_count ? `${program_count} ` : '';
  
  return `I found ${countText}${activityText}, but they're in **${locationText}**, not ${requested_city}. Would you like to see them anyway?`;
}
