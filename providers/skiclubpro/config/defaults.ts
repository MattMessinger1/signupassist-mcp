/**
 * SkiClubPro Default Provider Configuration
 */

import { ProviderConfig } from '../types';

export const SKICLUBPRO_DEFAULTS: ProviderConfig = {
  name: 'SkiClubPro',
  urlPattern: 'subdomain',
  
  urls: {
    login: (orgRef: string) => `https://${orgRef}.skiclubpro.team/user/login?destination=/dashboard`,
    dashboard: (orgRef: string) => `https://${orgRef}.skiclubpro.team/dashboard`,
    programs: (orgRef: string) => `https://${orgRef}.skiclubpro.team/registration`,
    registration: (orgRef: string, programId: string) => 
      `https://${orgRef}.skiclubpro.team/registration/${programId}`,
    payment: (orgRef: string) => `https://${orgRef}.skiclubpro.team/cart/checkout`,
  },

  selectors: {
    login: {
      username: '#edit-name, input[name="name"]',
      password: '#edit-pass, input[name="pass"]',
      submit: '#edit-submit, button#edit-submit, input[type="submit"]',
      postLoginCheck: 'text=Logout, a[href*="logout"]',
    },

    navigation: {
      programs: [
        'nav a.nav-link--registration:has-text("Programs")',
        'a[href="/registration"]:has-text("Programs")',
        '#block-register a[href="/registration"]',
        'nav[aria-label*="register" i] a:has-text("Programs")',
      ],
      dashboard: [
        'a[href="/dashboard"]',
        'nav a:has-text("Dashboard")',
      ],
      account: [
        'a[href*="/user/"]',
        'nav a:has-text("My Account")',
      ],
    },

    programListings: {
      cards: ['.views-row', '.card', 'article'],
      table: ['table tbody tr'],
      registrationLink: 'a[href*="/registration/"]',
    },

    registration: {
      childInfo: {
        firstName: 'input[name*="first"][name*="name"], #edit-field-first-name-0-value',
        lastName: 'input[name*="last"][name*="name"], #edit-field-last-name-0-value',
        dateOfBirth: 'input[type="date"], input[name*="birth"]',
        gender: 'select[name*="gender"], input[name*="gender"]',
      },
      answers: {
        question: '.form-item, .field-group',
        input: 'input, select, textarea',
      },
      submit: 'button[type="submit"], input[type="submit"]',
    },

    payment: {
      cardNumber: 'input[name*="card"][name*="number"]',
      expiryDate: 'input[name*="expir"]',
      cvv: 'input[name*="cvv"], input[name*="cvc"]',
      billingFields: {
        address: 'input[name*="address"]',
        city: 'input[name*="city"]',
        state: 'select[name*="state"]',
        zip: 'input[name*="zip"]',
      },
      submit: 'button[type="submit"]:has-text("Pay"), input[value*="Pay"]',
    },
  },
};
