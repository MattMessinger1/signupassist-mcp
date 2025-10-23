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
  address?: string;
  orgRef?: string;
  source: "local" | "google";
  distance?: number; // Distance in km from user location
}

const knownProviders: Record<string, Provider> = {
  blackhawk: {
    name: "Blackhawk Ski Club",
    city: "Middleton, WI",
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
  const query = `${name}${location ? ", " + location : ""}`;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY in environment variables.");

  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}`;
  
  // Add location bias if coordinates provided (50km radius)
  if (userCoords) {
    url += `&location=${userCoords.lat},${userCoords.lng}&radius=50000`;
    Logger.info(`[GoogleAPI] Using location bias: ${userCoords.lat},${userCoords.lng} (50km radius)`);
  }
  
  url += `&key=${apiKey}`;

  Logger.info(`[GoogleAPI] Searching for "${query}"`);

  const res = await axios.get(url);
  const data = res.data.results || [];

  if (!data.length) {
    Logger.warn(`[GoogleAPI] No results for query: ${query}`);
    return [];
  }

  Logger.info(`[GoogleAPI] Found ${data.length} results`);

  return data.slice(0, 3).map((r: any) => {
    const provider: Provider = {
      name: r.name,
      city: r.formatted_address?.split(",")[1]?.trim() || "",
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
}
