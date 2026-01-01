/**
 * Always-on scheduled registration worker (V1 API-only)
 *
 * Requirements:
 * - Executes scheduled registrations at (or extremely close to) scheduled_time (second-level)
 * - Provider is merchant-of-record (Bookeo/provider charges program fee per their checkout)
 * - SignupAssist charges $20 success fee via Stripe only upon successful booking
 *
 * This worker polls `scheduled_registrations` and:
 * 1) claims the next due job (status pending -> executing)
 * 2) calls Bookeo booking API (bookeo.confirm_booking)
 * 3) charges success fee (stripe.charge_success_fee)
 * 4) writes receipt row (registrations.create)
 * 5) marks scheduled job completed/failed
 *
 * Run:
 *   npm run worker:scheduled
 */

import { createClient } from "@supabase/supabase-js";
import { bookeoTools } from "../providers/bookeo.js";
import { stripeTools } from "../providers/stripe.js";
import { registrationTools } from "../providers/registrations.js";
import { createServer } from "node:http";

type ScheduledRow = {
  id: string;
  user_id: string;
  mandate_id: string;
  org_ref: string;
  program_ref: string;
  program_name: string;
  scheduled_time: string;
  event_id: string;
  delegate_data: any;
  participant_data: any;
  status: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("[worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Railway (and other platforms) may apply an HTTP healthcheck by default.
 * The scheduled worker is primarily background work, but we optionally expose
 * a minimal `/health` endpoint on `PORT` when present so the process can be
 * monitored without running the full MCP web server.
 */
function startOptionalHealthServer() {
  const portStr = process.env.PORT;
  if (!portStr) return;
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return;

  const server = createServer((req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const path = (req.url || "/").split("?")[0] || "/";

    if ((method === "GET" || method === "HEAD") && path === "/health") {
      const body = JSON.stringify({ ok: true, role: "worker", ts: Date.now() });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      if (method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not_found");
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[worker] Health server listening on port ${port}`);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
  return Date.now();
}

function getToolHandler(tools: Array<{ name: string; handler: (args: any) => Promise<any> }>, name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler;
}

const bookeoConfirmBooking = getToolHandler(bookeoTools as any, "bookeo.confirm_booking");
const stripeChargeSuccessFee = getToolHandler(stripeTools as any, "stripe.charge_success_fee");
const registrationsCreate = getToolHandler(registrationTools as any, "registrations.create");

async function fetchNextPending(): Promise<ScheduledRow | null> {
  const { data, error } = await supabase
    .from("scheduled_registrations")
    .select("*")
    .eq("status", "pending")
    .order("scheduled_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[worker] fetchNextPending error:", error);
    return null;
  }
  return (data as any) || null;
}

async function claimJob(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("scheduled_registrations")
    .update({ status: "executing" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[worker] claimJob error:", error);
    return false;
  }
  return !!data?.id;
}

async function markFailed(id: string, message: string) {
  await supabase
    .from("scheduled_registrations")
    .update({
      status: "failed",
      error_message: message,
      executed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function markCompleted(id: string, booking_number: string) {
  await supabase
    .from("scheduled_registrations")
    .update({
      status: "completed",
      booking_number,
      executed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", id);
}

function normalizeParticipants(participant_data: any): Array<{ firstName: string; lastName: string; dob?: string; grade?: string }> {
  const arr = Array.isArray(participant_data) ? participant_data : [];
  return arr.map((p) => ({
    firstName: p.firstName || p.first_name || "",
    lastName: p.lastName || p.last_name || "",
    dob: p.dob || p.dateOfBirth || p.date_of_birth,
    grade: p.grade,
  }));
}

function normalizeDelegate(delegate_data: any): {
  delegate_firstName?: string;
  delegate_lastName?: string;
  delegate_email?: string;
  delegate_phone?: string;
  delegate_dob?: string;
  delegate_relationship?: string;
  _pricing?: { program_fee_cents?: number; success_fee_cents?: number };
} {
  return {
    delegate_firstName: delegate_data?.delegate_firstName || delegate_data?.firstName || delegate_data?.delegate_first_name,
    delegate_lastName: delegate_data?.delegate_lastName || delegate_data?.lastName || delegate_data?.delegate_last_name,
    delegate_email: delegate_data?.delegate_email || delegate_data?.email,
    delegate_phone: delegate_data?.delegate_phone || delegate_data?.phone,
    delegate_dob: delegate_data?.delegate_dob || delegate_data?.dateOfBirth,
    delegate_relationship: delegate_data?.delegate_relationship || delegate_data?.relationship,
    _pricing: delegate_data?._pricing,
  };
}

async function attemptBookingWithRetries(row: ScheduledRow) {
  const maxMs = Number(process.env.SCHEDULED_WORKER_MAX_ATTEMPT_MS || 120_000); // 2 minutes
  const start = nowMs();
  let attempt = 0;
  let lastErr: any = null;

  const delegate = normalizeDelegate(row.delegate_data);
  const participants = normalizeParticipants(row.participant_data);
  const numParticipants = Math.max(1, participants.length);

  // Map to Bookeo API schema expected by bookeo.confirm_booking tool
  const mappedDelegateData = {
    firstName: delegate.delegate_firstName,
    lastName: delegate.delegate_lastName,
    email: delegate.delegate_email,
    phone: delegate.delegate_phone,
    dateOfBirth: delegate.delegate_dob,
    relationship: delegate.delegate_relationship,
  };

  const mappedParticipantData = participants.map((p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dob,
    grade: p.grade,
  }));

  while (nowMs() - start <= maxMs) {
    attempt++;
    try {
      const resp = await bookeoConfirmBooking({
        _audit: { user_id: row.user_id, mandate_id: row.mandate_id, plan_execution_id: null },
        event_id: row.event_id,
        program_ref: row.program_ref,
        org_ref: row.org_ref,
        delegate_data: mappedDelegateData,
        participant_data: mappedParticipantData,
        num_participants: numParticipants,
      });

      if (resp?.success && resp?.data?.booking_number) {
        return resp;
      }

      // Fail-fast for permanent errors (don't burn the whole retry window).
      const errObj = (resp as any)?.error;
      const code = errObj?.code as string | undefined;
      if (code && ["INVALID_EVENT_ID", "VALIDATION_ERROR", "PROGRAM_NOT_FOUND", "BOOKEO_SOLD_OUT"].includes(code)) {
        throw new Error(errObj?.display || errObj?.message || JSON.stringify(errObj));
      }

      lastErr = errObj || resp;
    } catch (e) {
      lastErr = e;
    }

    // Aggressive early retries for "open at the second"
    // Backoff: 250ms * attempt up to 2s
    const backoff = Math.min(2000, 250 * attempt);
    await sleep(backoff);
  }

  throw new Error(
    typeof lastErr === "string"
      ? lastErr
      : lastErr?.display || lastErr?.message || JSON.stringify(lastErr)
  );
}

async function computeProgramFeeCentsFallback(row: ScheduledRow, participantCount: number): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("cached_provider_feed")
      .select("program")
      .eq("org_ref", row.org_ref)
      .eq("program_ref", row.program_ref)
      .maybeSingle();
    if (error || !data?.program) return 0;
    const prog = data.program as any;
    const priceStr = prog?.price;
    if (!priceStr || typeof priceStr !== "string") return 0;
    const base = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(base) || base <= 0) return 0;
    return Math.round(base * participantCount * 100);
  } catch {
    return 0;
  }
}

async function executeJob(row: ScheduledRow) {
  console.log(`[worker] Executing scheduled_registrations=${row.id} program=${row.program_ref} at=${row.scheduled_time}`);

  const participants = normalizeParticipants(row.participant_data);
  const delegate = normalizeDelegate(row.delegate_data);

  // 1) Book with provider (Bookeo)
  const bookingResp = await attemptBookingWithRetries(row);
  const bookingNumber = bookingResp.data.booking_number as string;
  const startTime = bookingResp.data.start_time as string | undefined;

  // 2) Charge $20 success fee (SignupAssist MoR for fee only)
  let chargeId: string | undefined;
  try {
    const feeResp = await stripeChargeSuccessFee({
      _audit: { user_id: row.user_id, mandate_id: row.mandate_id, plan_execution_id: null },
      booking_number: bookingNumber,
      mandate_id: row.mandate_id,
      amount_cents: 2000,
      user_id: row.user_id,
    });
    if (feeResp?.success) {
      chargeId = feeResp?.data?.charge_id;
    } else {
      console.warn("[worker] Success fee charge failed (non-fatal):", feeResp?.error || feeResp);
    }
  } catch (e) {
    console.warn("[worker] Success fee charge exception (non-fatal):", e);
  }

  // 3) Write receipt row (registrations)
  const participantNames = participants
    .map((p) => `${p.firstName || ""} ${p.lastName || ""}`.trim())
    .filter(Boolean);

  const delegateName = `${delegate.delegate_firstName || ""} ${delegate.delegate_lastName || ""}`.trim() || "Parent/Guardian";

  const programFeeCents =
    delegate._pricing?.program_fee_cents ??
    (await computeProgramFeeCentsFallback(row, Math.max(1, participants.length)));

  // Prefer provider checkout URL and payment state from Bookeo response when available.
  // IMPORTANT: Do not fabricate Bookeo deep links (bookeo.com/book/...) — they 404.
  const providerCheckoutUrl =
    (bookingResp?.data?.provider_checkout_url as string | undefined) || null;

  const providerPaymentStatus =
    (bookingResp?.data?.provider_payment_status as string | undefined) ||
    (programFeeCents > 0 ? "unpaid" : "unknown");
  const providerAmountDueCents =
    (bookingResp?.data?.provider_amount_due_cents as number | undefined | null) ??
    (programFeeCents > 0 ? programFeeCents : null);
  const providerAmountPaidCents =
    (bookingResp?.data?.provider_amount_paid_cents as number | undefined | null) ?? null;
  const providerCurrency =
    (bookingResp?.data?.provider_currency as string | undefined | null) ?? "USD";

  try {
    const receiptResp = await registrationsCreate({
      _audit: { user_id: row.user_id, mandate_id: row.mandate_id, plan_execution_id: null },
      user_id: row.user_id,
      mandate_id: row.mandate_id,
      charge_id: chargeId,
      program_name: row.program_name,
      program_ref: row.program_ref,
      provider: "bookeo",
      org_ref: row.org_ref,
      start_date: startTime || null,
      booking_number: bookingNumber,
      amount_cents: programFeeCents,
      success_fee_cents: 2000,
      delegate_name: delegateName,
      delegate_email: delegate.delegate_email || null, // may be null for VGS posture
      participant_names: participantNames,
      provider_checkout_url: providerCheckoutUrl,
      provider_payment_status: providerPaymentStatus,
      provider_amount_due_cents: providerAmountDueCents,
      provider_amount_paid_cents: providerAmountPaidCents,
      provider_currency: providerCurrency,
      provider_payment_last_checked_at: new Date().toISOString()
    });
    if (!receiptResp?.success) {
      console.warn("[worker] registrations.create failed (non-fatal):", receiptResp?.error || receiptResp);
    }
  } catch (e) {
    console.warn("[worker] registrations.create exception (non-fatal):", e);
  }

  // 4) Mark scheduled row completed
  await markCompleted(row.id, bookingNumber);

  console.log(`[worker] ✅ Completed scheduled job ${row.id} booking=${bookingNumber}`);
}

async function tick() {
  const next = await fetchNextPending();
  if (!next) {
    await sleep(1000);
    return;
  }

  const scheduledAtMs = new Date(next.scheduled_time).getTime();
  const delta = scheduledAtMs - nowMs();

  // If far away, poll frequently so we can pick up newly created earlier jobs
  if (delta > 30_000) {
    await sleep(1000);
    return;
  }

  // Sleep until scheduled_time (second-level precision)
  if (delta > 0) {
    await sleep(delta);
  }

  const claimed = await claimJob(next.id);
  if (!claimed) {
    // Someone else took it or it was cancelled
    return;
  }

  try {
    await executeJob(next);
  } catch (e: any) {
    console.error("[worker] ❌ Job failed:", e?.message || e);
    await markFailed(next.id, e?.message || String(e));
  }
}

async function main() {
  startOptionalHealthServer();
  console.log("[worker] ScheduledRegistrationWorker started");
  console.log("[worker] NODE_ENV:", process.env.NODE_ENV);
  console.log("[worker] Precision mode: always-on (poll + sleep to scheduled_time)");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] tick() crashed:", e);
      await sleep(1000);
    }
  }
}

void main();


