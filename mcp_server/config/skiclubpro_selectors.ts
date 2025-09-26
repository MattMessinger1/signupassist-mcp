export interface SkiClubProConfig {
  domain: string;
  selectors: {
    loginEmail: string;
    loginPassword?: string;
    loginSubmit: string;
    createName: string;
    createEmail: string;
    createPhone: string;
    createPassword: string;
    createPasswordConfirm?: string;
    createSubmit: string;
    membershipPage: string;
    membershipBuyButton: string;
  };
}

export const SKICLUBPRO_CONFIGS: Record<string, SkiClubProConfig> = {
  "blackhawk-ski-club": {
    domain: "blackhawk.skiclubpro.team",
    selectors: {
      loginEmail: 'input[name="email"]',
      loginPassword: 'input[name="password"]',
      loginSubmit: 'button[type="submit"], input[type="submit"]',
      createName: 'input[name="name"], input[name="full_name"]',
      createEmail: 'input[name="email"]',
      createPhone: 'input[name="phone"]',
      createPassword: 'input[name="password"]',
      createPasswordConfirm: 'input[name="password_confirm"]',
      createSubmit: 'button[type="submit"], input[type="submit"]',
      membershipPage: "/list/memberships",
      membershipBuyButton: "button.purchaseMembership"
    }
  },

  // Example for another club
  "oak-park-ski-club": {
    domain: "oakpark.skiclubpro.team",
    selectors: {
      loginEmail: 'input[name="email"]',
      loginPassword: 'input[name="password"]',
      loginSubmit: 'button[type="submit"]',
      createName: '#fullName',
      createEmail: '#userEmail',
      createPhone: '#userPhone',
      createPassword: '#password',
      createPasswordConfirm: '#passwordConfirm',
      createSubmit: 'button#create',
      membershipPage: "/memberships",
      membershipBuyButton: ".btn-buy"
    }
  },

  // Default fallback config for unknown orgs
  "default": {
    domain: "app.skiclubpro.com",
    selectors: {
      loginEmail: 'input[type="email"], input[name="email"], #email',
      loginPassword: 'input[type="password"], input[name="password"], #password',
      loginSubmit: 'button[type="submit"], input[type="submit"], .login-btn, .continue-btn',
      createName: 'input[name="name"], input[name="full_name"], #name',
      createEmail: 'input[name="email"], input[type="email"], #email',
      createPhone: 'input[name="phone"], input[type="tel"], #phone',
      createPassword: 'input[type="password"], input[name="password"], #password',
      createPasswordConfirm: 'input[name="password_confirm"], input[name="confirmPassword"]',
      createSubmit: 'button[type="submit"], input[type="submit"], .register-btn, .create-account-btn',
      membershipPage: "/membership",
      membershipBuyButton: ".purchase-btn, .buy-btn, .join-btn"
    }
  }
};

/**
 * Get configuration for a specific org_ref, with fallback to default
 */
export function getSkiClubProConfig(org_ref: string): SkiClubProConfig {
  return SKICLUBPRO_CONFIGS[org_ref] || SKICLUBPRO_CONFIGS["default"];
}