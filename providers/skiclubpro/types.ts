/**
 * SkiClubPro Provider Type Definitions
 */

export type UrlPattern = 'subdomain' | 'path' | 'custom';

export interface UrlPatterns {
  dashboard(orgRef: string): string;
  programs(orgRef: string): string;
  registration(orgRef: string, programId: string): string;
  payment(orgRef: string): string;
  login(orgRef: string): string;
}

export interface SelectorSet {
  // Login selectors
  login?: {
    username: string;
    password: string;
    submit: string;
    postLoginCheck: string;
  };

  // Navigation selectors
  navigation?: {
    programs: string[];
    dashboard: string[];
    account: string[];
  };

  // Program listing selectors
  programListings?: {
    cards: string[];
    table: string[];
    registrationLink: string;
  };

  // Registration form selectors
  registration?: {
    childInfo: Record<string, string>;
    answers: Record<string, string>;
    submit: string;
  };

  // Payment selectors
  payment?: {
    cardNumber: string;
    expiryDate: string;
    cvv: string;
    billingFields: Record<string, string>;
    submit: string;
  };
}

export interface ProviderConfig {
  name: string;
  urlPattern: UrlPattern;
  baseUrl?: string; // For custom domains
  urls: UrlPatterns;
  selectors: SelectorSet;
}

export interface OrgConfig extends Partial<ProviderConfig> {
  orgRef: string;
  displayName: string;
  // Org-specific overrides
  customDomain?: string;
  selectorOverrides?: Partial<SelectorSet>;
}
