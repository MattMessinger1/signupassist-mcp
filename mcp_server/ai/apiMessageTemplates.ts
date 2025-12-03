/**
 * API-First Message Templates
 * Pre-written parent-friendly messages for Bookeo and other API providers
 * (No login, no prerequisites - direct booking flow)
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
}

/**
 * BROWSE step: Programs ready message
 */
export function getAPIProgramsReadyMessage(vars: APIMessageVariables): string {
  const providerName = vars.provider_name || "your provider";
  const count = vars.program_count || 0;
  
  return `✅ I found **${count}** available class${count !== 1 ? 'es' : ''} at ${providerName}. Browse below and tap any card to sign up — no login required! 🎉`;
}

/**
 * FORM step: Signup form intro
 */
export function getAPIFormIntroMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `Great choice! To sign up for **${programName}**, I'll need a few details. This info goes directly to the provider — we only collect what's essential for registration.`;
}

/**
 * PAYMENT step: Booking summary (legacy - kept for backward compatibility)
 */
export function getAPIPaymentSummaryMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const participantName = vars.participant_name || "your participant";
  const totalCost = vars.total_cost || "$0.00";
  const numParticipants = vars.num_participants || 1;
  
  return `Perfect! Here's your booking summary:

**Program:** ${programName}
**Participant:** ${participantName}
**Number of Participants:** ${numParticipants}
**Total:** ${totalCost}

Ready to confirm? By proceeding, you authorize SignupAssist to complete this registration on your behalf.`;
}

/**
 * PAYMENT AUTHORIZATION: Dual-charge breakdown (Program Fee + $20 Success Fee)
 */
export function getPaymentAuthorizationMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const participantName = vars.participant_name || "your participant";
  const programFee = vars.total_cost || "$0.00";
  const successFee = "$20.00";
  const numParticipants = vars.num_participants || 1;
  
  // Calculate total (program fee + success fee)
  const programFeeValue = parseFloat(programFee.replace(/[^0-9.]/g, '')) || 0;
  const successFeeValue = 20.00;
  const grandTotal = `$${(programFeeValue + successFeeValue).toFixed(2)}`;
  
  return `Perfect! Here's your booking summary:

**Program:** ${programName}
**Participant${numParticipants > 1 ? 's' : ''}:** ${participantName}
**Number of Participants:** ${numParticipants}

**Charges:**
• **Program Fee:** ${programFee} (paid to provider via Bookeo)
• **SignupAssist Success Fee:** ${successFee} (charged only if registration succeeds)

**Total:** ${grandTotal}

**Cancellation Policy:** If you cancel a confirmed booking and the provider accepts the cancellation, your $20 SignupAssist fee will be refunded. Questions? Email ${SUPPORT_EMAIL}

Ready to confirm? By proceeding, you authorize SignupAssist to complete this registration on your behalf.`;
}

/**
 * SUCCESS: Booking confirmed
 */
export function getAPISuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const bookingNumber = vars.booking_number || "N/A";
  const startTime = vars.start_time || "TBD";
  const providerName = vars.provider_name || "the provider";
  
  return `🎉 Success! You're all signed up for **${programName}**!

**Booking #${bookingNumber}**
Starts: ${startTime}

📧 ${providerName} will send your confirmation email directly.

**What's next?**
For any questions about your registration, class details, or changes — please contact ${providerName} directly. SignupAssist's job is done here!

Thanks for letting us help with signup. Enjoy your class!`;
}

/**
 * ERROR: Booking failed
 */
export function getAPIErrorMessage(vars: APIMessageVariables): string {
  const providerName = vars.provider_name || "the provider";
  
  return `Oops, I ran into a snag connecting to ${providerName}. Let's try again — sometimes these APIs need a moment. Ready to retry?`;
}

// ============================================
// CANCELLATION FLOW MESSAGES
// ============================================

/**
 * CANCEL STEP 1: Pending registration confirmation
 */
export function getPendingCancelConfirmMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `⚠️ **Cancel Scheduled Registration?**

You're about to cancel your scheduled auto-registration for **${programName}**.

Since no booking has been made yet, **no charges apply**.

Are you sure you want to cancel?

_Questions? Email ${SUPPORT_EMAIL}_`;
}

/**
 * CANCEL STEP 1: Confirmed booking cancellation (with refund policy)
 */
export function getConfirmedCancelConfirmMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  const bookingNumber = vars.booking_number || "N/A";
  
  return `⚠️ **Cancel Confirmed Booking?**

You're requesting to cancel **${programName}** (Booking #${bookingNumber}).

**Important:** Cancellation is subject to ${providerName}'s policy.

**If ${providerName} accepts cancellation:**
✅ Your booking will be cancelled
✅ Your $20 SignupAssist fee will be refunded

**If ${providerName} blocks cancellation:**
❌ Your booking remains active
❌ No refund will be issued
❌ You'll need to contact ${providerName} directly

_Program fees are handled directly by ${providerName}._

Are you sure you want to attempt cancellation?

_Questions? Email ${SUPPORT_EMAIL}_`;
}

/**
 * CANCEL SUCCESS: Booking cancelled and refunded
 */
export function getCancelSuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  
  return `✅ **Booking Cancelled**

Your registration for **${programName}** has been cancelled with ${providerName}.

💰 **$20 SignupAssist fee refunded** — you should see it in 5-10 business days.

_For questions about program fee refunds, please contact ${providerName} directly._

_Need help? Email ${SUPPORT_EMAIL}_`;
}

/**
 * CANCEL FAILED: Provider blocked cancellation
 */
export function getCancelFailedMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  const providerName = vars.provider_name || "the provider";
  const bookingNumber = vars.booking_number || "N/A";
  
  return `❌ **Cancellation Not Accepted**

${providerName} was unable to cancel your booking for **${programName}** (Booking #${bookingNumber}).

**Your booking remains active.** This may be due to the provider's cancellation policy (e.g., too close to start date, non-refundable class, etc.)

**Next steps:**
1. Contact ${providerName} directly to discuss cancellation options
2. Review the program's cancellation policy

_No SignupAssist fee refund is issued unless the booking is cancelled._

_Questions? Email ${SUPPORT_EMAIL}_`;
}

/**
 * CANCEL SUCCESS: Pending registration (no booking was made)
 */
export function getPendingCancelSuccessMessage(vars: APIMessageVariables): string {
  const programName = vars.program_name || "this program";
  
  return `✅ **Registration Cancelled**

Your scheduled auto-registration for **${programName}** has been cancelled.

No booking was made, so no charges apply.

_You can schedule a new registration anytime by browsing programs._

_Need help? Email ${SUPPORT_EMAIL}_`;
}

/**
 * RECEIPTS FOOTER: Support info
 */
export function getReceiptsFooterMessage(): string {
  return `🔒 _Your payment information is securely stored with Stripe. SignupAssist never sees your full card number._

_Questions about refunds or charges? Email ${SUPPORT_EMAIL}_`;
}
