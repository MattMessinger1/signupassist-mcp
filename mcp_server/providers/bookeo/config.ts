/**
 * Bookeo Provider Configuration
 * Registers Bookeo in the provider registry
 */

import { registerProvider } from '../registry.js';

// Register Bookeo provider
registerProvider({
  id: 'bookeo',
  name: 'Bookeo',
  urlPattern: 'custom',
  
  tools: {
    findPrograms: 'bookeo.find_programs',
    discoverFields: 'bookeo.discover_required_fields',
    createHold: 'bookeo.create_hold',
    confirmBooking: 'bookeo.confirm_booking'
  },
  
  buildBaseUrl: (orgRef: string, customDomain?: string) => {
    // Bookeo uses API-based access, not subdomain URLs
    return `https://api.bookeo.com/v2`;
  },
  
  generateDeepLinks: (orgRef: string, programRef: string) => {
    // Bookeo uses API-based booking, deep links point to API endpoints
    return {
      booking_start: `https://api.bookeo.com/v2/bookings`,
      product_details: `https://api.bookeo.com/v2/settings/products/${programRef}`,
      availability: `https://api.bookeo.com/v2/availability/slots`
    };
  },
  
  loadSelectors: async (orgRef: string) => {
    // Bookeo is API-based, no HTML selectors needed
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
    if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
    if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
    if (t.includes('event') || t.includes('workshop')) return 'Events & Workshops';
    if (t.includes('tour') || t.includes('experience')) return 'Tours & Experiences';
    return 'All Programs';
  }
});

console.log('[BookeoConfig] Provider configuration loaded');
