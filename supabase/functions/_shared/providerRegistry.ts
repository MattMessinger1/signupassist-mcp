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
  generateDeepLinks: (orgRef: string, programRef: string) => Record<string, string>;
  determineTheme: (title: string) => string;
}

// Internal registry
const PROVIDERS: Map<string, ProviderConfig> = new Map();

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

// ============================================================================
// Provider Registrations
// ============================================================================

// SkiClubPro Provider
registerProvider({
  id: 'skiclubpro',
  name: 'SkiClubPro',
  tools: {
    findPrograms: 'scp.find_programs',
    discoverFields: 'scp.discover_required_fields'
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

console.log('[ProviderRegistry] Provider configurations loaded');
