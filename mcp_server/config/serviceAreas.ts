/**
 * Service Area Configuration
 * 
 * Defines which regions SignupAssist currently covers, 
 * planned expansion areas, and waitlist-eligible regions.
 */

export interface ServiceRegion {
  city: string;
  state: string;
  stateFull: string;
  status: 'active' | 'coming_soon' | 'waitlist';
  launchDate?: string;  // ISO date for coming_soon
  providers?: string[]; // Known providers in this area
}

// Currently active service areas
export const ACTIVE_REGIONS: ServiceRegion[] = [
  // Madison, WI metro area
  { city: 'Madison', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Middleton', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Verona', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Fitchburg', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Waunakee', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Sun Prairie', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Monona', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Cottage Grove', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'DeForest', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Oregon', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Stoughton', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Mount Horeb', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
  { city: 'Cross Plains', state: 'WI', stateFull: 'Wisconsin', status: 'active', providers: ['blackhawk-ski-club'] },
];

// Coming soon regions (announced expansion)
export const COMING_SOON_REGIONS: ServiceRegion[] = [
  // Placeholder for future expansion
  // { city: 'Milwaukee', state: 'WI', stateFull: 'Wisconsin', status: 'coming_soon', launchDate: '2025-Q2' },
];

// All waitlist-eligible states/regions
export const WAITLIST_REGIONS = [
  'IL', 'MN', 'MI', 'IA',  // Midwest neighbors
  'CO', 'UT', 'CA',        // Ski areas
  'TN', 'TX', 'FL', 'GA',  // Southern expansion
  'NY', 'MA', 'PA', 'NJ',  // Northeast
];

/**
 * Check if a location is in an active service area
 */
export function isInActiveServiceArea(city: string, state: string): boolean {
  const normalizedCity = city.toLowerCase().trim();
  const normalizedState = state.toUpperCase().trim();
  
  return ACTIVE_REGIONS.some(
    r => r.city.toLowerCase() === normalizedCity && r.state === normalizedState
  );
}

/**
 * Check if a location is coming soon
 */
export function isInComingSoonArea(city: string, state: string): boolean {
  const normalizedCity = city.toLowerCase().trim();
  const normalizedState = state.toUpperCase().trim();
  
  return COMING_SOON_REGIONS.some(
    r => r.city.toLowerCase() === normalizedCity && r.state === normalizedState
  );
}

/**
 * Check if a state is eligible for waitlist
 */
export function isWaitlistEligible(state: string): boolean {
  return WAITLIST_REGIONS.includes(state.toUpperCase().trim());
}

/**
 * Get active service area display string
 */
export function getActiveServiceAreaDisplay(): string {
  const uniqueCities = [...new Set(ACTIVE_REGIONS.map(r => r.city))];
  if (uniqueCities.length <= 3) {
    return uniqueCities.map(c => {
      const region = ACTIVE_REGIONS.find(r => r.city === c);
      return `${c}, ${region?.state}`;
    }).join('; ');
  }
  return 'the Madison, Wisconsin area';
}

/**
 * Get the primary coverage area (for messaging)
 */
export function getPrimaryCoverageArea(): { city: string; state: string; stateFull: string } {
  return { city: 'Madison', state: 'WI', stateFull: 'Wisconsin' };
}

/**
 * Get nearby active regions for a given state
 */
export function getNearbyActiveRegions(state: string): ServiceRegion[] {
  // If in Wisconsin, return all active regions
  if (state.toUpperCase() === 'WI') {
    return ACTIVE_REGIONS;
  }
  // Otherwise return empty (we only have WI coverage currently)
  return [];
}

/**
 * Build the coverage message for out-of-area users
 */
export function buildCoverageMessage(detectedCity: string, detectedState: string): {
  message: string;
  showWaitlist: boolean;
  coverageArea: string;
} {
  const coverageArea = getActiveServiceAreaDisplay();
  const showWaitlist = isWaitlistEligible(detectedState);
  
  const cityDisplay = detectedCity 
    ? `${detectedCity}, ${detectedState}` 
    : detectedState;
  
  let message: string;
  
  if (isInComingSoonArea(detectedCity, detectedState)) {
    const region = COMING_SOON_REGIONS.find(
      r => r.city.toLowerCase() === detectedCity.toLowerCase() && r.state === detectedState.toUpperCase()
    );
    message = `Great news! SignupAssist is coming to ${cityDisplay} soon${region?.launchDate ? ` (${region.launchDate})` : ''}! Would you like me to notify you when we launch there?`;
  } else {
    message = `I don't have providers in **${cityDisplay}** yet — SignupAssist is currently live in **${coverageArea}**.`;
    
    if (showWaitlist) {
      message += `\n\n🔔 Would you like me to notify you when we expand to ${detectedCity || 'your area'}? Just let me know and I'll add you to the list!`;
    }
  }
  
  return { message, showWaitlist, coverageArea };
}
