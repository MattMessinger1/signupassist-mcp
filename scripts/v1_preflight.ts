/**
 * V1 preflight checks (non-destructive)
 *
 * Purpose:
 * - Verify required env vars are present
 * - Verify Supabase connectivity
 * - Verify required tables exist and are queryable with the service role key
 * - Verify cached feed has data for the default v1 org (aim-design)
 *
 * Run:
 *   npm run v1:preflight
 */

import { createClient } from "@supabase/supabase-js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// A function is a reusable block of code that performs a specific task, accepts inputs (parameters), and can return an output.
// In programming, functions help organize code by encapsulating procedures that can be executed multiple times.
// In this code, the `main` function is an asynchronous function that retrieves critical environment variables needed for Supabase connectivity, preparing for further checks in a preflight routine.

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks: Array<{ name: string; ok: boolean; details?: any }> = [];

  // Basic connectivity: a lightweight select against a known table.
  {
    const { error } = await supabase.from("registrations").select("id").limit(1);
    checks.push({ name: "Supabase: registrations table queryable", ok: !error, details: error || undefined });
  }

  {
    const { error } = await supabase.from("scheduled_registrations").select("id,status").limit(1);
    checks.push({ name: "Supabase: scheduled_registrations table queryable", ok: !error, details: error || undefined });
  }

  {
    const { data, error } = await supabase
      .from("cached_provider_feed")
      .select("org_ref, program_ref")
      .eq("org_ref", "aim-design")
      .limit(1);
    const ok = !error && Array.isArray(data) && data.length > 0;
    checks.push({
      name: "Supabase: cached_provider_feed has aim-design programs",
      ok,
      details: error || { count: Array.isArray(data) ? data.length : 0, sample: data?.[0] },
    });
  }

  // Print summary
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    // eslint-disable-next-line no-console
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}`);
    if (!c.ok) {
      // eslint-disable-next-line no-console
      console.log("   details:", c.details);
    }
  }

  if (failed.length) {
    throw new Error(`Preflight failed: ${failed.length} check(s) failed`);
  }

  // eslint-disable-next-line no-console
  console.log("✅ V1 preflight passed");
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("❌ V1 preflight failed:", err?.message || err);
  // eslint-disable-next-line no-console
  process.exit(1);
});


