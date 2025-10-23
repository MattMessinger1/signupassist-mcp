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

export async function googlePlacesSearch(name: string, location?: string): Promise<Provider[]> {
  const query = `${name}${location ? ", " + location : ""}`;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY in environment variables.");

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

  Logger.info(`[GoogleAPI] Searching for "${query}"`);

  const res = await axios.get(url);
  const data = res.data.results || [];

  if (!data.length) {
    Logger.warn(`[GoogleAPI] No results for query: ${query}`);
    return [];
  }

  Logger.info(`[GoogleAPI] Found ${data.length} results`);

  return data.slice(0, 3).map((r: any) => ({
    name: r.name,
    city: r.formatted_address?.split(",")[1]?.trim() || "",
    address: r.formatted_address,
    orgRef: r.place_id,
    source: "google",
  }));
}
