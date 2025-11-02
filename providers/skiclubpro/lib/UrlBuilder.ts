/**
 * UrlBuilder - Handles URL construction for different org patterns
 */

import { UrlPattern, ProviderConfig, OrgConfig } from '../types.js';
import { SKICLUBPRO_DEFAULTS } from '../config/defaults.js';
import { getOrgConfig } from '../config/orgs/index.js';

/**
 * Resolve base URL for an organization
 * Single source of truth - prevents URL inconsistencies
 */
export function resolveBaseUrl(org_ref: string): string {
  // FIX: Single consistent URL per org (no hyphen flipping)
  if (org_ref === "blackhawk-ski" || org_ref === "blackhawk-ski-club") {
    return "https://blackhawk.skiclubpro.team";
  }
  
  // Default pattern for other orgs
  return `https://${org_ref}.skiclubpro.team`;
}

export class UrlBuilder {
  private providerConfig: ProviderConfig;
  private orgConfig?: OrgConfig;
  private baseUrl: string;

  constructor(orgRef: string, providerConfig?: ProviderConfig) {
    this.baseUrl = resolveBaseUrl(orgRef);
    this.providerConfig = providerConfig || SKICLUBPRO_DEFAULTS;
    this.orgConfig = getOrgConfig(orgRef);
  }

  /**
   * Get the dashboard URL for the organization
   */
  dashboard(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/dashboard`;
    }
    return `${this.baseUrl}/dashboard`;
  }

  /**
   * Get the programs listing URL
   */
  programs(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/registration`;
    }
    return `${this.baseUrl}/registration`;
  }

  /**
   * Get the registration URL for a specific program
   */
  registration(orgRef: string, programId: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/registration/${programId}`;
    }
    return `${this.baseUrl}/registration/${programId}`;
  }

  /**
   * Get the payment/checkout URL
   */
  payment(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/cart/checkout`;
    }
    return `${this.baseUrl}/cart/checkout`;
  }

  /**
   * Get the login URL
   */
  login(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/user/login?destination=/registration`;
    }
    return `${this.baseUrl}/user/login?destination=/registration`;
  }
}
