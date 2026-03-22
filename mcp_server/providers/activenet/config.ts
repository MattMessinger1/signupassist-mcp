/**
 * Active Network Provider Configuration
 * Registers Active Network in the provider registry
 */

import { registerProvider } from '../registry.js';

// Register Active Network provider
registerProvider({
  id: 'activenet',
  name: 'ACTIVE Network',
  urlPattern: 'custom',

  tools: {
    findPrograms: 'activenet.search_activities',
    discoverFields: 'activenet.get_activity_details'
  },

  buildBaseUrl: (_orgRef: string, _customDomain?: string) => {
    return 'http://api.amp.active.com/v2';
  },

  generateDeepLinks: (_orgRef: string, _programRef: string) => {
    // Active Network returns registrationUrlAdr directly in API response
    // Deep links are per-activity, not per-org
    return {
      search: 'http://api.amp.active.com/v2/search',
      activity_details: 'http://api.amp.active.com/v2/search'
    };
  },

  loadSelectors: async (_orgRef: string) => {
    // Active Network is API-based, no HTML selectors needed
    return {
      container: [],
      title: [],
      price: [],
      schedule: [],
      description: []
    };
  },

  determineTheme: (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
    if (t.includes('swim') || t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
    if (t.includes('soccer') || t.includes('baseball') || t.includes('basketball') || t.includes('football') || t.includes('volleyball')) return 'Team Sports';
    if (t.includes('dance') || t.includes('cheer') || t.includes('gymnastics')) return 'Dance & Movement';
    if (t.includes('art') || t.includes('craft') || t.includes('theater') || t.includes('theatre') || t.includes('music')) return 'Arts & Creative';
    if (t.includes('tennis') || t.includes('golf') || t.includes('martial') || t.includes('karate') || t.includes('fencing')) return 'Individual Sports';
    if (t.includes('coding') || t.includes('stem') || t.includes('robot') || t.includes('science') || t.includes('tech')) return 'STEM & Technology';
    return 'All Programs';
  }
});

console.log('[ActiveNetConfig] Provider configuration loaded');
