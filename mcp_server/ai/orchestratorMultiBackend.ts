/**
 * Multi-Backend Program Discovery Orchestration
 * Handles city inference, provider search, and age tolerance filtering
 */

import Logger from "../utils/logger.js";
import { searchOrganizations, OrgSearchResult } from "../utils/providerSearch.js";
import { AAPTriad } from "../types/aap.js";
import { lookupCity, CityLookupResult, isAmbiguousCity, getAmbiguousCityOptions } from "../utils/cityLookup.js";
import { 
  isInActiveServiceArea, 
  isInComingSoonArea, 
  isWaitlistEligible,
  getActiveServiceAreaDisplay,
  buildCoverageMessage 
} from "../config/serviceAreas.js";
import { 
  getOutOfCoverageMessage, 
  getAmbiguousCityMessage, 
  getComingSoonMessage,
  getInCoverageMessage,
  getNoProviderMatchMessage 
} from "./messageTemplates.js";

/**
 * Location analysis result
 */
export interface LocationAnalysis {
  found: boolean;
  city?: string;
  state?: string;
  isInCoverage: boolean;
  isComingSoon: boolean;
  isAmbiguous: boolean;
  showWaitlist: boolean;
  message?: string;
  disambiguationOptions?: Array<{ city: string; state: string; description: string }>;
}

/**
 * Analyze a location string and determine coverage status
 */
export function analyzeLocation(locationText: string): LocationAnalysis {
  const cityLookup = lookupCity(locationText);
  
  if (!cityLookup.found) {
    return {
      found: false,
      isInCoverage: false,
      isComingSoon: false,
      isAmbiguous: false,
      showWaitlist: false,
      message: `I couldn't recognize "${locationText}" as a city. Could you tell me which city you're in?`
    };
  }
  
  // Handle ambiguous cities (same name in multiple states)
  if (cityLookup.needsDisambiguation && cityLookup.disambiguationOptions) {
    return {
      found: true,
      city: cityLookup.suggestedMatch!.city,
      isInCoverage: false,
      isComingSoon: false,
      isAmbiguous: true,
      showWaitlist: false,
      disambiguationOptions: cityLookup.disambiguationOptions,
      message: getAmbiguousCityMessage({
        detected_city: cityLookup.suggestedMatch!.city,
        ambiguous_options: cityLookup.disambiguationOptions
      })
    };
  }
  
  const match = cityLookup.suggestedMatch!;
  const city = match.city;
  const state = match.state;
  
  // Check coverage status
  const isInCoverage = isInActiveServiceArea(city, state);
  const isComingSoon = isInComingSoonArea(city, state);
  const showWaitlist = !isInCoverage && isWaitlistEligible(state);
  
  if (isInCoverage) {
    return {
      found: true,
      city,
      state,
      isInCoverage: true,
      isComingSoon: false,
      isAmbiguous: false,
      showWaitlist: false,
      message: getInCoverageMessage({ detected_city: city, detected_state: state })
    };
  }
  
  if (isComingSoon) {
    return {
      found: true,
      city,
      state,
      isInCoverage: false,
      isComingSoon: true,
      isAmbiguous: false,
      showWaitlist: true,
      message: getComingSoonMessage({ detected_city: city, detected_state: state })
    };
  }
  
  // Out of coverage
  const coverageArea = getActiveServiceAreaDisplay();
  return {
    found: true,
    city,
    state,
    isInCoverage: false,
    isComingSoon: false,
    isAmbiguous: false,
    showWaitlist,
    message: getOutOfCoverageMessage({
      detected_city: city,
      detected_state: state,
      coverage_area: coverageArea,
      show_waitlist: showWaitlist
    })
  };
}

/**
 * City Inference + Provider Search Logic
 * 
 * @param aap - Current AAP triad from triage
 * @param sessionId - Session ID for logging
 * @returns Inference result with next steps
 */
export async function inferCityAndProvider(
  aap: AAPTriad,
  sessionId: string
): Promise<{
  needsCity: boolean;
  needsDisambiguation: boolean;
  selectedOrg: OrgSearchResult | null;
  searchResults: OrgSearchResult[];
  message?: string;
  locationAnalysis?: LocationAnalysis;
}> {
  
  Logger.info('[Multi-Backend] Starting city inference', { 
    sessionId,
    hasSearchQuery: !!aap.provider?.search_query,
    hasCity: !!aap.provider?.location_hint?.city,
    providerStatus: aap.provider?.status
  });

  // STEP 0: Check if we have a location hint and analyze it
  const locationHint = aap.provider?.location_hint?.city;
  let locationAnalysis: LocationAnalysis | undefined;
  
  if (locationHint) {
    locationAnalysis = analyzeLocation(locationHint);
    
    // If location is ambiguous, need disambiguation first
    if (locationAnalysis.isAmbiguous) {
      return {
        needsCity: false,
        needsDisambiguation: true,
        selectedOrg: null,
        searchResults: [],
        message: locationAnalysis.message,
        locationAnalysis
      };
    }
    
    // If location is out of coverage, return graceful message
    if (!locationAnalysis.isInCoverage && !locationAnalysis.isComingSoon) {
      Logger.info('[Multi-Backend] Location out of coverage', { 
        sessionId, 
        city: locationAnalysis.city, 
        state: locationAnalysis.state 
      });
      
      return {
        needsCity: false,
        needsDisambiguation: false,
        selectedOrg: null,
        searchResults: [],
        message: locationAnalysis.message,
        locationAnalysis
      };
    }
  }

  // If no provider search query, can't infer
  if (!aap.provider?.search_query) {
    return {
      needsCity: false,
      needsDisambiguation: false,
      selectedOrg: null,
      searchResults: [],
      locationAnalysis
    };
  }

  const searchQuery = aap.provider.search_query;
  const city = locationAnalysis?.city || aap.provider.location_hint?.city;

  // STEP 1: Search organizations by name (city-agnostic)
  const searchResults = await searchOrganizations({
    name: searchQuery,
    city: city || undefined,
    category: aap.activity?.normalized?.category || undefined
  });

  Logger.info('[Multi-Backend] Search results', {
    sessionId,
    query: searchQuery,
    city: city || 'none',
    resultCount: searchResults.length,
    results: searchResults.map(r => ({
      orgRef: r.orgRef,
      displayName: r.displayName,
      city: r.location?.city,
      score: r.matchScore
    }))
  });

  // STEP 2: Analyze results for city inference
  
  // Case A: No matches found → show graceful fallback with coverage info
  if (searchResults.length === 0) {
    Logger.info('[Multi-Backend] No matches found, showing graceful fallback', { sessionId });
    
    const coverageArea = getActiveServiceAreaDisplay();
    const message = getNoProviderMatchMessage({
      search_query: searchQuery,
      coverage_area: coverageArea
    });
    
    return {
      needsCity: false,
      needsDisambiguation: false,
      selectedOrg: null,
      searchResults: [],
      message,
      locationAnalysis
    };
  }

  // Case B: Single match → auto-infer city from org location
  if (searchResults.length === 1) {
    const org = searchResults[0];
    Logger.info('[Multi-Backend] Single match, auto-selecting', {
      sessionId,
      orgRef: org.orgRef,
      city: org.location?.city,
      inferredCity: org.location?.city
    });
    
    return {
      needsCity: false,
      needsDisambiguation: false,
      selectedOrg: org,
      searchResults: [org]
    };
  }

  // Case C: Multiple matches
  // If city was provided, check if it narrows down to 1 result
  if (city) {
    const cityMatches = searchResults.filter(r => 
      r.location?.city?.toLowerCase() === city.toLowerCase()
    );
    
    if (cityMatches.length === 1) {
      Logger.info('[Multi-Backend] City narrows to single match', {
        sessionId,
        orgRef: cityMatches[0].orgRef,
        city
      });
      return {
        needsCity: false,
        needsDisambiguation: false,
        selectedOrg: cityMatches[0],
        searchResults: cityMatches
      };
    }
  }

  // Case D: Multiple matches in different cities → need disambiguation
  Logger.info('[Multi-Backend] Multiple matches, need disambiguation', {
    sessionId,
    count: searchResults.length
  });
  
  return {
    needsCity: false,
    needsDisambiguation: true,
    selectedOrg: null,
    searchResults: searchResults.slice(0, 3), // Top 3
    message: `I found ${searchResults.length} locations for "${searchQuery}". Which one are you interested in?`
  };
}

/**
 * Backend-specific tool mapping
 */
export const TOOL_MAPPING = {
  bookeo: 'bookeo.find_programs',
  skiclubpro: 'scp.find_programs',
  campminder: 'campminder.find_programs'
} as const;

/**
 * Age filtering with tolerance (±1 year)
 * 
 * @param programs - List of programs to filter
 * @param userAge - User's child age
 * @param tolerance - Age tolerance in years (default: 1)
 * @returns Filtered programs with age match metadata
 */
export function applyAgeTolerance(
  programs: any[],
  userAge: number | null,
  tolerance: number = 1
): any[] {
  
  if (!userAge || !programs || programs.length === 0) {
    return programs;
  }

  Logger.info('[Age Filter] Applying tolerance', {
    userAge,
    tolerance,
    programCount: programs.length
  });

  return programs
    .map(prog => {
      // Extract age range from program (assumes ageRange: [min, max])
      const ageRange = prog.ageRange || prog.age_range || [0, 99];
      const [minAge, maxAge] = Array.isArray(ageRange) ? ageRange : [0, 99];

      // Determine match type
      const isExactMatch = userAge >= minAge && userAge <= maxAge;
      const isCloseMatch = 
        userAge >= minAge - tolerance && 
        userAge <= maxAge + tolerance;

      return {
        ...prog,
        ageMatchType: isExactMatch ? 'exact' : isCloseMatch ? 'close' : 'no-match',
        ageBadge: isCloseMatch && !isExactMatch 
          ? `Close match: Ages ${minAge}-${maxAge}` 
          : null
      };
    })
    .filter(p => p.ageMatchType !== 'no-match'); // Hide programs outside tolerance
}

/**
 * Build provider disambiguation cards
 * 
 * @param searchResults - Search results to display
 * @returns Card specs for UI rendering
 */
export function buildDisambiguationCards(searchResults: OrgSearchResult[]): any[] {
  return searchResults.map(org => ({
    title: org.displayName,
    subtitle: `${org.location?.city || 'Unknown City'}, ${org.location?.state || ''}`,
    description: `${org.categories.slice(0, 3).join(', ')}`,
    metadata: {
      orgRef: org.orgRef,
      backend: org.provider,
      city: org.location?.city,
      matchScore: org.matchScore,
      matchReasons: org.matchReasons
    },
    buttons: [{
      label: "Select this one",
      action: "select_provider",
      variant: "accent" as const,
      payload: { 
        org_ref: org.orgRef,
        backend: org.provider,
        city: org.location?.city
      }
    }]
  }));
}
