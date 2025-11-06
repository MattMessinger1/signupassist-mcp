// ⚠️ Safety Notes:
// - Google API key must have billing enabled.
// - Restrict your key to specific APIs (Places, Maps) and referrers.
// - Cache responses to reduce API cost and rate-limit usage.
// - Always sanitize any user input before sending to Google APIs.

import axios from "axios";
import Logger from "./logger.js";
import { providerCache } from "./providerSearchCache.js";
import { singleFlight } from "./singleflight.js";

export interface Provider {
  name: string;
  city?: string;
  state?: string;
  address?: string;
  orgRef?: string;
  source: "local" | "google";
  distance?: number; // Distance in km from user location
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
