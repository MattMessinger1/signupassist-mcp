import type { ActivityFinderParsed, ActivityFinderResult } from "@/lib/activityFinder";

const SIGNUP_INTENT_BASE =
  import.meta.env.VITE_MCP_BASE_URL || import.meta.env.VITE_MCP_SERVER_URL || "";

export type SignupIntentStatus =
  | "draft"
  | "needs_profile"
  | "ready_for_autopilot"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface SignupIntent {
  id: string;
  source: string;
  originalQuery: string | null;
  parsed: {
    activity: string | null;
    venue: string | null;
    city: string | null;
    state: string | null;
    ageYears: number | null;
    grade: string | null;
  };
  selectedResult: Record<string, unknown>;
  targetUrl: string | null;
  providerKey: string | null;
  providerName: string | null;
  finderStatus: string | null;
  confidence: number | null;
  sourceFreshness: string | null;
  selectedChildId: string | null;
  autopilotRunId: string | null;
  status: SignupIntentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSignupIntentInput {
  source?: string;
  originalQuery?: string | null;
  parsed?: Partial<SignupIntent["parsed"]>;
  selectedResult: Record<string, unknown>;
  targetUrl?: string | null;
  providerKey?: string | null;
  providerName?: string | null;
  finderStatus?: string | null;
  confidence?: number | null;
  sourceFreshness?: string | null;
}

export interface CreateSignupIntentResponse {
  id: string;
  status: SignupIntentStatus;
  createdAt: string;
}

export interface UpdateSignupIntentInput {
  selected_child_id?: string | null;
  status?: SignupIntentStatus;
  autopilot_run_id?: string | null;
  target_url?: string | null;
  provider_key?: string | null;
  provider_name?: string | null;
}

async function authHeaders() {
  const { supabase } = await import("@/integrations/supabase/client");
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in required");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

function apiBase() {
  return SIGNUP_INTENT_BASE || window.location.origin;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: "request_failed" }));
  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function createSignupIntent(input: CreateSignupIntentInput) {
  const headers = await authHeaders();
  const response = await fetch(`${apiBase()}/api/signup-intents`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  return parseJsonResponse<CreateSignupIntentResponse>(response);
}

export async function getSignupIntent(id: string) {
  const headers = await authHeaders();
  const response = await fetch(`${apiBase()}/api/signup-intents/${encodeURIComponent(id)}`, {
    method: "GET",
    headers,
  });

  return parseJsonResponse<SignupIntent>(response);
}

export async function updateSignupIntent(id: string, input: UpdateSignupIntentInput) {
  const headers = await authHeaders();
  const response = await fetch(`${apiBase()}/api/signup-intents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(input),
  });

  return parseJsonResponse<SignupIntent>(response);
}

export function buildAutopilotIntentPath(id: string) {
  const params = new URLSearchParams({ intent: id });
  return `/autopilot?${params.toString()}`;
}

export function buildSignupIntentFromFinderResult(params: {
  query: string;
  parsed: ActivityFinderParsed;
  result: ActivityFinderResult;
}): CreateSignupIntentInput | null {
  const { query, parsed, result } = params;

  if (result.status === "need_more_detail") {
    return null;
  }

  return {
    source: "activity_finder",
    originalQuery: query,
    parsed: {
      activity: parsed.activity,
      venue: parsed.venue,
      city: parsed.city,
      state: parsed.state,
      ageYears: parsed.ageYears,
      grade: parsed.grade,
    },
    selectedResult: { ...result },
    targetUrl: result.targetUrl,
    providerKey: result.providerKey,
    providerName: result.providerName,
    finderStatus: result.status,
    confidence: null,
    sourceFreshness: null,
  };
}
