/**
 * Organization-specific configurations
 */

import { BLACKHAWK_CONFIG } from './blackhawk.js';
import { OrgConfig } from '../../types.js';

export const ORG_CONFIGS: Record<string, OrgConfig> = {
  'blackhawk-ski-club': BLACKHAWK_CONFIG,
  'blackhawk-ski': BLACKHAWK_CONFIG, // Alias for backward compatibility
  // Add more org configs here as needed
};

export function getOrgConfig(orgRef: string): OrgConfig | undefined {
  return ORG_CONFIGS[orgRef];
}
