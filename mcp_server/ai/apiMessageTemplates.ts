/**
 * API-First Message Templates
 * Pre-written parent-friendly messages for Bookeo and other API providers
 * (No login, no prerequisites - direct booking flow)
 */

export interface APIMessageVariables {
  provider_name?: string;
  program_count?: number;
  program_name?: string;
  participant_name?: string;
  total_cost?: string;
  num_participants?: number;
  booking_number?: string;
  start_time?: string;
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

Thanks for letting us help with signup. Enjoy your class! 🙌`;
}

/**
 * ERROR: Booking failed
 */
export function getAPIErrorMessage(vars: APIMessageVariables): string {
  const providerName = vars.provider_name || "the provider";
  
  return `Oops, I ran into a snag connecting to ${providerName}. Let's try again — sometimes these APIs need a moment. Ready to retry?`;
}
