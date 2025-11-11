/**
 * SkiClubPro Provider Configuration
 * Registers SkiClubPro-specific behavior in the provider registry
 */

import { registerProvider, type SelectorSet } from '../registry.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load selectors from base.json
 */
async function loadSelectors(orgRef: string): Promise<SelectorSet> {
  try {
    // Load base selectors from config file
    const configPath = join(__dirname, '../../config/providers/skiclubpro/base.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    
    // Return registration page selectors
    const selectors = config.selectorProfiles['skiclubpro-registration'];
    
    return {
      container: Array.isArray(selectors.container) ? selectors.container : [selectors.container],
      title: Array.isArray(selectors.title) ? selectors.title : [selectors.title],
      price: selectors.price ? (Array.isArray(selectors.price) ? selectors.price : [selectors.price]) : [],
      schedule: ['.views-field-field-schedule', '.schedule', 'td:has-text("AM")', 'td:has-text("PM")'],
      ...selectors
    };
  } catch (error) {
    console.error('[SkiClubPro] Failed to load selectors:', error);
    // Fallback to default selectors
    return {
      container: ['.views-row', '.program-card', 'article'],
      title: ['.views-field-title', '.program-title', 'h3'],
      price: ['.views-field-field-price', '.price'],
      schedule: ['.views-field-field-schedule', '.schedule']
    };
  }
}

/**
 * Determine program theme from title
 */
function determineTheme(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
  if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
  if (t.includes('race') || t.includes('team') || t.includes('competition')) return 'Races & Teams';
  return 'All Programs';
}

/**
 * Build base URL for organization
 */
function buildBaseUrl(orgRef: string, customDomain?: string): string {
  // Handle blackhawk special case
  if (orgRef === "blackhawk-ski" || orgRef === "blackhawk-ski-club") {
    return customDomain ? `https://${customDomain}` : "https://blackhawk.skiclubpro.team";
  }
  
  // Default pattern for other orgs
  const domain = customDomain || `${orgRef}.skiclubpro.team`;
  return `https://${domain}`;
}

/**
 * Generate deep links for a program
 */
function generateDeepLinks(orgRef: string, programRef: string): Record<string, string> {
  const baseUrl = buildBaseUrl(orgRef);
  const registrationUrl = `${baseUrl}/registration/${programRef}/start`;
  const accountUrl = `${baseUrl}/user/register`;
  const detailsUrl = `${baseUrl}/programs/${programRef}`;
  
  return {
    registration_start: `${registrationUrl}?ref=signupassist&utm_source=chatgpt_app&utm_medium=acp`,
    account_creation: `${accountUrl}?ref=signupassist&prefill=guardian&utm_source=chatgpt_app`,
    program_details: `${detailsUrl}?ref=signupassist&utm_source=chatgpt_app`
  };
}

// Register SkiClubPro provider
registerProvider({
  id: 'skiclubpro',
  name: 'SkiClubPro',
  urlPattern: 'subdomain',
  
  tools: {
    findPrograms: 'scp.find_programs',
    discoverFields: 'scp.discover_required_fields'
  },
  
  buildBaseUrl,
  generateDeepLinks,
  loadSelectors,
  determineTheme
});

console.log('[SkiClubPro] Provider configuration loaded');
