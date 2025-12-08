/**
 * API-First Message Templates
 * Concise, parent-friendly messages for Bookeo and other API providers
 */

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
}

/**
 * Format ISO timestamp to user-friendly display
 * "2025-12-19T13:00:00-06:00" → "Dec 19 at 1:00 PM"
 */
export function formatDisplayTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
    if (isNaN(date.getTime())) return isoTime;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) 
      + ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoTime;
  }
}

/**
 * BROWSE step: Programs ready message
 */
export function getAPIProgramsReadyMessage(vars: APIMessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  const count = vars.program_count || 0;
  
  return `Found ${count} class${count !== 1 ? 'es' : ''} at ${providerName}. Tap any card to sign up.`;
}

/**
 * FORM step: Signup form intro
 */
export function getAPIFormIntroMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `Great choice! To sign up for **${programName}**, I'll need a few details.`;
}

/**
 * PAYMENT step: Booking summary (legacy - kept for backward compatibility)
 */
export function getAPIPaymentSummaryMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `Ready to complete registration for **${programName}**?

Review the charges below. By confirming, you authorize SignupAssist to complete this registration on your behalf.`;
}

/**
 * PAYMENT AUTHORIZATION: Clean message (fees shown by FeeBreakdown component)
 */
export function getPaymentAuthorizationMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `Ready to complete registration for **${programName}**?

Review the charges below. By confirming, you authorize SignupAssist to complete this registration on your behalf.

Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * SUCCESS: Booking confirmed
 */
export function getAPISuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const bookingNumber = vars.booking_number || "N/A";
  const startTime = vars.start_time ? formatDisplayTime(vars.start_time) : "TBD";
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
  const scheduledDate = vars.scheduled_date ? formatDisplayTime(vars.scheduled_date) : "the scheduled time";
  const totalCost = vars.total_cost || "$0.00";
  const mandateId = vars.mandate_id ? vars.mandate_id.substring(0, 8) + '...' : 'N/A';
  const validUntil = vars.valid_until ? formatDisplayTime(vars.valid_until) : "until booking opens";
  
  return `**Auto-Registration Scheduled**

**${programName}**
Opens: ${scheduledDate}
Total (if successful): ${totalCost}

Authorization ID: ${mandateId}
Valid until: ${validUntil}

All actions are logged. View your audit trail anytime via "View Receipts".

You can cancel before execution at no charge. Questions? Email ${SUPPORT_EMAIL}`;
}

/**
 * SCHEDULED PAYMENT AUTH: Pre-authorization disclosure for Set-and-Forget
 */
export function getScheduledPaymentAuthorizationMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const scheduledDate = vars.scheduled_date ? formatDisplayTime(vars.scheduled_date) : "the scheduled time";
  
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

/**
 * Location question for authenticated users without stored location
 */
export function getLocationQuestionMessage(): string {
  return `Which city are you in? This helps me find local programs faster.`;
}
