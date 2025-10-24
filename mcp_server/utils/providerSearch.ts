// ⚠️ Safety Notes:
// - Google API key must have billing enabled.
// - Restrict your key to specific APIs (Places, Maps) and referrers.
// - Cache responses to reduce API cost and rate-limit usage.
// - Always sanitize any user input before sending to Google APIs.

import axios from "axios";
import Logger from "./logger.js";

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
    orgRef: "blackhawk-ski",
    source: "local",
  },
};

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
    
    url += `&key=${apiKey}`;

    Logger.info(`[GoogleAPI] Calling API for "${query}"`);
    
    const res = await axios.get(url, { timeout: 10000 }); // Add 10s timeout
    
    // Check for API errors
    if (res.data.status && res.data.status !== "OK" && res.data.status !== "ZERO_RESULTS") {
      Logger.error(`[GoogleAPI] API error: ${res.data.status}`, res.data.error_message);
      throw new Error(`Google API error: ${res.data.status}`);
    }
    
    const data = res.data.results || [];

    if (!data.length) {
      Logger.warn(`[GoogleAPI] No results for query: ${query}`);
      return [];
    }

    Logger.info(`[GoogleAPI] Success - found ${data.length} results`);

    return data.slice(0, 3).map((r: any) => {
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
}
