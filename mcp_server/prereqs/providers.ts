// mcp_server/prereqs/providers.ts
import { registerProvider } from './registry.js';
import { SkiClubProCheckers } from '../config/providers/skiclubpro/prereqs.js';
import { BlackhawkConfig } from '../config/providers/skiclubpro/orgs/blackhawk.js';

const ORG_OVERRIDES: Record<string, { customDomain?: string }> = {
  'blackhawk-ski-club': { customDomain: BlackhawkConfig.customDomain }
};

export function getOrgOverride(orgRef: string) {
  return ORG_OVERRIDES[orgRef] || {};
}

export function registerAllProviders() {
  registerProvider('skiclubpro', SkiClubProCheckers);
  // future: registerProvider('campminder', CampMinderCheckers) ...
}
