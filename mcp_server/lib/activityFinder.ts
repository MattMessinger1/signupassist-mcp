import axios from "axios";
import { callAI_JSON } from "./aiProvider.js";
import { sanitizeForLogs } from "../utils/sanitization.js";

export type ActivityFinderStatus =
  | "tested_fast_path"
  | "guided_autopilot"
  | "needs_signup_link"
  | "need_more_detail";

export type ActivityFinderLocationSource =
  | "user_entered"
  | "saved_profile"
  | "ip_inferred"
  | "unknown";

export interface ActivityFinderParsed {
  activity: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  ageYears: number | null;
  grade: string | null;
  missingFields: string[];
  locationSource: ActivityFinderLocationSource;
}

export interface ActivityFinderResult {
  status: ActivityFinderStatus;
  venueName: string | null;
  address: string | null;
  activityLabel: string | null;
  targetUrl: string | null;
  providerKey: string | null;
  providerName: string | null;
  ctaLabel: string;
  explanation: string;
}

export interface ActivityFinderResponse {
  parsed: ActivityFinderParsed;
  bestMatch: ActivityFinderResult | null;
  otherMatches: ActivityFinderResult[];
}

interface LocationHint {
  city: string | null;
  state: string | null;
  lat?: number | null;
  lng?: number | null;
  source: ActivityFinderLocationSource;
  confidence: "high" | "medium" | "low";
  reason?: string;
}

interface PlaceCandidate {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  placeId: string | null;
  website: string | null;
}

export interface ActivityFinderSearchInput {
  query: string;
  userId?: string | null;
  editedLocation?: {
    city?: string | null;
    state?: string | null;
  } | null;
  clientIp?: string | null;
}

interface ActivityFinderDeps {
  parseQuery?: (query: string) => Promise<Partial<ActivityFinderParsed>>;
  lookupIpLocation?: (clientIp?: string | null) => Promise<LocationHint | null>;
  searchPlaces?: (parsed: ActivityFinderParsed, locationHint: LocationHint | null) => Promise<PlaceCandidate[]>;
  supabase?: any;
}

const DEFAULT_LOCATION: LocationHint = {
  city: "Madison",
  state: "WI",
  lat: 43.0731,
  lng: -89.4012,
  source: "ip_inferred",
  confidence: "low",
  reason: "development_fallback",
};

const KEVA_TARGET_URL =
  "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva";

const TESTED_FAST_PATHS = [
  {
    id: "keva-daysmart",
    venueKeywords: ["keva", "keva sports", "keva sports center"],
    cityKeywords: ["madison", "middleton"],
    websiteKeywords: ["kevasports.com", "daysmartrecreation.com"],
    providerKey: "daysmart",
    providerName: "DaySmart / Dash",
    targetUrl: KEVA_TARGET_URL,
  },
];

function normalize(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLower(value?: string | null) {
  return normalize(value).toLowerCase();
}

function dedupeMissing(fields: Array<string | null | undefined>) {
  return [...new Set(fields.filter(Boolean).map(String))];
}

function extractAge(query: string) {
  const text = normalizeLower(query);
  const patterns = [
    /\b(?:age|aged)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:years?\s*old|year\s*old|y\.?o\.?|yo)\b/,
    /\bfor\s+(?:my\s+)?(\d{1,2})\s*(?:year|yo|y\.?o\.?)?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const age = Number(match[1]);
    if (Number.isInteger(age) && age >= 0 && age <= 19) return age;
  }

  return null;
}

function extractGrade(query: string) {
  const match = query.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+grade\b/i);
  return match ? `${match[1]} grade` : null;
}

function parseQueryFallback(query: string): ActivityFinderParsed {
  const clean = normalize(query);
  const lower = clean.toLowerCase();
  const ageYears = extractAge(clean);
  const grade = extractGrade(clean);

  let activity: string | null = null;
  let venue: string | null = null;
  let city: string | null = null;
  let state: string | null = null;

  const cityMatch = clean.match(/\bin\s+([a-zA-Z .'-]+?)(?:,\s*([A-Z]{2})|\s+for\b|\s+age\b|$)/i);
  if (cityMatch) {
    city = normalize(cityMatch[1]).replace(/\s+wi$/i, "");
    state = cityMatch[2] || (/\bwi\b/i.test(cityMatch[0]) ? "WI" : null);
  }

  const atMatch = clean.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\b|\s+for\b|\s+age\b|$)/i);
  if (atMatch) {
    activity = normalize(atMatch[1]).replace(/\b(sign\s*up|signup|register|registration)\b/gi, "").trim() || null;
    venue = normalize(atMatch[2]) || null;
  }

  if (!activity) {
    const activityWords = [
      "soccer",
      "swim lessons",
      "swimming",
      "summer camp",
      "camp",
      "basketball",
      "baseball",
      "tennis",
      "dance",
      "gymnastics",
      "robotics",
      "coding",
    ];
    activity = activityWords.find((word) => lower.includes(word)) || null;
  }

  if (!venue) {
    const venueMatch = clean.match(/\b(?:at|@)\s+(.+?)(?:\s+in\b|\s+for\b|\s+age\b|$)/i);
    venue = venueMatch ? normalize(venueMatch[1]) : null;
  }

  const missingFields = dedupeMissing([
    activity ? null : "activity",
    ageYears !== null || grade ? null : "age",
  ]);

  return {
    activity,
    venue,
    city,
    state,
    ageYears,
    grade,
    missingFields,
    locationSource: city ? "user_entered" : "unknown",
  };
}

async function parseQueryWithOpenAI(query: string): Promise<Partial<ActivityFinderParsed>> {
  if (!process.env.OPENAI_API_KEY) {
    return parseQueryFallback(query);
  }

  try {
    const parsed = await callAI_JSON({
      model: process.env.OPENAI_MODEL_ACTIVITY_FINDER || "gpt-4o-mini",
      temperature: 0,
      maxTokens: 350,
      useResponsesAPI: false,
      system:
        "Extract a parent's activity signup search into JSON. Do not invent facts. " +
        "Return only fields: activity, venue, city, state, ageYears, grade, missingFields. " +
        "Examples include 'soccer at Keva in Madison for age 9' and 'summer camp near me for age 8'.",
      user: { query },
    });

    return {
      activity: typeof parsed?.activity === "string" ? normalize(parsed.activity) || null : null,
      venue: typeof parsed?.venue === "string" ? normalize(parsed.venue) || null : null,
      city: typeof parsed?.city === "string" ? normalize(parsed.city) || null : null,
      state: typeof parsed?.state === "string" ? normalize(parsed.state).toUpperCase() || null : null,
      ageYears: Number.isFinite(Number(parsed?.ageYears)) ? Number(parsed.ageYears) : null,
      grade: typeof parsed?.grade === "string" ? normalize(parsed.grade) || null : null,
      missingFields: Array.isArray(parsed?.missingFields) ? parsed.missingFields.map(String) : [],
    };
  } catch (error: any) {
    console.warn("[ActivityFinder] OpenAI parse failed, using fallback parser", error?.message);
    return parseQueryFallback(query);
  }
}

function mergeParsed(
  query: string,
  aiParsed: Partial<ActivityFinderParsed>,
  editedLocation?: ActivityFinderSearchInput["editedLocation"],
  ipLocation?: LocationHint | null,
): ActivityFinderParsed {
  const fallback = parseQueryFallback(query);

  const explicitCity = normalize(aiParsed.city) || fallback.city;
  const explicitState = normalize(aiParsed.state) || fallback.state;
  const editedCity = normalize(editedLocation?.city);
  const editedState = normalize(editedLocation?.state);

  const city = editedCity || explicitCity || ipLocation?.city || null;
  const state = (editedState || explicitState || ipLocation?.state || null)?.toUpperCase() || null;
  const locationSource: ActivityFinderLocationSource = editedCity
    ? "user_entered"
    : explicitCity
      ? "user_entered"
      : ipLocation?.city
        ? "ip_inferred"
        : "unknown";

  const ageYears =
    Number.isFinite(Number(aiParsed.ageYears)) && Number(aiParsed.ageYears) >= 0
      ? Number(aiParsed.ageYears)
      : fallback.ageYears;

  const parsed: ActivityFinderParsed = {
    activity: normalize(aiParsed.activity) || fallback.activity,
    venue: normalize(aiParsed.venue) || fallback.venue,
    city,
    state,
    ageYears,
    grade: normalize(aiParsed.grade) || fallback.grade,
    missingFields: [],
    locationSource,
  };

  parsed.missingFields = dedupeMissing([
    parsed.activity ? null : "activity",
    parsed.ageYears !== null || parsed.grade ? null : "age",
    parsed.city ? null : "city",
    // Venue is optional when the parent says "near me"; Places can still find options.
    parsed.venue || /near me/i.test(query) ? null : "venue",
  ]);

  return parsed;
}

function clientIpIsLocal(clientIp?: string | null) {
  return !clientIp || clientIp === "127.0.0.1" || clientIp === "::1" || clientIp.startsWith("::ffff:127.");
}

async function lookupIpLocation(clientIp?: string | null): Promise<LocationHint | null> {
  const apiKey = process.env.IPAPI_KEY;
  const env = (process.env.NODE_ENV || "").toLowerCase();

  if (clientIpIsLocal(clientIp)) {
    return env === "production" ? null : DEFAULT_LOCATION;
  }

  if (!apiKey) {
    return env === "production" ? null : DEFAULT_LOCATION;
  }

  const normalizedIp = clientIp?.startsWith("::ffff:") ? clientIp.replace("::ffff:", "") : clientIp;

  try {
    const response = await fetch(`https://ipapi.co/${normalizedIp}/json/?key=${apiKey}`);
    if (!response.ok) return null;
    const data: any = await response.json();
    if (!data || data.error) return null;

    return {
      city: data.city || null,
      state: data.region_code || data.region || null,
      lat: typeof data.latitude === "number" ? data.latitude : null,
      lng: typeof data.longitude === "number" ? data.longitude : null,
      source: "ip_inferred",
      confidence: data.city ? "medium" : "low",
      reason: data.reason || undefined,
    };
  } catch (error: any) {
    console.warn("[ActivityFinder] IPAPI lookup failed", error?.message);
    return null;
  }
}

function parseAddressParts(address?: string | null) {
  const parts = String(address || "").split(",").map((part) => part.trim());
  const city = parts.length >= 3 ? parts[parts.length - 3] : parts[1] || null;
  const stateZip = parts.length >= 2 ? parts[parts.length - 2] : "";
  const state = stateZip.match(/\b[A-Z]{2}\b/)?.[0] || null;
  return { city, state };
}

async function fetchPlaceWebsite(placeId: string, apiKey: string) {
  try {
    const detailsUrl = "https://maps.googleapis.com/maps/api/place/details/json";
    const response = await axios.get(detailsUrl, {
      timeout: 7000,
      params: {
        place_id: placeId,
        fields: "website,url",
        key: apiKey,
      },
    });
    return response.data?.result?.website || null;
  } catch {
    return null;
  }
}

async function searchGooglePlaces(
  parsed: ActivityFinderParsed,
  locationHint: LocationHint | null,
): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const locationText = [parsed.city || locationHint?.city, parsed.state || locationHint?.state]
    .filter(Boolean)
    .join(", ");
  const query = [parsed.venue || parsed.activity || "youth activities", locationText]
    .filter(Boolean)
    .join(" ");

  try {
    const url = "https://maps.googleapis.com/maps/api/place/textsearch/json";
    const response = await axios.get(url, {
      timeout: 10000,
      params: {
        query,
        type: "establishment",
        fields: "name,formatted_address,place_id,geometry/location",
        location:
          typeof locationHint?.lat === "number" && typeof locationHint?.lng === "number"
            ? `${locationHint.lat},${locationHint.lng}`
            : undefined,
        radius: typeof locationHint?.lat === "number" ? 50000 : undefined,
        key: apiKey,
      },
    });

    const rawResults = Array.isArray(response.data?.results) ? response.data.results : [];
    const candidates = rawResults.slice(0, 3);
    const withWebsites = await Promise.all(
      candidates.map(async (place: any) => {
        const { city, state } = parseAddressParts(place.formatted_address);
        const placeId = place.place_id || null;
        return {
          name: place.name || "Venue",
          address: place.formatted_address || null,
          city,
          state,
          placeId,
          website: placeId ? await fetchPlaceWebsite(placeId, apiKey) : null,
        } satisfies PlaceCandidate;
      }),
    );

    return withWebsites;
  } catch (error: any) {
    console.warn("[ActivityFinder] Google Places search failed", sanitizeForLogs({ message: error?.message }));
    return [];
  }
}

function getFastPathForCandidate(candidate: PlaceCandidate | null, parsed: ActivityFinderParsed) {
  if (!candidate) return null;
  const haystack = normalizeLower(
    [
      candidate.name,
      candidate.address,
      candidate.city,
      candidate.website,
      parsed.venue,
    ].filter(Boolean).join(" "),
  );

  return (
    TESTED_FAST_PATHS.find(
      (path) =>
        path.venueKeywords.some((keyword) => haystack.includes(keyword)) &&
        (path.cityKeywords.length === 0 || path.cityKeywords.some((keyword) => haystack.includes(keyword))),
    ) ||
    TESTED_FAST_PATHS.find(
      (path) => path.websiteKeywords.some((keyword) => haystack.includes(keyword)),
    ) ||
    null
  );
}

function resultFromCandidate(candidate: PlaceCandidate, parsed: ActivityFinderParsed): ActivityFinderResult {
  const fastPath = getFastPathForCandidate(candidate, parsed);
  if (fastPath) {
    return {
      status: "tested_fast_path",
      venueName: candidate.name,
      address: candidate.address,
      activityLabel: parsed.activity,
      targetUrl: fastPath.targetUrl,
      providerKey: fastPath.providerKey,
      providerName: fastPath.providerName,
      ctaLabel: "Set up signup help",
      explanation:
        "Tested Fast Path: SignupAssist knows this registration system and can help you move quickly when signup opens.",
    };
  }

  if (candidate.website) {
    return {
      status: "guided_autopilot",
      venueName: candidate.name,
      address: candidate.address,
      activityLabel: parsed.activity,
      targetUrl: candidate.website,
      providerKey: "generic",
      providerName: "Guided Autopilot",
      ctaLabel: "Use Guided Autopilot",
      explanation:
        "SignupAssist can still help fill safe fields here. We may ask you to paste the exact registration page and we’ll pause more often.",
    };
  }

  return {
    status: "needs_signup_link",
    venueName: candidate.name,
    address: candidate.address,
    activityLabel: parsed.activity,
    targetUrl: null,
    providerKey: "generic",
    providerName: "Guided Autopilot",
    ctaLabel: "Add signup link",
    explanation:
      "We found the venue. Paste the registration page and SignupAssist can help with guided fill.",
  };
}

function needMoreDetailResult(parsed: ActivityFinderParsed): ActivityFinderResult {
  const missing = parsed.missingFields.join(", ") || "one more detail";
  return {
    status: "need_more_detail",
    venueName: parsed.venue,
    address: [parsed.city, parsed.state].filter(Boolean).join(", ") || null,
    activityLabel: parsed.activity,
    targetUrl: null,
    providerKey: null,
    providerName: null,
    ctaLabel: "Add details",
    explanation: `Add ${missing} so we can find the right signup faster.`,
  };
}

async function logActivityFinderSearch(
  supabase: any,
  input: ActivityFinderSearchInput,
  parsed: ActivityFinderParsed,
  locationHint: LocationHint | null,
  response: ActivityFinderResponse,
) {
  if (!supabase) return;

  try {
    await supabase.from("activity_finder_searches").insert({
      user_id: input.userId || null,
      raw_query: input.query,
      parsed_query: parsed,
      location_hint: locationHint,
      best_match: response.bestMatch,
    });
  } catch (error: any) {
    console.warn("[ActivityFinder] Failed to log search", error?.message);
  }
}

export async function searchActivityFinder(
  input: ActivityFinderSearchInput,
  deps: ActivityFinderDeps = {},
): Promise<ActivityFinderResponse> {
  const query = normalize(input.query);
  if (!query) {
    const parsed = parseQueryFallback("");
    parsed.missingFields = ["activity", "age"];
    return {
      parsed,
      bestMatch: needMoreDetailResult(parsed),
      otherMatches: [],
    };
  }

  const ipLocation = await (deps.lookupIpLocation || lookupIpLocation)(input.clientIp);
  const aiParsed = await (deps.parseQuery || parseQueryWithOpenAI)(query);
  const parsed = mergeParsed(query, aiParsed, input.editedLocation, ipLocation);
  const places = await (deps.searchPlaces || searchGooglePlaces)(parsed, ipLocation);

  const results = places.map((candidate) => resultFromCandidate(candidate, parsed));
  const sortedResults = results.sort((a, b) => {
    const order: Record<ActivityFinderStatus, number> = {
      tested_fast_path: 0,
      guided_autopilot: 1,
      needs_signup_link: 2,
      need_more_detail: 3,
    };
    return order[a.status] - order[b.status];
  });

  let response: ActivityFinderResponse;
  if (sortedResults.length) {
    response = {
      parsed,
      bestMatch: sortedResults[0],
      otherMatches: sortedResults.slice(1, 3),
    };
  } else {
    response = {
      parsed,
      bestMatch: needMoreDetailResult(parsed),
      otherMatches: [],
    };
  }

  await logActivityFinderSearch(deps.supabase, input, parsed, ipLocation, response);
  return response;
}

export const __activityFinderInternals = {
  parseQueryFallback,
  mergeParsed,
  resultFromCandidate,
  needMoreDetailResult,
};
