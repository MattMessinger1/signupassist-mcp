/**
 * Consent Requirements and Validation
 * Pure definitions for consent handling in registration flows
 */

export interface ConsentRequirement {
  id: string;
  label: string;
  required: boolean;
}

/**
 * Standard consent items for immediate registration
 */
export const STANDARD_CONSENTS: ConsentRequirement[] = [
  { id: 'login', label: 'Authorize SignupAssist to log in to the activity provider on my behalf', required: true },
  { id: 'fill', label: 'Allow form fields to be filled with my provided information', required: true },
  { id: 'payment', label: 'Process payment for the program fee through the provider', required: true },
  { id: 'delegate', label: 'I understand SignupAssist acts as my authorized delegate', required: true },
];

/**
 * Consent sections for mandate/scheduled registration (detailed view)
 */
export interface ConsentSection {
  title: string;
  icon: string;
  items: string[];
}

/**
 * Build consent sections for mandate authorization
 */
export function buildMandateConsentSections(
  childName: string,
  maxAmount: string,
  validUntil: string
): ConsentSection[] {
  return [
    {
      title: "What we're asking permission for",
      icon: '✓',
      items: [
        'Log into your account when registration opens',
        `Fill out and submit the registration form for ${childName}`,
        `Process payment up to ${maxAmount} using your saved payment method`,
      ]
    },
    {
      title: 'How it works',
      icon: '✓',
      items: [
        'We create a cryptographically signed "mandate" (permission token)',
        `This mandate authorizes these specific actions until ${validUntil}`,
        'The mandate cannot be reused after expiration',
      ]
    },
    {
      title: 'Security guarantees',
      icon: '🔐',
      items: [
        'Your credentials are encrypted end-to-end',
        'We never see your full credit card number',
        'Registration happens in an isolated browser session',
        'Session is destroyed immediately after completion',
      ]
    },
    {
      title: 'Full transparency',
      icon: '📋',
      items: [
        'Every action is logged in your audit trail',
        'Screenshots captured at key moments (form filled, confirmation)',
        'Final outcome recorded (success or any blockers)',
      ]
    },
    {
      title: 'Your control',
      icon: '🎮',
      items: [
        'You can revoke this at any time from your audit trail',
        'Mandate expires automatically after registration',
        "If we hit a blocker (CAPTCHA, new waiver), we'll pause and notify you",
      ]
    },
  ];
}

/**
 * Check if all required consents have been given
 */
export function areAllConsentsGiven(
  consents: Record<string, boolean>,
  requirements: ConsentRequirement[] = STANDARD_CONSENTS
): boolean {
  return requirements.every(item => !item.required || consents[item.id]);
}

/**
 * Count how many consents are still needed
 */
export function countMissingConsents(
  consents: Record<string, boolean>,
  requirements: ConsentRequirement[] = STANDARD_CONSENTS
): number {
  return requirements.filter(item => item.required && !consents[item.id]).length;
}

/**
 * Mandate scope for building consent messages
 */
export interface MandateScope {
  program: string;
  child: string;
  maxAmount: string;
  validUntil: string;
}

/**
 * Build a simple consent message summary
 */
export function buildConsentSummary(scope: MandateScope): string[] {
  return [
    `By authorizing this plan, you allow SignupAssist to:`,
    `• Log into your account when registration opens`,
    `• Fill out and submit the registration form for ${scope.child}`,
    `• Process payment up to ${scope.maxAmount}`,
    ``,
    `This authorization is valid until ${scope.validUntil}.`,
  ];
}
