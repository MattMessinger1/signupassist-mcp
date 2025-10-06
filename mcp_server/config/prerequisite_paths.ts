/**
 * Provider-specific prerequisite path configurations
 * Each provider defines the paths that should be checked for prerequisites
 */

export interface PrerequisitePath {
  id: string;           // Unique identifier (e.g., 'membership', 'waiver')
  label: string;        // Human-readable label for UI display
  paths: string[];      // Array of URL paths to check
}

/**
 * SkiClubPro Prerequisite Paths
 */
export const SKICLUBPRO_PREREQS: PrerequisitePath[] = [
  {
    id: 'membership',
    label: 'Membership Status',
    paths: ['/membership', '/user/membership', '/account/memberships']
  },
  {
    id: 'waiver',
    label: 'Required Waivers',
    paths: ['/waiver', '/waivers', '/account/waivers']
  },
  {
    id: 'payment',
    label: 'Payment Method',
    paths: ['/user/payment-methods', '/payment-methods', '/account/payment']
  }
];

/**
 * Provider Registry
 */
const PROVIDER_PREREQS: Record<string, PrerequisitePath[]> = {
  skiclubpro: SKICLUBPRO_PREREQS,
  // Future providers can be added here:
  // campminder: CAMPMINDER_PREREQS,
  // daysmart: DAYSMART_PREREQS,
};

/**
 * Get prerequisite paths for a specific provider
 */
export function getPrerequisitePaths(provider: string): PrerequisitePath[] {
  return PROVIDER_PREREQS[provider] || [];
}
