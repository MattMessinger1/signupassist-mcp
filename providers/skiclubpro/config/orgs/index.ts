/**
 * Organization-specific configurations
 */

import { BLACKHAWK_CONFIG } from './blackhawk';
import { OrgConfig } from '../../types';

export const ORG_CONFIGS: Record<string, OrgConfig> = {
  'blackhawk-ski-club': BLACKHAWK_CONFIG,
  // Add more org configs here as needed
};

export function getOrgConfig(orgRef: string): OrgConfig | undefined {
  return ORG_CONFIGS[orgRef];
}
