export const COPY = {
  trust: {
    title: "You're in control",
    bullets: [
      "Nothing is booked or charged until you press Confirm.",
      "Every step is recorded in your Audit Trail.",
      "Program fee refunds are handled by the provider. Success fee refunds are handled by SignupAssist (by Shipworx).",
    ],
    payment: "Payments are handled by Stripe / the provider. SignupAssist never sees your full card number.",
    refundHelp: "Need help with a refund? Email matt@shipworx.ai",
  },
  fees: {
    programFeeLabel: "Program fee (paid to provider)",
    serviceFeeLabel: "SignupAssist service fee",
    serviceFeeNote: "Charged only after the booking succeeds.",
  },
  audit: {
    title: "Audit Trail",
    subtitle: "A complete log of what SignupAssist did, and when.",
    ctaShowTech: "Show technical details",
    ctaHideTech: "Hide technical details",
  },
  success: {
    title: "Booked!",
    next: "Next steps",
    nextBullets: [
      "The provider will email your confirmation details.",
      'Need changes? Use "View my registrations" or contact the provider.',
    ],
  },
};

/**
 * Maps technical MCP tool names to user-friendly labels for audit trail display.
 */
export function mapToolNameToUserTitle(tool: string): string {
  if (tool.includes("confirm_booking")) return "Booked the class with the provider";
  if (tool.includes("charge_success_fee")) return "Charged the SignupAssist service fee";
  if (tool.includes("refund_success_fee")) return "Refunded the SignupAssist service fee";
  if (tool.includes("cancel_booking")) return "Cancelled the booking with the provider";
  if (tool.includes("create_customer")) return "Set up payment profile";
  if (tool.includes("save_payment_method")) return "Saved payment method";
  if (tool.includes("find_programs")) return "Found available programs";
  if (tool.includes("discover_required_fields")) return "Loaded registration form";
  if (tool.includes("create_hold")) return "Reserved your spot temporarily";
  return "Completed an action";
}
