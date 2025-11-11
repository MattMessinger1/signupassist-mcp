/**
 * Organization Registry
 * Central registry for all organizations across all providers
 */

export interface OrgConfig {
  orgRef: string;
  provider: string; // 'skiclubpro', 'campminder', etc.
  displayName: string;
  categories: string[];
  customDomain?: string;
  credentialId?: string; // Service credential for automated scraping
  priority: 'high' | 'normal' | 'low';
  active: boolean; // Enable/disable scraping
}

// Internal registry
const ORGANIZATIONS: Map<string, OrgConfig> = new Map();

/**
 * Register an organization
 */
export function registerOrganization(config: OrgConfig): void {
  if (ORGANIZATIONS.has(config.orgRef)) {
    console.warn(`[OrgRegistry] Organization '${config.orgRef}' already registered, overwriting`);
  }
  ORGANIZATIONS.set(config.orgRef, config);
  console.log(`[OrgRegistry] ✅ Registered: ${config.displayName} (${config.orgRef}) - Provider: ${config.provider}`);
}

/**
 * Get a specific organization
 */
export function getOrganization(orgRef: string): OrgConfig | undefined {
  return ORGANIZATIONS.get(orgRef);
}

/**
 * Get all organizations for a specific provider
 */
export function getOrganizationsByProvider(providerId: string): OrgConfig[] {
  return Array.from(ORGANIZATIONS.values())
    .filter(org => org.provider === providerId && org.active);
}

/**
 * Get all active organizations (sorted by priority)
 */
export function getAllActiveOrganizations(): OrgConfig[] {
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  return Array.from(ORGANIZATIONS.values())
    .filter(org => org.active)
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * Get all organizations (active and inactive)
 */
export function getAllOrganizations(): OrgConfig[] {
  return Array.from(ORGANIZATIONS.values());
}

/**
 * Check if an organization is registered
 */
export function hasOrganization(orgRef: string): boolean {
  return ORGANIZATIONS.has(orgRef);
}

// ============================================================================
// Organization Registrations
// ============================================================================

// SkiClubPro Organizations
registerOrganization({
  orgRef: 'blackhawk-ski-club',
  provider: 'skiclubpro',
  displayName: 'Blackhawk Ski Club',
  categories: ['all', 'lessons', 'teams', 'races', 'camps', 'clinics'],
  customDomain: 'blackhawk.skiclubpro.team',
  credentialId: process.env.SCP_SERVICE_CRED_ID,
  priority: 'high',
  active: true
});

// Example: Future SkiClubPro organizations
// registerOrganization({
//   orgRef: 'another-ski-club',
//   provider: 'skiclubpro',
//   displayName: 'Another Ski Club',
//   categories: ['all', 'lessons', 'teams'],
//   credentialId: process.env.SCP_SERVICE_CRED_ID,
//   priority: 'normal',
//   active: false
// });

// Example: Future CampMinder organizations
// registerOrganization({
//   orgRef: 'lakeside-summer-camp',
//   provider: 'campminder',
//   displayName: 'Lakeside Summer Camp',
//   categories: ['all', 'day-camp', 'overnight', 'specialty'],
//   credentialId: process.env.CAMPMINDER_SERVICE_CRED_ID,
//   priority: 'normal',
//   active: false // Not ready yet
// });

console.log('[OrgRegistry] Organization configurations loaded');
