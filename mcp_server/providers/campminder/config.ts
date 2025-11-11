/**
 * CampMinder Provider Configuration (Example)
 * Demonstrates how to add a new provider to the registry
 */

import { registerProvider, type SelectorSet } from '../registry.js';

/**
 * Load selectors for CampMinder
 */
async function loadSelectors(orgRef: string): Promise<SelectorSet> {
  // CampMinder-specific selectors
  return {
    container: ['.program-card', '.session-item', '.camp-listing'],
    title: ['.program-title', 'h3.session-name', '.camp-name'],
    price: ['.price-display', '.session-fee', '.camp-price'],
    schedule: ['.schedule-info', '.session-dates', '.camp-schedule'],
    description: ['.program-description', '.session-details']
  };
}

/**
 * Determine program theme from title
 */
function determineTheme(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('day camp')) return 'Day Camps';
  if (t.includes('overnight') || t.includes('sleepaway')) return 'Overnight Camps';
  if (t.includes('specialty') || t.includes('sports')) return 'Specialty Programs';
  if (t.includes('teen') || t.includes('leadership')) return 'Teen Programs';
  return 'All Programs';
}

/**
 * Build base URL for organization
 */
function buildBaseUrl(orgRef: string, customDomain?: string): string {
  if (customDomain) {
    return `https://${customDomain}`;
  }
  return `https://www.campminder.com/${orgRef}`;
}

/**
 * Generate deep links for a program
 */
function generateDeepLinks(orgRef: string, programRef: string): Record<string, string> {
  const baseUrl = buildBaseUrl(orgRef);
  
  return {
    registration_start: `${baseUrl}/enroll/${programRef}?ref=signupassist`,
    account_creation: `${baseUrl}/account/create?ref=signupassist`,
    program_details: `${baseUrl}/programs/${programRef}?ref=signupassist`
  };
}

// Register CampMinder provider
// (Commented out until implementation is complete)
/*
registerProvider({
  id: 'campminder',
  name: 'CampMinder',
  urlPattern: 'path',
  
  tools: {
    findPrograms: 'cm.find_programs',
    discoverFields: 'cm.discover_required_fields'
  },
  
  buildBaseUrl,
  generateDeepLinks,
  loadSelectors,
  determineTheme
});

console.log('[CampMinder] Provider configuration loaded');
*/

export { loadSelectors, determineTheme, buildBaseUrl, generateDeepLinks };
