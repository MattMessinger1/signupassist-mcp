import type { IncomingMessage, ServerResponse } from "node:http";
import { createSecretKey } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { corsHeadersForRequest, writeJson } from "./httpSecurity.js";

type SupabaseError = {
  message?: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: SupabaseError | null;
};

class HelperRunError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

interface SupabaseQueryChain<T> {
  select(columns?: string): SupabaseQueryChain<T>;
  eq(column: string, value: string): SupabaseQueryChain<T>;
  single(): Promise<SupabaseResult<T>>;
}

export interface HelperRunSupabaseClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: SupabaseError | null;
    }>;
  };
  from<T>(table: string): SupabaseQueryChain<T>;
}

type HelperRunRow = {
  id: string;
  user_id: string;
  provider_key: string;
  provider_name: string;
  target_url: string;
  target_program: string | null;
  child_id: string | null;
  status: string;
  confidence: string;
  caps: unknown;
  allowed_actions: unknown;
  stop_conditions: unknown;
  audit_events: unknown;
};

type ChildRow = {
  first_name: string;
  last_name: string;
};

type HelperCodePayload = {
  scope: "helper_run_packet";
  autopilot_run_id: string;
  user_id: string;
  provider_key: string;
  provider_name: string;
  target_program: string | null;
};

type PacketPreflightKey =
  | "providerAccountReady"
  | "childProfileReady"
  | "paymentPrepared"
  | "helperInstalled"
  | "targetUrlConfirmed";

type PacketPreflightState = Record<PacketPreflightKey, boolean>;

const PACKET_PREFLIGHT_KEYS: PacketPreflightKey[] = [
  "providerAccountReady",
  "childProfileReady",
  "paymentPrepared",
  "helperInstalled",
  "targetUrlConfirmed",
];

const DEFAULT_PREFLIGHT_STATE: PacketPreflightState = {
  providerAccountReady: false,
  childProfileReady: false,
  paymentPrepared: false,
  helperInstalled: false,
  targetUrlConfirmed: false,
};

const HELPER_RUN_SCOPE = "helper_run_packet";
const RUN_STATUSES_ALLOWED_FOR_HELPER = new Set([
  "draft",
  "ready",
  "scheduled",
  "waiting_for_registration_open",
  "running",
  "paused_for_parent",
  "registration_review_required",
  "payment_review_required",
  "payment_paused",
  "waiver_review_required",
  "final_submit_review_required",
  "provider_learning",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(status?: string | null) {
  return String(status || "draft").trim().toLowerCase();
}

function statusAllowedForHelper(status?: string | null) {
  const normalized = normalizeStatus(status);
  return RUN_STATUSES_ALLOWED_FOR_HELPER.has(normalized);
}

function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization || "";
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

function jsonResponse(req: IncomingMessage, res: ServerResponse, statusCode: number, payload: unknown) {
  writeJson(req, res, statusCode, payload);
}

function authRequired(req: IncomingMessage, res: ServerResponse) {
  jsonResponse(req, res, 401, {
    error: "authentication_required",
    message: "Sign in required",
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (body.length > 128_000) {
      throw new Error("Request body too large");
    }
  }

  if (!body.trim()) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function authenticateParent(
  req: IncomingMessage,
  supabase: HelperRunSupabaseClient,
): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

function helperSigningKey() {
  const secret = process.env.HELPER_LINK_SIGNING_KEY || "";
  if (!secret) {
    if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") {
      return createSecretKey(Buffer.from("dev-only-helper-link-signing-key"));
    }
    throw new Error("HELPER_LINK_SIGNING_KEY not set");
  }

  if (/^[A-Za-z0-9+/=]+$/.test(secret)) {
    try {
      return createSecretKey(Buffer.from(secret, "base64"));
    } catch {
      return createSecretKey(Buffer.from(secret));
    }
  }

  return createSecretKey(Buffer.from(secret));
}

function helperIssuer() {
  return process.env.HELPER_LINK_ISSUER || "signupassist-helper";
}

function helperAudience() {
  return process.env.HELPER_LINK_AUDIENCE || "signupassist-chrome-helper";
}

function helperTtlMinutes() {
  const raw = Number(process.env.HELPER_LINK_TTL_MINUTES || 720);
  return Number.isFinite(raw) && raw > 0 ? raw : 720;
}

function computeExpiry() {
  const expiresAt = new Date(Date.now() + helperTtlMinutes() * 60_000);
  return expiresAt;
}

function buildHelperCodePayload(input: {
  userId: string;
  run: HelperRunRow;
}): HelperCodePayload {
  return {
    scope: HELPER_RUN_SCOPE,
    autopilot_run_id: input.run.id,
    user_id: input.userId,
    provider_key: input.run.provider_key,
    provider_name: input.run.provider_name,
    target_program: input.run.target_program,
  };
}

async function issueHelperCode(input: { userId: string; run: HelperRunRow }) {
  const expiresAt = computeExpiry();
  const payload = buildHelperCodePayload(input);

  const helperCode = await new SignJWT(payload as never)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(helperIssuer())
    .setAudience(helperAudience())
    .setExpirationTime(expiresAt)
    .sign(helperSigningKey());

  return {
    helperCode,
    expiresAt: expiresAt.toISOString(),
  };
}

function isSensitiveRedactionKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const safePublicNameKeys = new Set([
    "activityname",
    "businessname",
    "classname",
    "companyname",
    "coursename",
    "organizationname",
    "orgname",
    "programname",
    "providername",
    "venuename",
  ]);

  if (safePublicNameKeys.has(normalized)) return false;
  return /(child|participant|first.?name|last.?name|full.?name|parent.?name|guardian.?name|contact.?name|emergency.?contact.?name|account.?holder.?name|dob|birth|age|grade|email|phone|address|credential|password|token|secret|session|cookie|auth|payment|card|cvv|cvc|medical|allerg|insurance|doctor|waiver|signature|ssn|social)/i.test(
    key,
  ) || /(^|[_-])(name|label|title)($|[_-])/i.test(key);
}

function redactAuditText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone redacted]")
    .replace(/\b\d{13,19}\b/g, "[payment redacted]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date redacted]")
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way)\b/gi,
      "[address redacted]",
    )
    .replace(/\b(?:password|token|secret|session|cookie|bearer)\s*[:=]\s*[^\s,;]+/gi, "[credential redacted]")
    .replace(/\b(?:cvv|cvc|card number|card_number|payment card)\s*[:=]?\s*[^\s,;]+/gi, "[payment redacted]")
    .replace(/\b(?:medical notes?|allergy notes?|allergies|diagnosis|insurance policy)\b[^.;\n]*/gi, "[sensitive health detail redacted]");
}

function urlHost(value: unknown) {
  if (typeof value !== "string") return "[redacted url]";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "[redacted url]";
  }
}

function redactAuditValue(value: unknown, key = "value", depth = 0): unknown {
  if (key === "user_id" || key === "userId" || isSensitiveRedactionKey(key)) return "[redacted]";
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactAuditText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redactAuditValue(item, key, depth + 1));
  if (!isRecord(value)) return "[unprintable]";

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => {
      if (childKey.toLowerCase().includes("url")) {
        return [`${childKey}_host`, urlHost(childValue)];
      }
      return [childKey, redactAuditValue(childValue, childKey, depth + 1)];
    }),
  );
}

function coercePreflight(value: unknown): PacketPreflightState {
  const result: PacketPreflightState = { ...DEFAULT_PREFLIGHT_STATE };
  if (!isRecord(value)) return result;

  for (const key of PACKET_PREFLIGHT_KEYS) {
    result[key] = Boolean(value[key]);
  }

  return result;
}

function calculateReadinessScore(preflight: PacketPreflightState) {
  const completed = PACKET_PREFLIGHT_KEYS.filter((key) => preflight[key]).length;
  return Math.round((completed / PACKET_PREFLIGHT_KEYS.length) * 100);
}

function getPreflightLabels(preflight: PacketPreflightState) {
  const completed: string[] = [];
  const missing: string[] = [];
  const labels: Record<PacketPreflightKey, string> = {
    providerAccountReady: "Provider login works",
    childProfileReady: "Child profile is ready",
    paymentPrepared: "Provider payment is prepared",
    helperInstalled: "Chrome helper is installed",
    targetUrlConfirmed: "Signup URL is confirmed",
  };

  for (const key of PACKET_PREFLIGHT_KEYS) {
    if (preflight[key]) completed.push(labels[key]);
    else missing.push(labels[key]);
  }

  return { completed, missing };
}

function parseCaps(caps: unknown) {
  if (!isRecord(caps)) {
    return {
      maxTotalCents: null,
      registrationOpensAt: null,
      participantAgeYears: null,
      reminder: null,
      finder: null,
      preflight: { ...DEFAULT_PREFLIGHT_STATE },
      runPacketVersion: null,
    };
  }

  const reminder = isRecord(caps.reminder)
    ? {
        minutesBefore: typeof caps.reminder.minutesBefore === "number" ? caps.reminder.minutesBefore : 10,
        channels: Array.isArray(caps.reminder.channels)
          ? caps.reminder.channels.filter((channel) => typeof channel === "string")
          : ["email"],
        phoneNumber:
          typeof caps.reminder.phoneNumber === "string" ? caps.reminder.phoneNumber : null,
      }
    : null;

  return {
    maxTotalCents:
      typeof caps.max_total_cents === "number"
        ? caps.max_total_cents
        : typeof caps.maxTotalCents === "number"
          ? caps.maxTotalCents
          : null,
    registrationOpensAt:
      typeof caps.registration_opens_at === "string"
        ? caps.registration_opens_at
        : typeof caps.registrationOpensAt === "string"
          ? caps.registrationOpensAt
          : null,
    participantAgeYears:
      typeof caps.participant_age_years === "number"
        ? caps.participant_age_years
        : typeof caps.participantAgeYears === "number"
          ? caps.participantAgeYears
          : null,
    reminder,
    finder: isRecord(caps.finder) ? caps.finder : null,
    preflight: coercePreflight(caps.preflight),
    runPacketVersion:
      typeof caps.run_packet_version === "number"
        ? caps.run_packet_version
        : typeof caps.runPacketVersion === "number"
          ? caps.runPacketVersion
          : null,
  };
}

function buildPacketFromRun(params: {
  run: HelperRunRow;
  childName: string | null;
}) {
  const caps = parseCaps(params.run.caps);
  const preflight = caps.preflight;
  const readiness = getPreflightLabels(preflight);

  return {
    version: 1,
    mode: "supervised_autopilot" as const,
    billing: {
      subscription: "$9/month",
      successFeeCents: 0,
      futureSetAndForgetSuccessFeeCents: 2000,
      policy: [
        "SignupAssist membership is $9/month.",
        "Program fees are paid directly to the provider.",
        "No success fee is charged for supervised autopilot.",
        "Success fees may apply later for fully automated Set and Forget registrations.",
      ],
    },
    payment: {
      providerFeeHandling: "provider_direct" as const,
      helperPausesAtCheckout: true,
      instructions:
        "The parent pays provider program fees on the provider site. SignupAssist pauses at checkout, payment confirmation, and final submit.",
    },
    target: {
      providerKey: params.run.provider_key,
      providerName: params.run.provider_name,
      confidence: params.run.confidence as "verified" | "beta",
      url: params.run.target_url,
      program: params.run.target_program,
      registrationOpensAt: caps.registrationOpensAt,
      maxTotalCents: caps.maxTotalCents,
      participantAgeYears: caps.participantAgeYears,
      child: params.childName ? { name: params.childName } : null,
    },
    reminder: caps.reminder || {
      minutesBefore: 10,
      channels: ["email"],
      phoneNumber: null,
    },
    finder: caps.finder || null,
    safety: {
      allowedActions: Array.isArray(params.run.allowed_actions)
        ? params.run.allowed_actions.filter((action) => typeof action === "string")
        : [],
      stopConditions: Array.isArray(params.run.stop_conditions)
        ? params.run.stop_conditions.filter((condition) => typeof condition === "string")
        : [],
    },
    readiness: {
      score: calculateReadinessScore(preflight),
      checks: preflight,
      completed: readiness.completed,
      missing: readiness.missing,
    },
    setAndForgetFoundation: {
      capturesAuditTrail: true as const,
      capturesPauseReasons: true as const,
      capturesPriceCaps: true as const,
      finalSubmitRequiresParentApproval: true as const,
    },
    ...(Array.isArray(params.run.audit_events) && params.run.audit_events.length
      ? { audit_events: redactAuditValue(params.run.audit_events, "audit_events") }
      : {}),
  };
}

async function fetchRunForUser(
  supabase: HelperRunSupabaseClient,
  runId: string,
  userId: string,
): Promise<HelperRunRow | null> {
  const result = await supabase
    .from<HelperRunRow>("autopilot_runs")
    .select("id, user_id, provider_key, provider_name, target_url, target_program, child_id, status, confidence, caps, allowed_actions, stop_conditions, audit_events")
    .eq("id", runId)
    .eq("user_id", userId)
    .single();

  if (result.error || !result.data) return null;
  return result.data;
}

async function fetchChildName(
  supabase: HelperRunSupabaseClient,
  childId: string,
  userId: string,
): Promise<string | null> {
  const result = await supabase
    .from<ChildRow>("children")
    .select("first_name, last_name")
    .eq("id", childId)
    .eq("user_id", userId)
    .single();

  if (result.error || !result.data) return null;
  const name = [result.data.first_name, result.data.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

async function verifyHelperCode(helperCode: string) {
  const { payload } = await jwtVerify(helperCode, helperSigningKey(), {
    issuer: helperIssuer(),
    audience: helperAudience(),
  });

  const scope = (payload as Record<string, unknown>).scope;
  const scopes = Array.isArray(scope) ? scope : typeof scope === "string" ? [scope] : [];
  if (!scopes.includes(HELPER_RUN_SCOPE)) {
    throw new HelperRunError("Helper code missing required scope", 403);
  }

  const autopilotRunId = typeof payload.autopilot_run_id === "string" ? payload.autopilot_run_id : null;
  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  const providerKey = typeof payload.provider_key === "string" ? payload.provider_key : null;
  const providerName = typeof payload.provider_name === "string" ? payload.provider_name : null;
  const targetProgram = payload.target_program === null || typeof payload.target_program === "string"
    ? payload.target_program
    : null;

  if (!autopilotRunId || !userId || !providerKey || !providerName) {
    throw new HelperRunError("Helper code payload is incomplete", 400);
  }

  return {
    autopilotRunId,
    userId,
    providerKey,
    providerName,
    targetProgram,
  };
}

function handleError(req: IncomingMessage, res: ServerResponse, error: unknown) {
  if (error instanceof HelperRunError) {
    jsonResponse(req, res, error.statusCode, {
      error: "helper_run_failed",
      message: error.message,
    });
    return;
  }

  if (error instanceof Error && error.message === "Request body must be valid JSON") {
    jsonResponse(req, res, 400, {
      error: "invalid_json",
      message: error.message,
    });
    return;
  }

  if (error instanceof Error && error.message === "Request body too large") {
    jsonResponse(req, res, 413, {
      error: "request_too_large",
      message: error.message,
    });
    return;
  }

  console.error("[HelperRunApi] Unexpected error", error instanceof Error ? error.message : error);
  jsonResponse(req, res, 500, { error: "helper_run_failed" });
}

export async function handleHelperRunApi(params: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  supabase: HelperRunSupabaseClient;
}): Promise<void> {
  const { req, res, url, supabase } = params;
  const method = (req.method || "GET").toUpperCase();

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeadersForRequest(req));
      res.end();
      return;
    }

    if (url.pathname === "/api/helper/run-links") {
      if (method !== "POST") {
        jsonResponse(req, res, 405, { error: "method_not_allowed" });
        return;
      }

      const userId = await authenticateParent(req, supabase);
      if (!userId) {
        authRequired(req, res);
        return;
      }

      const body = await readBody(req);
      const autopilotRunId =
        typeof body === "object" && body !== null
          ? String((body as Record<string, unknown>).autopilotRunId || (body as Record<string, unknown>).autopilot_run_id || "").trim()
          : "";

      if (!autopilotRunId) {
        jsonResponse(req, res, 400, {
          error: "autopilot_run_id_required",
          message: "autopilotRunId is required",
        });
        return;
      }

      const run = await fetchRunForUser(supabase, autopilotRunId, userId);
      if (!run) {
        jsonResponse(req, res, 404, {
          error: "autopilot_run_not_found",
          message: "Autopilot run not found",
        });
        return;
      }

      if (!statusAllowedForHelper(run.status)) {
        jsonResponse(req, res, 409, {
          error: "autopilot_run_not_ready",
          message: "Autopilot run is not ready for a helper link",
        });
        return;
      }

      const { helperCode, expiresAt } = await issueHelperCode({ userId, run });
      jsonResponse(req, res, 200, {
        helperCode,
        expiresAt,
        provider: run.provider_name,
        program: run.target_program,
      });
      return;
    }

    if (url.pathname === "/api/helper/run-packet") {
      if (method !== "POST") {
        jsonResponse(req, res, 405, { error: "method_not_allowed" });
        return;
      }

      const body = await readBody(req);
      const helperCode =
        typeof body === "object" && body !== null
          ? String((body as Record<string, unknown>).helperCode || (body as Record<string, unknown>).helper_code || "").trim()
          : "";

      if (!helperCode) {
        jsonResponse(req, res, 400, {
          error: "helper_code_required",
          message: "helperCode is required",
        });
        return;
      }

      const helperContext = await verifyHelperCode(helperCode);
      const run = await fetchRunForUser(supabase, helperContext.autopilotRunId, helperContext.userId);
      if (!run) {
        jsonResponse(req, res, 404, {
          error: "autopilot_run_not_found",
          message: "Autopilot run not found",
        });
        return;
      }

      if (!statusAllowedForHelper(run.status)) {
        jsonResponse(req, res, 409, {
          error: "autopilot_run_not_ready",
          message: "Autopilot run is not ready for a helper packet",
        });
        return;
      }

      if (run.provider_key !== helperContext.providerKey || run.provider_name !== helperContext.providerName) {
        jsonResponse(req, res, 409, {
          error: "helper_code_run_mismatch",
          message: "Helper code does not match the current autopilot run",
        });
        return;
      }

      if (helperContext.targetProgram !== run.target_program) {
        jsonResponse(req, res, 409, {
          error: "helper_code_run_mismatch",
          message: "Helper code does not match the current autopilot run",
        });
        return;
      }

      const childName = run.child_id ? await fetchChildName(supabase, run.child_id, run.user_id) : null;
      const packet = buildPacketFromRun({ run, childName });

      jsonResponse(req, res, 200, packet);
      return;
    }

    jsonResponse(req, res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof Error && (error.name === "JWTExpired" || /expir/i.test(error.message))) {
      jsonResponse(req, res, 401, {
        error: "helper_code_expired",
        message: "Helper code has expired",
      });
      return;
    }

    if (error instanceof Error && /signature|JWS|JWT/i.test(error.message)) {
      jsonResponse(req, res, 401, {
        error: "helper_code_invalid",
        message: "Helper code is invalid",
      });
      return;
    }

    handleError(req, res, error);
  }
}
