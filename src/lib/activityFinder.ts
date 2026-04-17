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

const ACTIVITY_FINDER_BASE =
  import.meta.env.VITE_MCP_BASE_URL || import.meta.env.VITE_MCP_SERVER_URL || "";

export async function searchActivityFinder(
  query: string,
  accessToken?: string | null,
) {
  const base = ACTIVITY_FINDER_BASE || window.location.origin;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${base}/api/activity-finder/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "activity_finder_failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<ActivityFinderResponse>;
}

export function activityFinderStatusLabel(status: ActivityFinderStatus) {
  switch (status) {
    case "tested_fast_path":
      return "Tested Fast Path";
    case "guided_autopilot":
      return "Guided Autopilot";
    case "needs_signup_link":
      return "Needs signup link";
    case "need_more_detail":
      return "Need one more detail";
  }
}

export function activityFinderStatusTone(status: ActivityFinderStatus) {
  switch (status) {
    case "tested_fast_path":
      return "border-[#b9e5c7] bg-[#eaf7ef] text-[#2f855a]";
    case "guided_autopilot":
      return "border-[#b8d7e6] bg-[#e8f2f7] text-[#1f5a7a]";
    case "needs_signup_link":
      return "border-[#f3d8b6] bg-[#fff3e2] text-[#d9822b]";
    case "need_more_detail":
      return "border-border bg-secondary text-muted-foreground";
  }
}
