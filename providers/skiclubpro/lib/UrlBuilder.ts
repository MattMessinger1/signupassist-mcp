/**
 * UrlBuilder - Handles URL construction for different org patterns
 */

import { UrlPattern, ProviderConfig, OrgConfig } from '../types';
import { SKICLUBPRO_DEFAULTS } from '../config/defaults';
import { getOrgConfig } from '../config/orgs';

export class UrlBuilder {
  private providerConfig: ProviderConfig;
  private orgConfig?: OrgConfig;

  constructor(orgRef: string, providerConfig?: ProviderConfig) {
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
    return this.providerConfig.urls.dashboard(orgRef);
  }

  /**
   * Get the programs listing URL
   */
  programs(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/registration`;
    }
    return this.providerConfig.urls.programs(orgRef);
  }

  /**
   * Get the registration URL for a specific program
   */
  registration(orgRef: string, programId: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/registration/${programId}`;
    }
    return this.providerConfig.urls.registration(orgRef, programId);
  }

  /**
   * Get the payment/checkout URL
   */
  payment(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/cart/checkout`;
    }
    return this.providerConfig.urls.payment(orgRef);
  }

  /**
   * Get the login URL
   */
  login(orgRef: string): string {
    if (this.orgConfig?.customDomain) {
      return `https://${this.orgConfig.customDomain}/user/login?destination=/dashboard`;
    }
    return this.providerConfig.urls.login(orgRef);
  }
}
