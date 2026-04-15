#!/usr/bin/env tsx
/**
 * Supabase smoke checks.
 *
 * Non-destructive: verifies service-role connectivity and key tables used by
 * the Supabase/Railway V1 architecture. Optional public function invocation is
 * supported when SUPABASE_ANON_KEY is present.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const tableChecks: Array<{ table: string; select: string }> = [
  { table: "children", select: "id" },
  { table: "plans", select: "id" },
  { table: "plan_executions", select: "id" },
  { table: "mandates", select: "id" },
  { table: "audit_events", select: "id" },
  { table: "registrations", select: "id" },
  { table: "scheduled_registrations", select: "id,status" },
  { table: "cached_provider_feed", select: "id,org_ref" },
  { table: "user_billing", select: "user_id" },
  { table: "user_subscriptions", select: "user_id,status" },
  { table: "autopilot_runs", select: "id,status" },
];

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const check of tableChecks) {
    const { error } = await admin.from(check.table).select(check.select).limit(1);
    if (error) {
      throw new Error(`Table ${check.table} not queryable: ${error.message}`);
    }
    console.log(`[ok] Supabase table queryable: ${check.table}`);
  }

  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const functions = (process.env.SUPABASE_SMOKE_FUNCTIONS || "get-user-location")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    for (const fn of functions) {
      const { error } = await anon.functions.invoke(fn, { body: {} });
      if (error) {
        console.log(`[warn] Supabase function ${fn} returned error: ${error.message}`);
      } else {
        console.log(`[ok] Supabase function invoked: ${fn}`);
      }
    }
  } else {
    console.log("[warn] SUPABASE_ANON_KEY not provided; skipping public Edge Function smoke");
  }

  console.log("[ok] Supabase smoke complete");
}

main().catch((error) => {
  console.error("[fail] Supabase smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
