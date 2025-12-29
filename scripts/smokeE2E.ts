#!/usr/bin/env tsx
/**
 * E2E-ish smoke checks for V1 flows (API-first).
 *
 * Designed to be safe-by-default:
 * - Creates a scheduled registration *far enough in the future* and cancels it immediately.
 * - Does NOT execute a real provider booking or charge success fees.
 *
 * Requires:
 * - MCP_SERVER_URL (base URL, with or without /sse)
 * - MCP_ACCESS_TOKEN (for /tools/call in production)
 * - E2E_USER_ID (user identifier used in Supabase rows; must match your prod schema)
 *
 * Usage:
 *   MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app \
 *   MCP_ACCESS_TOKEN=... \
 *   E2E_USER_ID=auth0|... \
 *   ./node_modules/.bin/tsx scripts/smokeE2E.ts
 */
import 'dotenv/config';

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

function pickFirstProgram(programsByTheme: Record<string, any>): any {
  const theme = Object.keys(programsByTheme || {})[0];
  if (!theme) return null;
  const list = programsByTheme[theme];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[0];
}

function isoInMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv('MCP_SERVER_URL'));
  const token = requireEnv('MCP_ACCESS_TOKEN');
  const userId = requireEnv('E2E_USER_ID');

  console.log(`\n[e2e] Target: ${baseUrl}`);
  console.log(`[e2e] Using E2E_USER_ID: ${userId}\n`);

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
  console.log(`[e2e] ✅ picked program: ${programName} (${programRef})`);

  // 2) Create mandate (safe: authorizes future scheduling; no execution here)
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
  console.log('[e2e] ✅ mandates.create ok');

  // 3) Schedule a job far enough out that we can cancel it before worker claims it
  const scheduledTime = isoInMinutes(30);
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
      lastName: 'Test',
      email: 'e2e-test@example.com',
      phone: '555-000-0000',
      relationship: 'Parent',
      dateOfBirth: '1980-01-01',
    },
    participant_data: [
      { firstName: 'Kid', lastName: 'Test', dateOfBirth: '2015-01-01' },
    ],
    program_fee_cents: 0,
    success_fee_cents: 2000,
  });
  assert(scheduled.status === 200, `scheduler.schedule_signup: expected 200, got ${scheduled.status}`);
  assert(scheduled.json?.success === true, `scheduler.schedule_signup: expected success=true, got ${JSON.stringify(scheduled.json)}`);
  const scheduledId = scheduled.json?.data?.scheduled_registration_id;
  assert(typeof scheduledId === 'string' && scheduledId.length > 0, 'scheduler.schedule_signup: missing scheduled_registration_id');
  const schCode = `SCH-${String(scheduledId).slice(0, 8)}`;
  console.log(`[e2e] ✅ scheduled job created: ${schCode} (exec at ${scheduledTime})`);

  // 4) View receipts via canonical chat (ensures text-only UX + receipts query)
  const sessionId = `e2e-${Date.now()}`;
  const receipts = await callTool(baseUrl, token, 'signupassist.chat', {
    input: 'view my registrations',
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(receipts.status === 200, `signupassist.chat(view receipts): expected 200, got ${receipts.status}`);
  const receiptsText = String(receipts.json?.content?.[0]?.text || '');
  assert(/registrations/i.test(receiptsText), 'view receipts: expected registrations text');
  console.log('[e2e] ✅ view receipts ok');

  // 5) Cancel scheduled job via text-only confirmation
  const cancel1 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: `cancel ${schCode}`,
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(cancel1.status === 200, `cancel step1: expected 200, got ${cancel1.status}`);
  const cancel1Text = String(cancel1.json?.content?.[0]?.text || '');
  assert(/reply\s+\*\*yes\*\*/i.test(cancel1Text), `cancel step1: expected yes/no confirmation prompt, got: ${cancel1Text.slice(0, 120)}`);

  const cancel2 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: 'yes',
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(cancel2.status === 200, `cancel step2: expected 200, got ${cancel2.status}`);
  const cancel2Text = String(cancel2.json?.content?.[0]?.text || '');
  assert(/cancel/i.test(cancel2Text), `cancel step2: expected cancellation success text, got: ${cancel2Text.slice(0, 120)}`);
  console.log('[e2e] ✅ cancel SCH flow ok');

  // 6) Audit trail should be accessible (may return “not found” if audit not configured for scheduled rows; still useful signal)
  const audit = await callTool(baseUrl, token, 'signupassist.chat', {
    input: `audit ${schCode}`,
    sessionId,
    userId,
    userTimezone: 'America/Chicago',
  });
  assert(audit.status === 200, `audit: expected 200, got ${audit.status}`);
  const auditText = String(audit.json?.content?.[0]?.text || '');
  assert(auditText.length > 0, 'audit: expected non-empty text');
  console.log('[e2e] ✅ audit flow responded');

  console.log('\n[e2e] ✅ E2E smoke complete (schedule + cancel + receipts/audit)\n');
}

main().catch((err) => {
  console.error('\n[e2e] ❌ FAILED:', err?.message || err);
  process.exit(1);
});


