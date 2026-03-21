/**
 * Organization Registry
 * Central registry for all organizations across all providers
 */

export interface OrgConfig {
  orgRef: string;
  provider: string; // 'bookeo', 'campminder', etc.
  displayName: string;
  /** IANA timezone for provider-local display (e.g., "America/Chicago"). Stored timestamps remain UTC. */
  timeZone?: string;
  
  // Search & Discovery
  searchKeywords: string[];     // ["bookeo", "booking", "classes"]
  activityTypes?: string[];     // Normalized activity types this org offers: ["coding", "robotics", "stem"]
  location?: {                  // Optional for organizations
    city?: string;
    state?: string;
    lat?: number;
    lng?: number;
  };
  
  categories: string[];
  
  // Backend-specific config (new preferred way)
  apiConfig?: {
    bookeo?: { 
      accountId: string;        // "bookeo-default"
    };
    campminder?: { 
      siteId: string;
    };
  };
  
  // DEPRECATED: Use apiConfig instead
  customDomain?: string;
  
  priority: 'high' | 'normal' | 'low';
  active: boolean; // Enable/disable organization in search and flows
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

// AIM Design - Bookeo Organization (PRIMARY)
registerOrganization({
  orgRef: 'aim-design',
  provider: 'bookeo',
  displayName: 'AIM Design',
  timeZone: 'America/Chicago',
  searchKeywords: ['bookeo', 'booking', 'classes', 'aim', 'aim design', 'robotics', 'stem', 'science', 'sensors', 'ocean', 'marine', 'ski jumping'],
  activityTypes: ['coding', 'robotics', 'stem', 'skiing'],  // Activities AIM Design actually offers
  location: {
    city: 'Madison',
    state: 'WI'
  },
  categories: ['all', 'lessons', 'stem', 'science', 'sports'],
  apiConfig: {
    bookeo: { 
      accountId: 'aim-design'
    }
  },
  priority: 'high',
  active: true
});

console.log('[OrgRegistry] Organization configurations loaded');
