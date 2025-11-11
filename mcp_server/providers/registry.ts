/**
 * Provider Registry System
 * Central registry for multi-provider support
 */

export interface SelectorSet {
  container: string[];
  title: string[];
  price?: string[];
  schedule?: string[];
  description?: string[];
  [key: string]: any;
}

export interface ProviderConfig {
  id: string; // 'skiclubpro', 'campminder', 'daysmart'
  name: string; // Display name: 'SkiClubPro'
  urlPattern: 'subdomain' | 'path' | 'custom';
  
  tools: {
    findPrograms: string; // Tool name: 'scp.find_programs'
    discoverFields: string; // Tool name: 'scp.discover_required_fields'
  };
  
  // Provider-specific behavior functions
  buildBaseUrl: (orgRef: string, customDomain?: string) => string;
  generateDeepLinks: (orgRef: string, programRef: string) => Record<string, string>;
  loadSelectors: (orgRef: string) => Promise<SelectorSet>;
  determineTheme: (title: string) => string;
}

// Internal registry
const PROVIDERS: Map<string, ProviderConfig> = new Map();

/**
 * Register a provider configuration
 */
export function registerProvider(config: ProviderConfig): void {
  if (PROVIDERS.has(config.id)) {
    console.warn(`[Registry] Provider '${config.id}' already registered, overwriting`);
  }
  PROVIDERS.set(config.id, config);
  console.log(`[Registry] ✅ Registered provider: ${config.name} (${config.id})`);
}

/**
 * Get a specific provider configuration
 */
export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.get(id);
}

/**
 * Get all registered providers
 */
export function getAllProviders(): ProviderConfig[] {
  return Array.from(PROVIDERS.values());
}

/**
 * Check if a provider is registered
 */
export function hasProvider(id: string): boolean {
  return PROVIDERS.has(id);
}

/**
 * Get provider IDs
 */
export function getProviderIds(): string[] {
  return Array.from(PROVIDERS.keys());
}
