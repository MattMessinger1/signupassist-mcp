import { z } from "zod";

export const SIGNUP_INTENT_STATUSES = [
  "draft",
  "needs_profile",
  "ready_for_autopilot",
  "scheduled",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SignupIntentStatus = (typeof SIGNUP_INTENT_STATUSES)[number];

export type JsonObject = Record<string, unknown>;

export interface SignupIntentRow {
  id: string;
  user_id: string;
  source: string;
  original_query: string | null;
  parsed_activity: string | null;
  parsed_venue: string | null;
  parsed_city: string | null;
  parsed_state: string | null;
  parsed_age_years: number | null;
  parsed_grade: string | null;
  selected_result: JsonObject;
  target_url: string | null;
  provider_key: string | null;
  provider_name: string | null;
  finder_status: string | null;
  confidence: number | null;
  source_freshness: string | null;
  selected_child_id: string | null;
  autopilot_run_id: string | null;
  status: SignupIntentStatus;
  created_at: string;
  updated_at: string;
}

export interface SignupIntentEventInsert {
  signup_intent_id: string;
  user_id: string;
  event_type: string;
  event: JsonObject;
}

export interface SignupIntentInsert {
  user_id: string;
  source: string;
  original_query: string | null;
  parsed_activity: string | null;
  parsed_venue: string | null;
  parsed_city: string | null;
  parsed_state: string | null;
  parsed_age_years: number | null;
  parsed_grade: string | null;
  selected_result: JsonObject;
  target_url: string | null;
  provider_key: string | null;
  provider_name: string | null;
  finder_status: string | null;
  confidence: number | null;
  source_freshness: string | null;
  status: SignupIntentStatus;
}

export interface SignupIntentUpdate {
  selected_child_id?: string | null;
  status?: SignupIntentStatus;
  autopilot_run_id?: string | null;
  target_url?: string | null;
  provider_key?: string | null;
  provider_name?: string | null;
}

export interface SignupIntentStorage {
  insertIntent(row: SignupIntentInsert): Promise<SignupIntentRow>;
  getIntent(id: string, userId: string): Promise<SignupIntentRow | null>;
  updateIntent(id: string, userId: string, patch: SignupIntentUpdate): Promise<SignupIntentRow | null>;
  insertIntentEvent(event: SignupIntentEventInsert): Promise<void>;
  childBelongsToUser?(childId: string, userId: string): Promise<boolean>;
  autopilotRunBelongsToUser?(runId: string, userId: string): Promise<boolean>;
}

const nullableTrimmedString = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable()
  .transform((value) => {
    if (value === undefined || value === null || value === "") return null;
    return value;
  });

const nullableShortString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .nullable()
  .transform((value) => {
    if (value === undefined || value === null || value === "") return null;
    return value;
  });

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Only https URLs are allowed");

const nullableHttpsUrl = httpsUrl
  .optional()
  .nullable()
  .transform((value) => {
    if (value === undefined || value === null || value === "") return null;
    return value;
  });

const jsonObjectSchema = z.record(z.unknown());

const parsedSchema = z
  .object({
    activity: nullableShortString,
    venue: nullableShortString,
    city: nullableShortString,
    state: nullableShortString,
    ageYears: z.number().int().min(0).max(19).optional().nullable().transform((value) => value ?? null),
    grade: nullableShortString,
  })
  .partial()
  .default({});

export const createSignupIntentSchema = z
  .object({
    source: z.string().trim().max(80).optional().default("activity_finder"),
    originalQuery: nullableTrimmedString,
    parsed: parsedSchema,
    selectedResult: jsonObjectSchema.default({}),
    targetUrl: nullableHttpsUrl,
    providerKey: nullableShortString,
    providerName: nullableShortString,
    finderStatus: nullableShortString,
    confidence: z.number().min(0).max(1).optional().nullable().transform((value) => value ?? null),
    sourceFreshness: nullableShortString,
  })
  .strip();

export const signupIntentIdSchema = z.string().uuid();

export const patchSignupIntentSchema = z
  .object({
    selected_child_id: z.string().uuid().optional().nullable(),
    status: z.enum(SIGNUP_INTENT_STATUSES).optional(),
    autopilot_run_id: z.string().uuid().optional().nullable(),
    target_url: nullableHttpsUrl.optional(),
    provider_key: nullableShortString.optional(),
    provider_name: nullableShortString.optional(),
  })
  .strip();

export type CreateSignupIntentInput = z.infer<typeof createSignupIntentSchema>;
export type PatchSignupIntentInput = z.infer<typeof patchSignupIntentSchema>;

export class SignupIntentError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "SignupIntentError";
  }
}

export function createSignupIntentInsert(
  userId: string,
  input: CreateSignupIntentInput,
): SignupIntentInsert {
  const parsed = input.parsed ?? {};

  return {
    user_id: userId,
    source: input.source || "activity_finder",
    original_query: input.originalQuery,
    parsed_activity: parsed.activity ?? null,
    parsed_venue: parsed.venue ?? null,
    parsed_city: parsed.city ?? null,
    parsed_state: parsed.state ?? null,
    parsed_age_years: parsed.ageYears ?? null,
    parsed_grade: parsed.grade ?? null,
    selected_result: input.selectedResult,
    target_url: input.targetUrl,
    provider_key: input.providerKey,
    provider_name: input.providerName,
    finder_status: input.finderStatus,
    confidence: input.confidence,
    source_freshness: input.sourceFreshness,
    status: input.finderStatus === "need_more_detail" ? "needs_profile" : "ready_for_autopilot",
  };
}

function canPatchProviderFields(status: SignupIntentStatus): boolean {
  return status === "draft" || status === "ready_for_autopilot";
}

export function createSignupIntentPatch(
  current: SignupIntentRow,
  input: PatchSignupIntentInput,
): SignupIntentUpdate {
  const patch: SignupIntentUpdate = {};

  if ("selected_child_id" in input) patch.selected_child_id = input.selected_child_id ?? null;
  if ("status" in input && input.status) patch.status = input.status;
  if ("autopilot_run_id" in input) patch.autopilot_run_id = input.autopilot_run_id ?? null;

  const providerPatchRequested =
    "target_url" in input || "provider_key" in input || "provider_name" in input;

  if (providerPatchRequested && !canPatchProviderFields(current.status)) {
    throw new SignupIntentError(
      409,
      "intent_not_editable",
      "Provider fields can only be changed while the intent is draft or ready.",
    );
  }

  if ("target_url" in input) patch.target_url = input.target_url ?? null;
  if ("provider_key" in input) patch.provider_key = input.provider_key ?? null;
  if ("provider_name" in input) patch.provider_name = input.provider_name ?? null;

  return patch;
}

function targetUrlHost(targetUrl: string | null): string | null {
  if (!targetUrl) return null;
  try {
    return new URL(targetUrl).host;
  } catch {
    return null;
  }
}

function selectedResultAuditSummary(selectedResult: JsonObject): JsonObject {
  return {
    status: typeof selectedResult.status === "string" ? selectedResult.status : null,
    hasTargetUrl: typeof selectedResult.targetUrl === "string" && selectedResult.targetUrl.length > 0,
    providerKey: typeof selectedResult.providerKey === "string" ? selectedResult.providerKey : null,
    providerName: typeof selectedResult.providerName === "string" ? selectedResult.providerName : null,
  };
}

export function createIntentAuditEvent(
  eventType: string,
  row: SignupIntentRow,
  extra: JsonObject = {},
): SignupIntentEventInsert {
  return {
    signup_intent_id: row.id,
    user_id: row.user_id,
    event_type: eventType,
    event: {
      status: row.status,
      source: row.source,
      providerKey: row.provider_key,
      providerName: row.provider_name,
      targetUrlHost: targetUrlHost(row.target_url),
      finderStatus: row.finder_status,
      selectedResult: selectedResultAuditSummary(row.selected_result),
      ...extra,
    },
  };
}

export function toSignupIntentResponse(row: SignupIntentRow) {
  return {
    id: row.id,
    source: row.source,
    originalQuery: row.original_query,
    parsed: {
      activity: row.parsed_activity,
      venue: row.parsed_venue,
      city: row.parsed_city,
      state: row.parsed_state,
      ageYears: row.parsed_age_years,
      grade: row.parsed_grade,
    },
    selectedResult: row.selected_result,
    targetUrl: row.target_url,
    providerKey: row.provider_key,
    providerName: row.provider_name,
    finderStatus: row.finder_status,
    confidence: row.confidence,
    sourceFreshness: row.source_freshness,
    selectedChildId: row.selected_child_id,
    autopilotRunId: row.autopilot_run_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSignupIntent(
  storage: SignupIntentStorage,
  userId: string,
  body: unknown,
) {
  const input = createSignupIntentSchema.parse(body);
  const row = await storage.insertIntent(createSignupIntentInsert(userId, input));
  await storage.insertIntentEvent(createIntentAuditEvent("created", row));

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function getSignupIntent(
  storage: SignupIntentStorage,
  userId: string,
  id: string,
) {
  const intentId = signupIntentIdSchema.parse(id);
  const row = await storage.getIntent(intentId, userId);
  if (!row) {
    throw new SignupIntentError(404, "signup_intent_not_found", "Signup intent not found");
  }

  await storage.insertIntentEvent(createIntentAuditEvent("read", row));
  return toSignupIntentResponse(row);
}

export async function patchSignupIntent(
  storage: SignupIntentStorage,
  userId: string,
  id: string,
  body: unknown,
) {
  const intentId = signupIntentIdSchema.parse(id);
  const current = await storage.getIntent(intentId, userId);
  if (!current) {
    throw new SignupIntentError(404, "signup_intent_not_found", "Signup intent not found");
  }

  const input = patchSignupIntentSchema.parse(body);
  if (input.selected_child_id && storage.childBelongsToUser) {
    const ownsChild = await storage.childBelongsToUser(input.selected_child_id, userId);
    if (!ownsChild) {
      throw new SignupIntentError(404, "child_not_found", "Child profile not found");
    }
  }
  if (input.autopilot_run_id && storage.autopilotRunBelongsToUser) {
    const ownsRun = await storage.autopilotRunBelongsToUser(input.autopilot_run_id, userId);
    if (!ownsRun) {
      throw new SignupIntentError(404, "autopilot_run_not_found", "Autopilot run not found");
    }
  }

  const patch = createSignupIntentPatch(current, input);
  const updated = await storage.updateIntent(intentId, userId, patch);
  if (!updated) {
    throw new SignupIntentError(404, "signup_intent_not_found", "Signup intent not found");
  }

  await storage.insertIntentEvent(
    createIntentAuditEvent("updated", updated, {
      changedFields: Object.keys(patch).sort(),
    }),
  );

  return toSignupIntentResponse(updated);
}
