/**
 * SelectorResolver - Merges provider defaults, org overrides, and generic fallbacks
 */

import { SelectorSet, ProviderConfig, OrgConfig } from '../types.js';
import { SKICLUBPRO_DEFAULTS } from '../config/defaults.js';
import { getOrgConfig } from '../config/orgs/index.js';

export class SelectorResolver {
  private providerConfig: ProviderConfig;
  private orgConfig?: OrgConfig;

  constructor(orgRef: string, providerConfig?: ProviderConfig) {
    this.providerConfig = providerConfig || SKICLUBPRO_DEFAULTS;
    this.orgConfig = getOrgConfig(orgRef);
  }

  /**
   * Resolve selectors for a given key with fallbacks
   * Priority: org overrides → provider defaults → generic fallbacks
   */
  resolve(category: keyof SelectorSet, field?: string): string[] {
    const genericFallbacks: Record<string, string[]> = {
      programCards: ['[class*="program"]', '[id*="program"]', '.views-row', '.card'],
      programTable: ['table tbody tr', '[class*="listing"] tr'],
      registrationLink: ['a[href*="registration"]', 'a[href*="register"]'],
      submitButton: ['button[type="submit"]', 'input[type="submit"]', '[class*="submit"]'],
    };

    // Get provider defaults
    const providerSelectors = this.providerConfig.selectors[category];
    
    // Get org overrides
    const orgSelectors = this.orgConfig?.selectorOverrides?.[category];

    if (field && typeof providerSelectors === 'object' && typeof orgSelectors === 'object') {
      // Merge field-level selectors
      const orgValue = (orgSelectors as any)[field];
      const providerValue = (providerSelectors as any)[field];
      
      if (Array.isArray(orgValue)) return orgValue;
      if (typeof orgValue === 'string') return [orgValue];
      if (Array.isArray(providerValue)) return providerValue;
      if (typeof providerValue === 'string') return [providerValue];
    }

    // Return category-level selectors
    if (Array.isArray(orgSelectors)) return orgSelectors;
    if (Array.isArray(providerSelectors)) return providerSelectors;

    // Fallback to generic selectors
    const fallbackKey = field || category;
    return genericFallbacks[fallbackKey] || [];
  }

  /**
   * Get all selectors for a category (flattened)
   */
  getAll(category: keyof SelectorSet): string[] {
    const selectors = this.providerConfig.selectors[category];
    const orgOverrides = this.orgConfig?.selectorOverrides?.[category];

    const result: string[] = [];

    // Add org overrides first
    if (orgOverrides) {
      if (Array.isArray(orgOverrides)) {
        result.push(...orgOverrides);
      } else if (typeof orgOverrides === 'object') {
        Object.values(orgOverrides).forEach(val => {
          if (typeof val === 'string') result.push(val);
          if (Array.isArray(val)) result.push(...val);
        });
      }
    }

    // Add provider defaults
    if (selectors) {
      if (Array.isArray(selectors)) {
        result.push(...selectors);
      } else if (typeof selectors === 'object') {
        Object.values(selectors).forEach(val => {
          if (typeof val === 'string') result.push(val);
          if (Array.isArray(val)) result.push(...val);
        });
      }
    }

    return [...new Set(result)]; // Remove duplicates
  }
}
