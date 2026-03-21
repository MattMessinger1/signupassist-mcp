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
 * Provider Registry
 */
const PROVIDER_PREREQS: Record<string, PrerequisitePath[]> = {
  // Future providers can be added here:
  // bookeo: BOOKEO_PREREQS,
  // campminder: CAMPMINDER_PREREQS,
};

/**
 * Get prerequisite paths for a specific provider
 */
export function getPrerequisitePaths(provider: string): PrerequisitePath[] {
  return PROVIDER_PREREQS[provider] || [];
}
