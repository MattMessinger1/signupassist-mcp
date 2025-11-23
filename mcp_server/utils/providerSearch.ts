// ⚠️ Safety Notes:
// - Google API key must have billing enabled.
// - Restrict your key to specific APIs (Places, Maps) and referrers.
// - Cache responses to reduce API cost and rate-limit usage.
// - Always sanitize any user input before sending to Google APIs.

import axios from "axios";
import Logger from "./logger.js";
import { singleFlight } from "./singleflight.js";
import { getAllActiveOrganizations, OrgConfig } from '../config/organizations.js';

// Simple in-memory cache for provider search results
const providerCacheMap = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const providerCache = {
  get(key: string): any | null {
    const cached = providerCacheMap.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }
    return null;
  },
  set(key: string, result: any): void {
    providerCacheMap.set(key, { result, timestamp: Date.now() });
  }
};

export interface Provider {
  name: string;
  city?: string;
  state?: string;
  address?: string;
  orgRef?: string;
  source: "local" | "google";
  distance?: number; // Distance in km from user location
}

// Multi-Backend Provider Search Interfaces
export interface SearchQuery {
  name?: string;        // "Bookeo Demo" or "Blackhawk"
  city?: string;        // "Madison" or "Middleton"
  category?: string;    // "swim", "ski", "lessons"
}

export interface OrgSearchResult extends OrgConfig {
  matchScore: number;       // 0-100 confidence score
  matchReasons: string[];   // ["name match", "in Madison"]
}

const knownProviders: Record<string, Provider> = {
  blackhawk: {
    name: "Blackhawk Ski Club",
    city: "Middleton",
    state: "WI",
    orgRef: "blackhawk-ski-club",
    source: "local",
  },
};

// Keywords to exclude physical facilities (not organizations)
const EXCLUDE_KEYWORDS = process.env.PROVIDER_EXCLUDE_KEYWORDS?.split(',') || 
  ['chalet', 'building', 'parking', 'lodge', 'facility', 'area', 'trailhead', 'warming house', 'west chalet', 'east chalet'];

export async function lookupLocalProvider(name: string): Promise<Provider | null> {
  const key = name.toLowerCase().replace(/\s+/g, "");
  const entry = Object.keys(knownProviders).find(k => key.includes(k));
  return entry ? knownProviders[entry] : null;
}

/**
 * Search organizations across all registered providers (Bookeo, SkiClubPro, CampMinder)
 * Returns top 3 matches ranked by confidence score
 * 
 * @param query - Search criteria (name, city, category)
 * @returns Top 3 matching organizations with scores
 */
export async function searchOrganizations(
  query: SearchQuery
): Promise<OrgSearchResult[]> {
  
  const allOrgs = getAllActiveOrganizations();
  const results: OrgSearchResult[] = [];

  Logger.info(`[ProviderSearch] Searching: name="${query.name}", city="${query.city}", category="${query.category}"`);
  Logger.info(`[ProviderSearch] Total active orgs: ${allOrgs.length}`);

  for (const org of allOrgs) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Name Matching (50 points) - Fuzzy match against displayName + keywords
    if (query.name) {
      const nameSimilarity = fuzzyMatch(query.name, [
        org.displayName,
        ...(org.searchKeywords || [])
      ]);
      score += nameSimilarity * 50;
      
      if (nameSimilarity > 0.6) {
        reasons.push(`name match (${Math.round(nameSimilarity * 100)}%)`);
      }
    }

    // 2. City Matching (30 points) - Case-insensitive exact match
    if (query.city && org.location?.city) {
      const cityMatch = org.location.city.toLowerCase() === query.city.toLowerCase();
      if (cityMatch) {
        score += 30;
        reasons.push(`in ${org.location.city}`);
      }
    }

    // 3. Category Matching (20 points) - Does org offer this category?
    if (query.category) {
      const categoryMatch = org.categories.some(cat => 
        cat.toLowerCase().includes(query.category!.toLowerCase()) ||
        query.category!.toLowerCase().includes(cat.toLowerCase())
      );
      if (categoryMatch) {
        score += 20;
        reasons.push(`offers ${query.category}`);
      }
    }

    // Only include results above minimum threshold
    if (score > 30) {
      results.push({
        ...org,
        matchScore: score,
        matchReasons: reasons
      });
      
      Logger.info(`[ProviderSearch] Match: ${org.displayName} (score: ${score}, reasons: ${reasons.join(', ')})`);
    }
  }

  // Sort by score (descending) and return top 3
  const topResults = results
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);

  Logger.info(`[ProviderSearch] Returning ${topResults.length} top matches`);
  return topResults;
}

/**
 * Fuzzy string matching (returns 0.0 - 1.0)
 * Handles exact match, substring match, and word overlap
 * 
 * @param query - Search term
 * @param targets - Array of strings to match against
 * @returns Similarity score (0.0 = no match, 1.0 = exact match)
 */
function fuzzyMatch(query: string, targets: string[]): number {
  const q = query.toLowerCase().trim();
  let maxScore = 0;

  for (const target of targets) {
    const t = target.toLowerCase().trim();
    
    // Exact match = 100%
    if (q === t) {
      maxScore = Math.max(maxScore, 1.0);
      continue;
    }
    
    // Substring match = 80%
    if (t.includes(q) || q.includes(t)) {
      maxScore = Math.max(maxScore, 0.8);
      continue;
    }
    
    // Word overlap scoring
    const qWords = q.split(/\s+/);
    const tWords = t.split(/\s+/);
    const overlappingWords = qWords.filter(qw => 
      tWords.some(tw => tw.includes(qw) || qw.includes(tw))
    );
    
    const overlapRatio = overlappingWords.length / Math.max(qWords.length, tWords.length);
    maxScore = Math.max(maxScore, overlapRatio * 0.6);
  }

  return maxScore;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 - First latitude
 * @param lng1 - First longitude
 * @param lat2 - Second latitude
 * @param lng2 - Second longitude
 * @returns Distance in kilometers (rounded)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c); // Distance in km
}

export async function googlePlacesSearch(
  name: string, 
  location?: string,
  userCoords?: {lat: number, lng: number}
): Promise<Provider[]> {
  const startTime = Date.now();
  const cacheKey = `${name}:${location || 'any'}:${userCoords?.lat || 'none'},${userCoords?.lng || 'none'}`;
  
  // Check cache first
  const cached = providerCache.get(cacheKey);
  if (cached) {
    const duration = Date.now() - startTime;
    Logger.info(`[GoogleAPI] ✅ Cache hit (${duration}ms) for "${cacheKey}"`);
    return cached;
  }
  
  // Use singleflight to deduplicate concurrent requests
  return singleFlight(cacheKey, async () => {
    try {
      const query = `${name}${location ? ", " + location : ""}`;
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    
    if (!apiKey) {
      Logger.error("[GoogleAPI] GOOGLE_PLACES_API_KEY not set!");
      throw new Error("Google Places API key not configured");
    }

      let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}`;
      
      // Add location bias if coordinates provided (50km radius)
      if (userCoords) {
        url += `&location=${userCoords.lat},${userCoords.lng}&radius=50000`;
        Logger.info(`[GoogleAPI] Using location bias: ${userCoords.lat},${userCoords.lng} (50km radius)`);
      }
      
      // Prefer establishments (organizations) over geographic features
      url += `&type=establishment`;
      
      // Optimize payload by requesting only essential fields
      url += `&fields=name,formatted_address,place_id,geometry/location`;
      
      url += `&key=${apiKey}`;

      Logger.info(`[GoogleAPI] Calling API for "${query}"`);
    
      const res = await axios.get(url, { timeout: 10000 }); // 10s timeout
      
      // Check for API errors
      if (res.data.status && res.data.status !== "OK" && res.data.status !== "ZERO_RESULTS") {
        Logger.error(`[GoogleAPI] API error: ${res.data.status}`, res.data.error_message);
        throw new Error(`Google API error: ${res.data.status}`);
      }
      
      const data = res.data.results || [];

      if (!data.length) {
        Logger.warn(`[GoogleAPI] No results for query: ${query}`);
        providerCache.set(cacheKey, []); // Cache empty results too
        return [];
      }

      const apiDuration = Date.now() - startTime;
      Logger.info(`[GoogleAPI] ✅ API call completed (${apiDuration}ms) - found ${data.length} results`);

      // Filter out physical facilities (chalets, buildings, etc.)
      const filtered = data.filter((r: any) => {
        const name = r.name?.toLowerCase() || '';
        const address = r.formatted_address?.toLowerCase() || '';
        const combined = `${name} ${address}`;
        
        return !EXCLUDE_KEYWORDS.some(keyword => combined.includes(keyword.toLowerCase()));
      });

      const filteredCount = data.length - filtered.length;
      if (filteredCount > 0) {
        Logger.info(`[GoogleAPI] Filtered out ${filteredCount} physical facilities`);
      }

      const results = filtered.slice(0, 3).map((r: any) => {
        const addressParts = r.formatted_address?.split(",") || [];
        const cityPart = addressParts[1]?.trim() || "";
        const statePart = addressParts[2]?.trim().split(" ")[0] || ""; // Extract state from "WI 53562"
        
        const provider: Provider = {
          name: r.name,
          city: cityPart,
          state: statePart,
          address: r.formatted_address,
          orgRef: r.place_id,
          source: "google",
        };
        
        // Calculate distance if user location available
        if (userCoords && r.geometry?.location) {
          provider.distance = calculateDistance(
            userCoords.lat,
            userCoords.lng,
            r.geometry.location.lat,
            r.geometry.location.lng
          );
        }
        
        return provider;
      });
      
      // Store in cache before returning
      providerCache.set(cacheKey, results);
      
      const totalDuration = Date.now() - startTime;
      Logger.info(`[GoogleAPI] Total duration: ${totalDuration}ms`);
      
      return results;
      
    } catch (error: any) {
      Logger.error("[GoogleAPI] Request failed:", {
        message: error.message,
        code: error.code,
        response: error.response?.data
      });
      
      // Don't throw - return empty array so flow can continue with local providers
      // This allows graceful degradation if Google API is unavailable
      return [];
    }
  });
}

/**
 * Legacy function for backward compatibility with existing code
 * @deprecated Use searchOrganizations() instead
 */
export async function searchProviders(
  query: string,
  userCoords?: { lat: number; lng: number }
): Promise<Provider[]> {
  Logger.warn('[ProviderSearch] searchProviders() is deprecated, use searchOrganizations()');
  
  // Try to parse query as organization name
  const results = await searchOrganizations({ name: query });
  
  // Convert to legacy Provider format
  return results.map(org => ({
    name: org.displayName,
    city: org.location?.city,
    state: org.location?.state,
    orgRef: org.orgRef,
    source: "local" as const,
    distance: undefined
  }));
}
