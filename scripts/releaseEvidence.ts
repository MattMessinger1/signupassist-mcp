#!/usr/bin/env tsx
import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { redactAuditText, summarizeAuditEvents } from "../src/lib/dashboardStatus";
import {
  buildRedactedProviderObservation,
  getProviderReadinessSummary,
} from "../src/lib/providerLearning";
import type { Database } from "../src/integrations/supabase/types";
import { isSensitiveRedactionKey } from "../src/lib/redactionKeys";

type SignupIntentRow = Database["public"]["Tables"]["signup_intents"]["Row"];
type SignupIntentEventRow = Database["public"]["Tables"]["signup_intent_events"]["Row"];
type AutopilotRunRow = Database["public"]["Tables"]["autopilot_runs"]["Row"];
type EvidenceSupabase = SupabaseClient<Database>;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function urlHost(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function safeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return redactAuditText(trimmed);
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function redactEvidenceValue(value: unknown, key = "value", depth = 0): unknown {
  if (key === "user_id" || key === "userId" || isSensitiveRedactionKey(key)) return "[redacted]";
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactAuditText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => redactEvidenceValue(item, key, depth + 1));
  }
  if (!isRecord(value)) return "[unprintable]";

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => {
      if (childKey.toLowerCase().includes("url")) {
        return [`${childKey}_host`, urlHost(childValue) || "[invalid-or-redacted-url]"];
      }
      return [childKey, redactEvidenceValue(childValue, childKey, depth + 1)];
    }),
  );
}

function selectedResultSummary(value: unknown) {
  if (!isRecord(value)) {
    return {
      present: false,
    };
  }

  return {
    present: true,
    status: safeText(value.status),
    provider_key: safeText(value.providerKey ?? value.provider_key),
    provider_name: safeText(value.providerName ?? value.provider_name),
    activity_title: safeText(value.activityLabel ?? value.title ?? value.name ?? value.programName),
    venue_name: safeText(value.venueName ?? value.venue ?? value.locationName),
    target_url_host: urlHost(value.targetUrl ?? value.target_url ?? value.signupUrl),
    target_url_present: Boolean(value.targetUrl ?? value.target_url ?? value.signupUrl),
    address_present: Boolean(value.address ?? value.locationAddress),
    missing_detail_count: Array.isArray(value.missingDetails) ? value.missingDetails.length : 0,
    match_reason_count: Array.isArray(value.whyThisMatch) ? value.whyThisMatch.length : 0,
    provider_readiness: redactEvidenceValue(value.providerReadiness ?? value.provider_readiness, "provider_readiness"),
  };
}

export function summarizeSignupIntentForEvidence(intent: SignupIntentRow | null) {
  if (!intent) return null;

  return {
    id: intent.id,
    source: intent.source,
    status: intent.status,
    provider_key: intent.provider_key,
    provider_name: safeText(intent.provider_name),
    finder_status: intent.finder_status,
    confidence: intent.confidence,
    source_freshness: safeText(intent.source_freshness),
    target_url_host: urlHost(intent.target_url),
    target_url_present: Boolean(intent.target_url),
    parsed: {
      activity: safeText(intent.parsed_activity),
      venue: safeText(intent.parsed_venue),
      city: safeText(intent.parsed_city),
      state: safeText(intent.parsed_state),
      age_years_present: intent.parsed_age_years !== null,
      grade_present: Boolean(intent.parsed_grade),
    },
    selected_result: selectedResultSummary(intent.selected_result),
    selected_child_attached: Boolean(intent.selected_child_id),
    autopilot_run_id: intent.autopilot_run_id,
    created_at: intent.created_at,
    updated_at: intent.updated_at,
  };
}

function summarizeCaps(caps: unknown) {
  if (!isRecord(caps)) {
    return {
      present: Boolean(caps),
    };
  }

  return {
    present: true,
    max_total_cents: safeNumber(caps.max_total_cents ?? caps.maxTotalCents ?? caps.max_total_price_cents),
    price_cap_cents: safeNumber(caps.price_cap_cents ?? caps.priceCapCents),
    helper_pauses_at_checkout: caps.helper_pauses_at_checkout ?? caps.helperPausesAtCheckout ?? null,
    redacted_detail: redactEvidenceValue(caps, "caps"),
  };
}

export function summarizeAutopilotRunForEvidence(run: AutopilotRunRow | null) {
  if (!run) return null;

  const readiness = getProviderReadinessSummary(run.provider_key);
  const observation = buildRedactedProviderObservation(run);

  return {
    id: run.id,
    status: run.status,
    provider_key: run.provider_key,
    provider_name: safeText(run.provider_name),
    target_url_host: urlHost(run.target_url),
    target_url_present: Boolean(run.target_url),
    target_program: safeText(run.target_program),
    confidence: run.confidence,
    child_attached: Boolean(run.child_id),
    caps: summarizeCaps(run.caps),
    allowed_actions: redactEvidenceValue(run.allowed_actions, "allowed_actions"),
    stop_conditions: redactEvidenceValue(run.stop_conditions, "stop_conditions"),
    audit_event_summaries: summarizeAuditEvents(run.audit_events, 10),
    provider_readiness: {
      level: readiness.readinessLevel,
      confidence: readiness.confidenceScore,
      active_playbook_version: readiness.activePlaybookVersion,
      fixture_coverage: readiness.fixtureCoverage,
      promotion_requires_admin_review: readiness.promotionPolicy.requiresAdminReview,
      model_output_can_promote: readiness.promotionPolicy.modelOutputCanPromote,
    },
    redacted_provider_observation: observation,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

export function summarizeIntentEventsForEvidence(events: SignupIntentEventRow[]) {
  return events.map((event) => ({
    id: event.id,
    signup_intent_id: event.signup_intent_id,
    event_type: event.event_type,
    event: redactEvidenceValue(event.event, "event"),
    created_at: event.created_at,
  }));
}

export function buildReleaseEvidence(input: {
  signupIntent: SignupIntentRow | null;
  signupIntentEvents?: SignupIntentEventRow[];
  autopilotRun: AutopilotRunRow | null;
}) {
  return {
    generated_at: new Date().toISOString(),
    redaction_policy: {
      omits_user_ids: true,
      omits_child_ids: true,
      omits_child_pii: true,
      omits_credentials_tokens_payment_and_health_details: true,
      target_urls_reduced_to_hostnames: true,
    },
    signup_intent: summarizeSignupIntentForEvidence(input.signupIntent),
    signup_intent_events: summarizeIntentEventsForEvidence(input.signupIntentEvents || []),
    autopilot_run: summarizeAutopilotRunForEvidence(input.autopilotRun),
  };
}

async function fetchMaybeSingle<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
) {
  const { data, error } = await query;
  if (error) throw new Error(`${label} query failed: ${error.message}`);
  return data;
}

async function loadEvidenceRows(supabase: EvidenceSupabase, signupIntentId?: string, autopilotRunId?: string) {
  const signupIntent = signupIntentId
    ? await fetchMaybeSingle<SignupIntentRow>(
        supabase.from("signup_intents").select("*").eq("id", signupIntentId).maybeSingle(),
        "signup_intents",
      )
    : null;

  const inferredRunId = autopilotRunId || signupIntent?.autopilot_run_id || undefined;
  const autopilotRun = inferredRunId
    ? await fetchMaybeSingle<AutopilotRunRow>(
        supabase.from("autopilot_runs").select("*").eq("id", inferredRunId).maybeSingle(),
        "autopilot_runs",
      )
    : null;

  const signupIntentEvents = signupIntentId
    ? await fetchMaybeSingle<SignupIntentEventRow[]>(
        supabase
          .from("signup_intent_events")
          .select("*")
          .eq("signup_intent_id", signupIntentId)
          .order("created_at", { ascending: true }),
        "signup_intent_events",
      )
    : [];

  return { signupIntent, signupIntentEvents: signupIntentEvents || [], autopilotRun };
}

export async function main() {
  const signupIntentId = readArg("signup-intent-id");
  const autopilotRunId = readArg("autopilot-run-id");

  if (!signupIntentId && !autopilotRunId) {
    throw new Error("Provide --signup-intent-id=<uuid> and/or --autopilot-run-id=<uuid>");
  }

  const supabase = createClient<Database>(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const evidence = buildReleaseEvidence(await loadEvidenceRows(supabase, signupIntentId, autopilotRunId));
  console.log(JSON.stringify(evidence, null, process.argv.includes("--pretty") ? 2 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[release-evidence] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
