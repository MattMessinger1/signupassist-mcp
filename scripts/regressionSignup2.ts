#!/usr/bin/env tsx
/**
 * Regression check: ChatGPT Signup #2 flow reliability (chat-native).
 *
 * Validates:
 * - Step 3/5 always shows a review summary (no “skipped step” generic yes/cancel)
 * - Optional: Returning user with exactly 1 saved child gets the explicit “On file / Still needed”
 *   Step 2/5 prompt (no silent auto-use).
 *
 * Usage:
 *   MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app \
 *   MCP_ACCESS_TOKEN=... \
 *   ./node_modules/.bin/tsx scripts/regressionSignup2.ts
 *
 * Optional (returning-user check):
 *   REGRESSION_USER_ID=<supabase-auth-uuid> \
 *   REGRESSION_EMAIL=<email-to-use-if-missing> \
 *   ./node_modules/.bin/tsx scripts/regressionSignup2.ts
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

async function callTool(baseUrl: string, token: string | undefined, tool: string, args: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetchJson(`${baseUrl}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool, args }),
  });
}

function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(msg);
}

function extractText(toolRes: any): string {
  return String(toolRes?.json?.content?.[0]?.text || '');
}

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv('MCP_SERVER_URL'));
  const token = requireEnv('MCP_ACCESS_TOKEN');
  const userId = (process.env.REGRESSION_USER_ID || '').trim() || undefined;
  const sessionId = `reg-signup2-${Date.now()}`;
  const tz = 'America/Chicago';

  console.log(`\n[regression] Target: ${baseUrl}`);
  console.log(`[regression] Mode: ${userId ? `returning-user (userId=${userId.slice(0, 8)}…)` : 'new-user'}\n`);

  // Step 1: browse/list
  const chat1 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: 'Sign up for AIM Design classes',
    sessionId,
    userTimezone: tz,
    ...(userId ? { userId } : {}),
  });
  assert(chat1.status === 200, `signupassist.chat step1: expected 200, got ${chat1.status}`);
  const text1 = extractText(chat1);
  assert(/^(\*\*)?Step\s+1\/5\s+—/i.test(text1), `expected Step 1/5 header, got: ${text1.slice(0, 120)}`);

  // Step 1: select a program by ordinal
  const chat2 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: '1',
    sessionId,
    userTimezone: tz,
    ...(userId ? { userId } : {}),
  });
  assert(chat2.status === 200, `signupassist.chat select: expected 200, got ${chat2.status}`);
  const text2 = extractText(chat2);
  assert(/^(\*\*)?Step\s+2\/5\s+—/i.test(text2), `expected Step 2/5 header after selection, got: ${text2.slice(0, 160)}`);

  // If returning user, expect explicit “On file / Still needed” prompt (fast + transparent).
  if (userId) {
    assert(/On file:/i.test(text2), `returning-user: expected "On file" section, got: ${text2.slice(0, 220)}`);
    assert(/Still needed:/i.test(text2), `returning-user: expected "Still needed" section, got: ${text2.slice(0, 220)}`);
    assert(/Child:/i.test(text2), `returning-user: expected Child line, got: ${text2.slice(0, 220)}`);
    assert(/Parent\/guardian:/i.test(text2), `returning-user: expected Parent/guardian line, got: ${text2.slice(0, 220)}`);
  }

  // Step 2: provide required fields (new-user) OR just the missing field(s) (returning-user).
  const payload =
    userId
      ? (process.env.REGRESSION_EMAIL || 'test@example.com')
      : 'Email: test@example.com; Name: Jane Doe; DOB: 05/13/1976; Relationship: Parent; Child: Alex Doe; Child DOB: 02/17/2014';

  const chat3 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: payload,
    sessionId,
    userTimezone: tz,
    ...(userId ? { userId } : {}),
  });
  assert(chat3.status === 200, `signupassist.chat step2 payload: expected 200, got ${chat3.status}`);
  const text3 = extractText(chat3);

  // New flow: Step 3/5 is payment method confirmation (Stripe) BEFORE final review/consent.
  assert(/^(\*\*)?Step\s+3\/5\s+—/i.test(text3), `expected Step 3/5 header, got: ${text3.slice(0, 160)}`);
  assert(
    /payment method/i.test(text3) || /Secure Stripe Checkout/i.test(text3),
    `expected payment method prompt or Stripe link, got: ${text3.slice(0, 240)}`
  );

  console.log('\n[regression] ✅ Signup #2 regression checks passed\n');
}

main().catch((err) => {
  console.error('\n[regression] ❌ FAILED:', err?.message || err);
  process.exit(1);
});


