#!/usr/bin/env tsx
/**
 * Worker E2E smoke: schedule a job due soon and wait for the worker to execute it.
 *
 * ⚠️ This executes a REAL provider booking and may charge the $20 success fee on success.
 *
 * Required:
 * - MCP_SERVER_URL (base URL, with or without /sse)
 * - MCP_ACCESS_TOKEN (for /tools/call in production)
 * - E2E_USER_ID (either a Supabase auth UUID OR an Auth0 subject like auth0|...)
 * - E2E_EXECUTE=1 (explicit confirmation)
 *
 * Optional (recommended, for automatic watching):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   MCP_SERVER_URL=... MCP_ACCESS_TOKEN=... E2E_USER_ID=auth0|... E2E_EXECUTE=1 \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   ./node_modules/.bin/tsx scripts/smokeWorkerExecute.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

type Json = any;

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const withoutSse = trimmed.endsWith('/sse') ? trimmed.slice(0, -4) : trimmed;
  return withoutSse.endsWith('/') ? withoutSse.slice(0, -1) : withoutSse;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v ? String(v) : undefined;
}

function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; json: Json; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: Json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function callTool(baseUrl: string, token: string, tool: string, args: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return await fetchJson(`${baseUrl}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool, args }),
  });
}

function isoInMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

function pickFirstProgram(programsByTheme: Record<string, any>): any {
  const theme = Object.keys(programsByTheme || {})[0];
  if (!theme) return null;
  const list = programsByTheme[theme];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[0];
}

function parsePriceToCentsMaybe(price: any): number | null {
  const s = String(price || '').trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function watchScheduled(supabaseUrl: string, serviceKey: string, scheduledId: string) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pollMs = Number(process.env.V1_WATCH_POLL_MS || 1000);
  const timeoutMs = Number(process.env.V1_WATCH_TIMEOUT_MS || 10 * 60 * 1000);
  const start = Date.now();

  console.log(`\n[worker-e2e] 🔎 Watching scheduled_registrations.id=${scheduledId}`);
  console.log(`[worker-e2e]    poll_ms=${pollMs} timeout_ms=${timeoutMs}`);

  let lastStatus: string | null | undefined;
  let lastBooking: string | null | undefined;
  let printedReceiptForBooking: string | null = null;

  while (Date.now() - start <= timeoutMs) {
    const { data: sr, error } = await supabase
      .from('scheduled_registrations')
      .select('id,status,scheduled_time,booking_number,executed_at,error_message')
      .eq('id', scheduledId)
      .maybeSingle();

    if (error) {
      console.log('⚠️  scheduled_registrations query error:', error.message);
      await sleep(pollMs);
      continue;
    }
    if (!sr) {
      console.log('❌ scheduled_registrations row not found (yet).');
      await sleep(pollMs);
      continue;
    }

    const row: any = sr;
    if (row.status !== lastStatus) {
      lastStatus = row.status;
      console.log(`⏱  SCH status=${row.status} scheduled_time=${row.scheduled_time} executed_at=${row.executed_at ?? '—'}`);
      if (row.error_message) console.log(`   error_message=${String(row.error_message).slice(0, 200)}`);
    }

    if (row.booking_number && row.booking_number !== lastBooking) {
      lastBooking = row.booking_number;
      console.log(`🎟  booking_number=${row.booking_number}`);
    }

    if (row.booking_number && row.booking_number !== printedReceiptForBooking) {
      const { data: regs, error: regErr } = await supabase
        .from('registrations')
        .select('id,booking_number,status,created_at')
        .eq('booking_number', row.booking_number)
        .limit(3);

      if (regErr) {
        console.log('⚠️  registrations query error:', regErr.message);
      } else if (regs && regs.length > 0) {
        const r: any = regs[0];
        printedReceiptForBooking = row.booking_number;
        console.log(`🧾 receipt=REG-${String(r.id).slice(0, 8)} status=${r.status} created_at=${r.created_at}`);
      }
    }

    if (row.status === 'completed') {
      console.log('✅ SCH completed');
      return;
    }
    if (row.status === 'failed') {
      throw new Error(`SCH failed: ${row.error_message || 'unknown error'}`);
    }
    if (row.status === 'cancelled') {
      throw new Error('SCH cancelled (unexpected for execute smoke)');
    }

    await sleep(pollMs);
  }

  throw new Error('Timed out waiting for SCH completion');
}

async function waitForCompletionViaReceipts(args: {
  baseUrl: string;
  token: string;
  userId: string;
  schCode: string;
}): Promise<{ status: 'completed'; regCode?: string } | { status: 'failed' | 'cancelled' }> {
  const pollMs = Number(process.env.WORKER_E2E_RECEIPTS_POLL_MS || 5000);
  const timeoutMs = Number(process.env.WORKER_E2E_RECEIPTS_TIMEOUT_MS || 10 * 60 * 1000);
  const start = Date.now();
  const sessionId = `worker-e2e-receipts-${Date.now()}`;

  console.log(`\n[worker-e2e] 🔎 Watching via receipts (no Supabase keys provided)`);
  console.log(`[worker-e2e]    poll_ms=${pollMs} timeout_ms=${timeoutMs}`);

  while (Date.now() - start <= timeoutMs) {
    const receipts = await callTool(args.baseUrl, args.token, 'signupassist.chat', {
      input: 'view my registrations',
      sessionId,
      userId: args.userId,
      userTimezone: 'America/Chicago',
    });
    if (receipts.status !== 200) {
      console.log(`[worker-e2e] ⚠️ view receipts non-200: ${receipts.status}`);
      await sleep(pollMs);
      continue;
    }

    const text = String(receipts.json?.content?.[0]?.text || '');
    const lines = text.split('\n').map((l) => l.trim());
    const line = lines.find((l) => l.includes(args.schCode));
    if (line) {
      if (/✅\s*completed/i.test(line)) {
        const reg = line.match(/\bREG-[0-9a-f]{8}\b/i)?.[0];
        return { status: 'completed', ...(reg ? { regCode: reg.toUpperCase() } : {}) };
      }
      if (/⚠️\s*failed/i.test(line)) return { status: 'failed' };
      if (/❌\s*cancelled/i.test(line)) return { status: 'cancelled' };
      // pending/executing: keep waiting
      console.log(`[worker-e2e] ⏳ ${line}`);
    } else {
      console.log(`[worker-e2e] ⏳ waiting for ${args.schCode} to appear in receipts…`);
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for ${args.schCode} completion via receipts`);
}

async function main() {
  const execute = String(process.env.E2E_EXECUTE || '').trim();
  if (!execute || execute === '0' || execute.toLowerCase() === 'false') {
    throw new Error('Refusing to run: this script executes a real booking. Set E2E_EXECUTE=1 to continue.');
  }

  const baseUrl = normalizeBaseUrl(requireEnv('MCP_SERVER_URL'));
  const token = requireEnv('MCP_ACCESS_TOKEN');
  const userId = requireEnv('E2E_USER_ID');
  const dueMins = Number(process.env.E2E_DUE_IN_MINUTES || 2);

  console.log(`\n[worker-e2e] Target: ${baseUrl}`);
  console.log(`[worker-e2e] Using E2E_USER_ID: ${userId}\n`);

  // 1) Program discovery (cache-backed)
  const programs = await callTool(baseUrl, token, 'bookeo.find_programs', { org_ref: 'aim-design', category: 'all' });
  assert(programs.status === 200, `bookeo.find_programs: expected 200, got ${programs.status}`);
  assert(programs.json?.success === true, `bookeo.find_programs: expected success=true, got ${JSON.stringify(programs.json)}`);
  const byTheme = programs.json?.data?.programs_by_theme || {};
  const first = pickFirstProgram(byTheme);
  assert(first?.program_ref, 'bookeo.find_programs: could not pick a program_ref');
  const programRef = String(first.program_ref);
  const programName = String(first.title || first.program_name || programRef);
  const eventId = String(first.first_available_event_id || first.productId || programRef);
  console.log(`[worker-e2e] ✅ picked program: ${programName} (${programRef})`);

  // 2) Create mandate (authorizes booking + success fee)
  const mandate = await callTool(baseUrl, token, 'mandates.create', {
    user_id: userId,
    provider: 'bookeo',
    org_ref: 'aim-design',
    scopes: ['bookeo:create_booking', 'platform:success_fee'],
    max_amount_cents: 50_000,
    valid_until: isoInMinutes(60 * 24),
  });
  assert(mandate.status === 200, `mandates.create: expected 200, got ${mandate.status}`);
  assert(mandate.json?.success === true, `mandates.create: expected success=true, got ${JSON.stringify(mandate.json)}`);
  const mandateId = mandate.json?.data?.mandate_id;
  assert(typeof mandateId === 'string' && mandateId.length > 0, 'mandates.create: missing mandate_id');
  console.log('[worker-e2e] ✅ mandates.create ok');

  // 3) Schedule due soon
  const scheduledTime = isoInMinutes(dueMins);
  const basePriceCents = parsePriceToCentsMaybe(first.price);
  const programFeeCents = basePriceCents != null ? basePriceCents : 0;

  const scheduled = await callTool(baseUrl, token, 'scheduler.schedule_signup', {
    user_id: userId,
    mandate_id: mandateId,
    org_ref: 'aim-design',
    program_ref: programRef,
    program_name: programName,
    event_id: eventId,
    scheduled_time: scheduledTime,
    delegate_data: {
      firstName: 'E2E',
      lastName: 'Worker',
      email: 'e2e-worker@example.com',
      phone: '555-000-0000',
      relationship: 'Parent',
      dateOfBirth: '1980-01-01',
    },
    participant_data: [{ firstName: 'Kid', lastName: 'Worker', dateOfBirth: '2015-01-01' }],
    program_fee_cents: programFeeCents,
    success_fee_cents: 2000,
  });
  assert(scheduled.status === 200, `scheduler.schedule_signup: expected 200, got ${scheduled.status}`);
  assert(scheduled.json?.success === true, `scheduler.schedule_signup: expected success=true, got ${JSON.stringify(scheduled.json)}`);
  const scheduledId = scheduled.json?.data?.scheduled_registration_id;
  assert(typeof scheduledId === 'string' && scheduledId.length > 0, 'scheduler.schedule_signup: missing scheduled_registration_id');
  const schCode = `SCH-${String(scheduledId).slice(0, 8)}`;
  console.log(`[worker-e2e] ✅ scheduled job created: ${schCode} (exec at ${scheduledTime})`);

  // 4) Watch status transitions (optional, but recommended)
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl && supabaseKey) {
    await watchScheduled(supabaseUrl, supabaseKey, scheduledId);
  } else {
    const result = await waitForCompletionViaReceipts({
      baseUrl,
      token,
      userId,
      schCode,
    });
    if (result.status !== 'completed') {
      throw new Error(`Scheduled job did not complete (status=${result.status})`);
    }
    if (result.regCode) {
      console.log(`[worker-e2e] 🧾 linked receipt: ${result.regCode}`);
    }
  }

  // 5) User-visible receipts/audit (text-only)
  const sessionId = `worker-e2e-${Date.now()}`;
  const receipts = await callTool(baseUrl, token, 'signupassist.chat', {
    input: 'view my registrations',
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(receipts.status === 200, `signupassist.chat(view receipts): expected 200, got ${receipts.status}`);
  console.log('[worker-e2e] ✅ view receipts responded');

  const audit = await callTool(baseUrl, token, 'signupassist.chat', {
    input: `audit ${schCode}`,
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(audit.status === 200, `signupassist.chat(audit SCH): expected 200, got ${audit.status}`);
  console.log('[worker-e2e] ✅ audit SCH responded');

  // If receipts linked a REG code, attempt audit REG as well (best-effort evidence).
  if (supabaseUrl && supabaseKey) {
    // DB watcher prints REG code when it appears, but we don't capture it here.
    // Operator can run `audit REG-xxxxxxxx` manually from receipts output.
  }

  console.log('\n[worker-e2e] ✅ Worker execute smoke complete\n');
}

main().catch((err) => {
  console.error('\n[worker-e2e] ❌ FAILED:', err?.message || err);
  process.exit(1);
});


