/**
 * Provider Registry for Edge Functions
 * Central registry for provider configurations
 */

export interface ProviderConfig {
  id: string;
  name: string;
  tools: {
    findPrograms: string;
    discoverFields: string;
  };
  
  // Sync configuration for automated cron jobs
  syncConfig: {
    supportsAutomatedSync: boolean; // API-based = true, Scraping = false
    method: 'edge-function' | 'mcp-tool';
    functionName?: string; // For edge-function method
    toolName?: string; // For mcp-tool method
    requiresAuth?: boolean; // Does it need credential_id?
  };
  
  generateDeepLinks: (orgRef: string, programRef: string) => Record<string, string>;
  determineTheme: (title: string) => string;
}

// Organization configuration
export interface OrgConfig {
  orgRef: string;
  providerId: string;
  displayName: string;
  category: string;
  credentialId?: string; // For providers that need auth
}

// Internal registries
const PROVIDERS: Map<string, ProviderConfig> = new Map();
const ORGANIZATIONS: Map<string, OrgConfig> = new Map();

/**
 * Register a provider
 */
export function registerProvider(config: ProviderConfig): void {
  PROVIDERS.set(config.id, config);
  console.log(`[ProviderRegistry] ✅ Registered: ${config.name} (${config.id})`);
}

/**
 * Get a provider by ID
 */
export function getProvider(providerId: string): ProviderConfig | undefined {
  return PROVIDERS.get(providerId);
}

/**
 * Get all providers
 */
export function getAllProviders(): ProviderConfig[] {
  return Array.from(PROVIDERS.values());
}

/**
 * Register an organization
 */
export function registerOrganization(config: OrgConfig): void {
  ORGANIZATIONS.set(config.orgRef, config);
  console.log(`[ProviderRegistry] ✅ Registered org: ${config.displayName} (${config.orgRef})`);
}

/**
 * Get an organization by ref
 */
export function getOrganization(orgRef: string): OrgConfig | undefined {
  return ORGANIZATIONS.get(orgRef);
}

/**
 * Get all registered organizations
 */
export function getAllOrganizations(): OrgConfig[] {
  return Array.from(ORGANIZATIONS.values());
}

/**
 * Get organizations that support automated sync (API-based only)
 */
export function getOrganizationsForAutomatedSync(): OrgConfig[] {
  return getAllOrganizations().filter(org => {
    const provider = getProvider(org.providerId);
    return provider?.syncConfig.supportsAutomatedSync === true;
  });
}

// ============================================================================
// Provider Registrations
// ============================================================================

// SkiClubPro Provider - SCRAPING-BASED (no automated sync)
registerProvider({
  id: 'skiclubpro',
  name: 'SkiClubPro',
  tools: {
    findPrograms: 'scp.find_programs',
    discoverFields: 'scp.discover_required_fields'
  },
  syncConfig: {
    supportsAutomatedSync: false, // ❌ MANUAL ONLY (Browserbase scraping)
    method: 'mcp-tool',
    toolName: 'scp.find_programs',
    requiresAuth: true
  },
  generateDeepLinks: (orgRef: string, programRef: string) => {
    const baseUrl = `https://${orgRef}.skiclubpro.team`;
    return {
      registration_start: `${baseUrl}/registration/${programRef}/start?ref=signupassist`,
      account_creation: `${baseUrl}/user/register?ref=signupassist`,
      program_details: `${baseUrl}/programs/${programRef}?ref=signupassist`
    };
  },
  determineTheme: (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
    if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
    if (t.includes('race') || t.includes('team')) return 'Races & Teams';
    return 'All Programs';
  }
});

// Bookeo Provider - API-BASED (supports automated sync)
registerProvider({
  id: 'bookeo',
  name: 'Bookeo',
  tools: {
    findPrograms: 'bookeo.find_programs',
    discoverFields: 'bookeo.discover_required_fields'
  },
  syncConfig: {
    supportsAutomatedSync: true, // ✅ AUTO SYNC (API-based)
    method: 'edge-function',
    functionName: 'sync-bookeo',
    requiresAuth: false
  },
  generateDeepLinks: (orgRef: string, programRef: string) => {
    return {
      registration_start: `https://bookeo.com/book/${programRef}?ref=signupassist`,
      account_creation: `https://bookeo.com/register?ref=signupassist`,
      program_details: `https://bookeo.com/product/${programRef}?ref=signupassist`
    };
  },
  determineTheme: (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('swim')) return 'Swimming';
    if (t.includes('stem') || t.includes('robotics')) return 'STEM';
    if (t.includes('ski')) return 'Skiing';
    return 'All Programs';
  }
});

// ============================================================================
// Organization Registrations
// ============================================================================

// Register SkiClubPro organizations
registerOrganization({
  orgRef: 'blackhawk-ski-club',
  providerId: 'skiclubpro',
  displayName: 'Blackhawk Ski Club',
  category: 'all',
  credentialId: Deno.env.get('SCP_SERVICE_CRED_ID')
});

// Register Bookeo organizations
registerOrganization({
  orgRef: 'aim-design',
  providerId: 'bookeo',
  displayName: 'AIM Design',
  category: 'all'
  // No credentialId - uses BOOKEO_API_KEY from env
});

console.log('[ProviderRegistry] Provider and organization configurations loaded');
