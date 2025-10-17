import axios from "axios";
import Logger from "./logger";

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
    source: "local"
  },
  madisonnordic: {
    name: "Madison Nordic Ski Club",
    city: "Madison, WI",
    orgRef: "madison-nordic",
    source: "local"
  }
};

export async function lookupLocalProvider(name: string): Promise<Provider | null> {
  const key = name.toLowerCase().replace(/\s+/g, "");
  const entry = Object.keys(knownProviders).find(k => key.includes(k));
  return entry ? knownProviders[entry] : null;
}

export async function googlePlacesSearch(name: string, location?: string): Promise<Provider[]> {
  try {
    const query = `${name}${location ? ", " + location : ""}`;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY!;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    const res = await axios.get(url);
    const data = res.data.results || [];

    return data.slice(0, 3).map((r: any) => ({
      name: r.name,
      city: r.formatted_address?.split(",")[1]?.trim() || "",
      address: r.formatted_address,
      orgRef: r.place_id,
      source: "google"
    }));
  } catch (err: any) {
    Logger.error("Google Places API error:", err.message);
    return [];
  }
}
