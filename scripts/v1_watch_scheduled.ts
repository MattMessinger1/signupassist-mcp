/**
 * Watch a scheduled registration (SCH) until completion/cancellation/failure.
 *
 * Prints:
 * - scheduled_registrations status transitions
 * - booking_number when available
 * - the matching registrations receipt (REG) when it appears
 *
 * Run:
 *   npm run v1:watch-scheduled -- <scheduled_registration_id>
 *
 * Requirements:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function argScheduledId(): string {
  const id = process.argv[2];
  if (!id) {
    throw new Error("Missing scheduled_registration_id.\nUsage: npm run v1:watch-scheduled -- <scheduled_registration_id>");
  }
  return String(id).trim();
}

type ScheduledRow = {
  id: string;
  user_id: string;
  org_ref: string;
  program_ref: string;
  program_name: string;
  scheduled_time: string;
  status: string | null;
  booking_number: string | null;
  executed_at: string | null;
  error_message: string | null;
  created_at?: string | null;
};

type RegistrationRow = {
  id: string;
  user_id: string;
  program_ref: string;
  program_name: string;
  booking_number: string | null;
  status: string;
  created_at: string;
};

async function main() {
  const scheduledId = argScheduledId();
  const supabaseUrl = reqEnv("SUPABASE_URL");
  const serviceKey = reqEnv("SUPABASE_SERVICE_ROLE_KEY");
  const pollMs = Number(process.env.V1_WATCH_POLL_MS || 1000);
  const timeoutMs = Number(process.env.V1_WATCH_TIMEOUT_MS || 10 * 60 * 1000);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // eslint-disable-next-line no-console
  console.log(`🔎 Watching scheduled_registrations.id=${scheduledId}`);
  // eslint-disable-next-line no-console
  console.log(`   poll_ms=${pollMs} timeout_ms=${timeoutMs}`);

  const start = Date.now();
  let lastStatus: string | null | undefined;
  let lastBooking: string | null | undefined;
  let printedReceiptForBooking: string | null = null;

  while (Date.now() - start <= timeoutMs) {
    const { data: sr, error } = await supabase
      .from("scheduled_registrations")
      .select("id,user_id,org_ref,program_ref,program_name,scheduled_time,status,booking_number,executed_at,error_message,created_at")
      .eq("id", scheduledId)
      .maybeSingle();

    if (error) {
      // eslint-disable-next-line no-console
      console.log("⚠️  scheduled_registrations query error:", error.message);
      await sleep(pollMs);
      continue;
    }
    if (!sr) {
      // eslint-disable-next-line no-console
      console.log("❌ scheduled_registrations row not found (yet).");
      await sleep(pollMs);
      continue;
    }

    const row = sr as unknown as ScheduledRow;

    if (row.status !== lastStatus) {
      lastStatus = row.status;
      // eslint-disable-next-line no-console
      console.log(
        `⏱  SCH status=${row.status} scheduled_time=${row.scheduled_time} executed_at=${row.executed_at ?? "—"}`
      );
      if (row.error_message) {
        // eslint-disable-next-line no-console
        console.log(`   error_message=${row.error_message}`);
      }
    }

    if (row.booking_number && row.booking_number !== lastBooking) {
      lastBooking = row.booking_number;
      // eslint-disable-next-line no-console
      console.log(`🎟  booking_number=${row.booking_number}`);
    }

    // Attempt to locate the matching receipt (registrations)
    if (row.booking_number && row.booking_number !== printedReceiptForBooking) {
      const { data: regs, error: regErr } = await supabase
        .from("registrations")
        .select("id,user_id,program_ref,program_name,booking_number,status,created_at")
        .eq("booking_number", row.booking_number)
        .limit(5);

      if (regErr) {
        // eslint-disable-next-line no-console
        console.log("⚠️  registrations query error:", regErr.message);
      } else if (regs && regs.length > 0) {
        const r = regs[0] as unknown as RegistrationRow;
        printedReceiptForBooking = row.booking_number;
        const regCode = `REG-${String(r.id).slice(0, 8)}`;
        // eslint-disable-next-line no-console
        console.log(`🧾 receipt=${regCode} status=${r.status} created_at=${r.created_at}`);
      }
    }

    // Exit conditions
    if (row.status === "completed") {
      // eslint-disable-next-line no-console
      console.log("✅ SCH completed");
      process.exit(0);
    }
    if (row.status === "cancelled") {
      // eslint-disable-next-line no-console
      console.log("🟡 SCH cancelled");
      process.exit(0);
    }
    if (row.status === "failed") {
      // eslint-disable-next-line no-console
      console.log("❌ SCH failed");
      process.exit(2);
    }

    await sleep(pollMs);
  }

  // eslint-disable-next-line no-console
  console.log("⏳ Timed out waiting for SCH completion");
  process.exit(3);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("❌ v1:watch-scheduled error:", err?.message || err);
  process.exit(1);
});


