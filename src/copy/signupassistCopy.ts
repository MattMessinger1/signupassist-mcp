export const COPY = {
  trust: {
    title: "You're in control",
    bullets: [
      "Nothing is booked or charged until you press Confirm.",
      "Every step is recorded in your Audit Trail.",
      "Program fee refunds are handled by the provider. Success fee refunds are handled by SignupAssist (by Shipworx).",
    ],
    payment: "Payments are handled by Stripe / the provider. SignupAssist never sees your full card number.",
    refundHelp: "Need help with a refund? Email support@shipworx.ai",
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

/**
 * Maps technical scope strings to user-friendly labels with icons.
 */
export function mapScopeToFriendly(scope: string): { icon: string; label: string } {
  const scopeMap: Record<string, { icon: string; label: string }> = {
    'scp:register': { icon: '✓', label: 'Register for programs' },
    'scp:browse': { icon: '✓', label: 'Browse programs' },
    'scp:discover': { icon: '✓', label: 'Discover form fields' },
    'scp:login': { icon: '✓', label: 'Access provider account' },
    'platform:success_fee': { icon: '✓', label: 'Charge success fee' },
    'platform:refund': { icon: '✓', label: 'Process refunds' },
    'platform:billing': { icon: '✓', label: 'Manage billing' },
  };
  return scopeMap[scope] || { icon: '•', label: scope };
}

/**
 * Formats an array of scopes into a user-friendly string.
 */
export function formatScopesForDisplay(scopes: string[]): string {
  return scopes.map(s => {
    const { icon, label } = mapScopeToFriendly(s);
    return `${icon} ${label}`;
  }).join(', ');
}
