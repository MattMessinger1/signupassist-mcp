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
  confidence?: number | null;
  sourceFreshness?: string | null;
  ageGradeFit?: string | null;
  providerReadiness?: string | null;
  missingDetails?: string[];
  ctaLabel: string;
  explanation: string;
}

export interface ActivityFinderResponse {
  parsed: ActivityFinderParsed;
  bestMatch: ActivityFinderResult | null;
  otherMatches: ActivityFinderResult[];
  outOfScope?: {
    reason: "adult_signup_request";
    message: string;
  } | null;
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

interface ActivityFinderSearchLogger {
  from(table: "activity_finder_searches"): {
    insert(values: unknown): unknown;
  };
}

interface IpApiResponse {
  city?: string | null;
  region?: string | null;
  region_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reason?: string | null;
  error?: unknown;
}

interface GooglePlaceTextResult {
  name?: string;
  formatted_address?: string;
  place_id?: string;
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
  supabase?: ActivityFinderSearchLogger | null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const CHILD_OR_YOUTH_CUES = [
  /\bchild(?:ren)?\b/i,
  /\bkids?\b/i,
  /\byouth\b/i,
  /\bteen(?:s|agers?)?\b/i,
  /\bdaughter\b/i,
  /\bson\b/i,
  /\bgrade\b/i,
  /\bu-?\d{1,2}\b/i,
  /\bunder\s*(?:1[0-7]|\d)\b/i,
  /\b(?:age|aged)\s*(?:1[0-7]|\d)\b/i,
  /\b(?:1[0-7]|\d)\s*(?:years?\s*old|year\s*old|y\.?o\.?|yo)\b/i,
];

const ADULT_PARTICIPANT_CUES = [
  /\badults?\b/i,
  /\badult[-\s]?only\b/i,
  /\bfor\s+adults?\s+only\b/i,
  /\b(?:18|21)\s*\+\b/i,
  /\b(?:18|21)\s+and\s+(?:up|over|older)\b/i,
  /\b(?:over|older than)\s+(?:18|21)\b/i,
  /\bregister\s+me\b/i,
  /\bsign\s*me\s+up\b/i,
  /\benroll\s+me\b/i,
  /\bfor\s+myself\b/i,
  /\bfor\s+me\b/i,
];

function extractAnyAge(query: string) {
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
    if (Number.isInteger(age) && age >= 0 && age <= 99) return age;
  }

  return null;
}

function extractAge(query: string) {
  const age = extractAnyAge(query);
  return age !== null && age > 0 && age < 18 ? age : null;
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

function activityIsSupportedByQuery(query: string, activity: string | null, fallbackActivity: string | null) {
  if (!activity) return false;
  if (fallbackActivity) return true;

  const normalizedQuery = normalizeLower(query);
  const normalizedActivity = normalizeLower(activity);
  if (!normalizedActivity) return false;

  return normalizedQuery.includes(normalizedActivity);
}

function venueIsActuallyLocation(venue: string | null, city: string | null, state: string | null) {
  const normalizedVenue = normalizeLower(venue);
  if (!normalizedVenue) return false;

  const normalizedCity = normalizeLower(city);
  const normalizedState = normalizeLower(state);
  const locationLabels = [
    normalizedCity,
    normalizedState,
    [normalizedCity, normalizedState].filter(Boolean).join(" "),
    [normalizedCity, normalizedState].filter(Boolean).join(", "),
  ].filter(Boolean);

  return locationLabels.includes(normalizedVenue);
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
  } catch (error: unknown) {
    console.warn("[ActivityFinder] OpenAI parse failed, using fallback parser", errorMessage(error));
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

  const aiAge = Number(aiParsed.ageYears);
  const ageYears =
    Number.isFinite(aiAge) && aiAge > 0 && aiAge < 18
      ? aiAge
      : fallback.ageYears;

  const aiVenue = normalize(aiParsed.venue) || fallback.venue;

  const parsed: ActivityFinderParsed = {
    activity: activityIsSupportedByQuery(query, normalize(aiParsed.activity), fallback.activity)
      ? normalize(aiParsed.activity) || fallback.activity
      : fallback.activity,
    venue: venueIsActuallyLocation(aiVenue, city, state) ? null : aiVenue,
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

function activityFinderOutOfScope(query: string, aiParsed: Partial<ActivityFinderParsed>) {
  const normalized = normalize(query);
  const hasChildCue = containsAny(normalized, CHILD_OR_YOUTH_CUES);
  const adultCue = containsAny(normalized, ADULT_PARTICIPANT_CUES);
  const explicitAge = Number.isFinite(Number(aiParsed.ageYears))
    ? Number(aiParsed.ageYears)
    : extractAnyAge(normalized);

  if (explicitAge !== null && explicitAge >= 18) {
    return true;
  }

  return adultCue && !hasChildCue;
}

function outOfScopeResponse(parsed: ActivityFinderParsed): ActivityFinderResponse {
  return {
    parsed: {
      ...parsed,
      missingFields: [],
    },
    bestMatch: null,
    otherMatches: [],
    outOfScope: {
      reason: "adult_signup_request",
      message:
        "SignupAssist is currently focused on parent-controlled youth activity signups. Adult activity registration is not supported yet.",
    },
  };
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
    const data = (await response.json()) as IpApiResponse;
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
  } catch (error: unknown) {
    console.warn("[ActivityFinder] IPAPI lookup failed", errorMessage(error));
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
      candidates.map(async (place: GooglePlaceTextResult) => {
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

    return withWebsites.filter((candidate) => candidateMatchesExplicitLocation(candidate, parsed));
  } catch (error: unknown) {
    console.warn("[ActivityFinder] Google Places search failed", sanitizeForLogs({ message: errorMessage(error) }));
    return [];
  }
}

function candidateMatchesExplicitLocation(candidate: PlaceCandidate, parsed: ActivityFinderParsed) {
  if (parsed.locationSource !== "user_entered") return true;

  const candidateState = normalizeLower(candidate.state);
  const parsedState = normalizeLower(parsed.state);
  if (parsedState && candidateState && candidateState !== parsedState) return false;

  const candidateCity = normalizeLower(candidate.city);
  const parsedCity = normalizeLower(parsed.city);
  if (!parsedCity || parsed.venue) return true;

  const address = normalizeLower(candidate.address);
  return candidateCity === parsedCity || address.includes(parsedCity);
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
  const ageGradeFit = parsed.ageYears !== null ? `Age ${parsed.ageYears}` : parsed.grade;
  if (fastPath) {
    return {
      status: "tested_fast_path",
      venueName: candidate.name,
      address: candidate.address,
      activityLabel: parsed.activity,
      targetUrl: fastPath.targetUrl,
      providerKey: fastPath.providerKey,
      providerName: fastPath.providerName,
      confidence: 0.92,
      sourceFreshness: "Configured provider path",
      ageGradeFit,
      providerReadiness: "navigation verified",
      ctaLabel: "Set up signup help",
      explanation:
        "Tested Fast Path: SignupAssist knows this registration system and can help you move quickly when signup opens.",
    };
  }

  if (candidate.website && isRegistrationLikeUrl(candidate.website)) {
    return {
      status: "guided_autopilot",
      venueName: candidate.name,
      address: candidate.address,
      activityLabel: parsed.activity,
      targetUrl: candidate.website,
      providerKey: "generic",
      providerName: "Guided Autopilot",
      confidence: 0.72,
      sourceFreshness: "Live venue lookup",
      ageGradeFit,
      providerReadiness: "generic",
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
    confidence: 0.58,
    sourceFreshness: "Live venue lookup",
    ageGradeFit,
    providerReadiness: "generic",
    ctaLabel: "Add signup link",
    explanation:
      "We found the venue. Paste the registration page and SignupAssist can help with guided fill.",
  };
}

function isRegistrationLikeUrl(value: string | null) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const haystack = normalizeLower(`${parsed.hostname} ${parsed.pathname} ${parsed.search}`);
    return /register|registration|signup|sign-up|enroll|booking|bookeo|programs?|classes?|lessons?|camps?|activecommunities|daysmartrecreation|amilia|civicrec/.test(haystack);
  } catch {
    return false;
  }
}

function fastPathCandidateFromParsed(parsed: ActivityFinderParsed): PlaceCandidate | null {
  const candidate: PlaceCandidate = {
    name: parsed.venue || parsed.activity || "Venue",
    address: [parsed.city, parsed.state].filter(Boolean).join(", ") || null,
    city: parsed.city,
    state: parsed.state,
    placeId: null,
    website: null,
  };

  return getFastPathForCandidate(candidate, parsed) ? candidate : null;
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
    confidence: 0.25,
    sourceFreshness: "Needs parent detail",
    missingDetails: parsed.missingFields,
    ctaLabel: "Add details",
    explanation: `Add ${missing} so we can find the right signup faster.`,
  };
}

function detailGatedResponse(parsed: ActivityFinderParsed): ActivityFinderResponse | null {
  const missing = dedupeMissing([
    parsed.activity ? null : "activity",
    parsed.ageYears !== null || parsed.grade ? null : "age",
    parsed.city && parsed.locationSource === "user_entered" ? null : "location",
    parsed.venue ? null : "provider or venue",
  ]);
  const fastPathCandidate = fastPathCandidateFromParsed(parsed);
  const hardMissing = missing.includes("activity") || missing.includes("age");

  if (missing.length === 0 || (fastPathCandidate && !hardMissing)) return null;

  const gatedParsed = {
    ...parsed,
    missingFields: missing,
  };

  return {
    parsed: gatedParsed,
    bestMatch: needMoreDetailResult(gatedParsed),
    otherMatches: [],
    outOfScope: null,
  };
}

function redactQuerySummary(query: string) {
  return normalize(query)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\+?\b(?:\d[\s().-]?){10,}\b/g, "[phone]")
    .replace(/\b(?:\d{1,2}[/-]){2}\d{2,4}\b/g, "[date]")
    .replace(/\b\d{12,19}\b/g, "[number]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:password|token|secret|credential|card|cvv|cvc|medical|allerg(?:y|ies)?)\b[^\s,;]*/gi, "[sensitive]")
    .slice(0, 180);
}

function redactParsedForStorage(parsed: ActivityFinderParsed) {
  return {
    activity: parsed.activity,
    venue: parsed.venue,
    city: parsed.city,
    state: parsed.state,
    ageYears: parsed.ageYears,
    grade: parsed.grade,
    missingFields: parsed.missingFields,
    locationSource: parsed.locationSource,
  };
}

function redactLocationHintForStorage(locationHint: LocationHint | null) {
  if (!locationHint) return null;
  return {
    city: locationHint.city,
    state: locationHint.state,
    source: locationHint.source,
    confidence: locationHint.confidence,
    reason: locationHint.reason,
  };
}

function redactMatchForStorage(match: ActivityFinderResult | null) {
  if (!match) return null;
  return {
    status: match.status,
    venueName: match.venueName,
    activityLabel: match.activityLabel,
    providerKey: match.providerKey,
    providerName: match.providerName,
    targetUrlHost: match.targetUrl ? (() => {
      try {
        return new URL(match.targetUrl).hostname;
      } catch {
        return null;
      }
    })() : null,
    confidence: match.confidence ?? null,
    sourceFreshness: match.sourceFreshness ?? null,
    ageGradeFit: match.ageGradeFit ?? null,
    providerReadiness: match.providerReadiness ?? null,
    missingDetails: match.missingDetails ?? [],
  };
}

async function logActivityFinderSearch(
  supabase: ActivityFinderSearchLogger | null | undefined,
  input: ActivityFinderSearchInput,
  parsed: ActivityFinderParsed,
  locationHint: LocationHint | null,
  response: ActivityFinderResponse,
) {
  if (!supabase) return;

  try {
    await supabase.from("activity_finder_searches").insert({
      user_id: input.userId || null,
      raw_query: redactQuerySummary(input.query),
      parsed_query: redactParsedForStorage(parsed),
      location_hint: redactLocationHintForStorage(locationHint),
      best_match: redactMatchForStorage(response.bestMatch),
    });
  } catch (error: unknown) {
    console.warn("[ActivityFinder] Failed to log search", errorMessage(error));
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

  if (activityFinderOutOfScope(query, aiParsed)) {
    const response = outOfScopeResponse(parsed);
    await logActivityFinderSearch(deps.supabase, input, response.parsed, ipLocation, response);
    return response;
  }

  const detailGate = detailGatedResponse(parsed);
  if (detailGate) {
    await logActivityFinderSearch(deps.supabase, input, detailGate.parsed, ipLocation, detailGate);
    return detailGate;
  }

  const places = await (deps.searchPlaces || searchGooglePlaces)(parsed, ipLocation);
  const parsedFastPath = places.length ? null : fastPathCandidateFromParsed(parsed);

  const candidates = parsedFastPath ? [parsedFastPath] : places;
  const results = candidates.map((candidate) => resultFromCandidate(candidate, parsed));
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
      outOfScope: null,
    };
  } else {
    response = {
      parsed,
      bestMatch: needMoreDetailResult(parsed),
      otherMatches: [],
      outOfScope: null,
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
  activityFinderOutOfScope,
  detailGatedResponse,
  isRegistrationLikeUrl,
  candidateMatchesExplicitLocation,
};
