import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  createSignupIntent,
  getSignupIntent,
  patchSignupIntent,
  SignupIntentError,
  type SignupIntentEventInsert,
  type SignupIntentInsert,
  type SignupIntentRow,
  type SignupIntentStorage,
  type SignupIntentUpdate,
} from "./signupIntent.js";

type SupabaseError = {
  message?: string;
  code?: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: SupabaseError | null;
};

interface SupabaseQueryChain<T> {
  select(columns?: string): SupabaseQueryChain<T>;
  insert(values: unknown): SupabaseQueryChain<T>;
  update(values: unknown): SupabaseQueryChain<T>;
  eq(column: string, value: string): SupabaseQueryChain<T>;
  single(): Promise<SupabaseResult<T>>;
}

export interface SignupIntentSupabaseClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: SupabaseError | null;
    }>;
  };
  from<T>(table: string): SupabaseQueryChain<T>;
}

class SupabaseSignupIntentStorage implements SignupIntentStorage {
  constructor(private readonly supabase: SignupIntentSupabaseClient) {}

  async insertIntent(row: SignupIntentInsert): Promise<SignupIntentRow> {
    const result = await this.supabase
      .from<SignupIntentRow>("signup_intents")
      .insert(row)
      .select("*")
      .single();

    if (result.error || !result.data) {
      throw new SignupIntentError(500, "signup_intent_insert_failed", result.error?.message);
    }

    return result.data;
  }

  async getIntent(id: string, userId: string): Promise<SignupIntentRow | null> {
    const result = await this.supabase
      .from<SignupIntentRow>("signup_intents")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (result.error || !result.data) return null;
    return result.data;
  }

  async updateIntent(
    id: string,
    userId: string,
    patch: SignupIntentUpdate,
  ): Promise<SignupIntentRow | null> {
    const result = await this.supabase
      .from<SignupIntentRow>("signup_intents")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (result.error || !result.data) return null;
    return result.data;
  }

  async insertIntentEvent(event: SignupIntentEventInsert): Promise<void> {
    const result = await this.supabase
      .from<{ id: string }>("signup_intent_events")
      .insert(event)
      .select("id")
      .single();

    if (result.error) {
      console.warn("[SignupIntent] Failed to write audit event", result.error.message);
    }
  }

  async childBelongsToUser(childId: string, userId: string): Promise<boolean> {
    const result = await this.supabase
      .from<{ id: string }>("children")
      .select("id")
      .eq("id", childId)
      .eq("user_id", userId)
      .single();

    return Boolean(result.data && !result.error);
  }

  async autopilotRunBelongsToUser(runId: string, userId: string): Promise<boolean> {
    const result = await this.supabase
      .from<{ id: string }>("autopilot_runs")
      .select("id")
      .eq("id", runId)
      .eq("user_id", userId)
      .single();

    return Boolean(result.data && !result.error);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Cache-Control": "no-store",
};

function jsonResponse(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    ...corsHeaders,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(payload));
}

function authRequired(res: ServerResponse): void {
  jsonResponse(res, 401, {
    error: "authentication_required",
    message: "Sign in required",
  });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization || "";
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (body.length > 128_000) {
      throw new SignupIntentError(413, "request_too_large", "Request body too large");
    }
  }

  if (!body.trim()) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new SignupIntentError(400, "invalid_json", "Request body must be valid JSON");
  }
}

async function authenticate(
  req: IncomingMessage,
  supabase: SignupIntentSupabaseClient,
): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

function handleError(res: ServerResponse, error: unknown): void {
  if (error instanceof SignupIntentError) {
    jsonResponse(res, error.statusCode, {
      error: error.code,
      message: error.message,
    });
    return;
  }

  if (error instanceof ZodError) {
    jsonResponse(res, 400, {
      error: "validation_failed",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  console.error("[SignupIntent] Unexpected error", error instanceof Error ? error.message : error);
  jsonResponse(res, 500, { error: "signup_intent_failed" });
}

function extractIntentId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/signup-intents\/([^/]+)$/);
  return match?.[1] ?? null;
}

export async function handleSignupIntentApi(params: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  supabase: SignupIntentSupabaseClient;
}): Promise<void> {
  const { req, res, url, supabase } = params;
  const method = (req.method || "GET").toUpperCase();
  const storage = new SupabaseSignupIntentStorage(supabase);

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const userId = await authenticate(req, supabase);
    if (!userId) {
      authRequired(res);
      return;
    }

    if (url.pathname === "/api/signup-intents" && method === "POST") {
      const payload = await readBody(req);
      const result = await createSignupIntent(storage, userId, payload);
      jsonResponse(res, 201, result);
      return;
    }

    const intentId = extractIntentId(url.pathname);
    if (!intentId) {
      jsonResponse(res, 404, { error: "not_found" });
      return;
    }

    if (method === "GET") {
      const result = await getSignupIntent(storage, userId, intentId);
      jsonResponse(res, 200, result);
      return;
    }

    if (method === "PATCH") {
      const payload = await readBody(req);
      const result = await patchSignupIntent(storage, userId, intentId, payload);
      jsonResponse(res, 200, result);
      return;
    }

    jsonResponse(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    handleError(res, error);
  }
}
