#!/usr/bin/env tsx
/**
 * Regression check: ChatGPT Signup #2 flow reliability (chat-native).
 *
 * Validates:
 * - Step 3/5 is payment (Stripe) BEFORE final review/consent
 * - If a payment method is on file, Step 4/5 shows the full review summary before consent
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

function isStep(text: string, n: number): boolean {
  return new RegExp(`^(\\*\\*)?Step\\s+${n}\\/5\\s+—`, 'i').test(text.trim());
}

function buildReplyForMissing(text: string, email: string): string | null {
  const t = text.toLowerCase();
  const wantsParent = /parent\/guardian/i.test(text);
  const wantsChild = /\bchild\b/i.test(text);

  const lines: string[] = [];

  // Parent/guardian
  if (wantsParent && /\bemail\b/i.test(text)) lines.push(`Parent email: ${email}`);
  if (wantsParent && /first name/i.test(text)) lines.push(`Parent first name: Jane`);
  if (wantsParent && /last name/i.test(text)) lines.push(`Parent last name: Doe`);
  if (wantsParent && /(date of birth|dob|birth)/i.test(text)) lines.push(`Parent DOB: 05/13/1976`);
  if (wantsParent && /relationship/i.test(text)) lines.push(`Relationship: Parent`);

  // Child
  if (wantsChild && /first name/i.test(text)) lines.push(`Child first name: Alex`);
  if (wantsChild && /last name/i.test(text)) lines.push(`Child last name: Doe`);
  if (wantsChild && /(date of birth|dob|birth)/i.test(text)) lines.push(`Child DOB: 02/17/2014`);

  // If the prompt is a generic “reply with missing fields” but doesn't show labels, fallback to full payload.
  if (lines.length === 0) {
    if (t.includes('still needed') || t.includes('reply in one message') || t.includes('please reply')) {
      return `Email: ${email}; Name: Jane Doe; DOB: 05/13/1976; Relationship: Parent; Child: Alex Doe; Child DOB: 02/17/2014`;
    }
    return null;
  }

  return lines.join('; ');
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
    if (/On file:/i.test(text2)) {
      assert(/Still needed:/i.test(text2), `returning-user: expected "Still needed" section, got: ${text2.slice(0, 220)}`);
      assert(/Child:/i.test(text2), `returning-user: expected Child line, got: ${text2.slice(0, 220)}`);
      assert(/Parent\/guardian:/i.test(text2), `returning-user: expected Parent/guardian line, got: ${text2.slice(0, 220)}`);
    } else {
      // If the only saved child was bogus (historical bug), the server filters it out and falls back to normal prompts.
      console.log('[regression] (note) returning-user: no "On file" section (no valid saved child/profile found)');
    }
  }

  // Step 2: provide required fields (new-user) OR just the missing field(s) (returning-user).
  const fullPayload =
    process.env.REGRESSION_FULL_PAYLOAD ||
    'Email: test@example.com; Name: Jane Doe; DOB: 05/13/1976; Relationship: Parent; Child: Alex Doe; Child DOB: 02/17/2014';

  const returningEmail = (process.env.REGRESSION_EMAIL || 'test@example.com').trim();
  const stillNeededLine = (text2.match(/Still needed:[\s\S]*$/i)?.[0] || '').toLowerCase();
  const hasStillNeeded = /still needed:/i.test(text2);
  const saysNothingElse = /still needed:\s*nothing/i.test(stillNeededLine);
  const needsEmail = hasStillNeeded && /email/i.test(stillNeededLine);

  const payload = userId ? (saysNothingElse ? 'ok' : needsEmail ? returningEmail : fullPayload) : fullPayload;

  const chat3 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: payload,
    sessionId,
    userTimezone: tz,
    ...(userId ? { userId } : {}),
  });
  assert(chat3.status === 200, `signupassist.chat step2 payload: expected 200, got ${chat3.status}`);
  let text3 = extractText(chat3);

  // Step 2 can take multiple turns (schema-driven micro-questions). Keep answering until Step 3/5.
  if (isStep(text3, 2)) {
    for (let i = 0; i < 4; i++) {
      const reply = buildReplyForMissing(text3, returningEmail) || fullPayload;
      const next = await callTool(baseUrl, token, 'signupassist.chat', {
        input: reply,
        sessionId,
        userTimezone: tz,
        ...(userId ? { userId } : {}),
      });
      assert(next.status === 200, `signupassist.chat step2 follow-up: expected 200, got ${next.status}`);
      text3 = extractText(next);
      if (isStep(text3, 3)) break;
      if (!isStep(text3, 2)) break;
    }
  }

  // New flow: Step 3/5 is payment method confirmation (Stripe) BEFORE final review/consent.
  assert(isStep(text3, 3), `expected Step 3/5 header, got: ${text3.slice(0, 160)}`);
  assert(
    /payment method/i.test(text3) || /Secure Stripe Checkout/i.test(text3),
    `expected payment method prompt or Stripe link, got: ${text3.slice(0, 240)}`
  );

  // If payment method exists, user can say "yes" to proceed to Step 4/5 Review & consent.
  const hasStripeLink = /Secure Stripe Checkout/i.test(text3) || /\bhttps?:\/\/\S+/i.test(text3);
  if (!hasStripeLink) {
    const chat4 = await callTool(baseUrl, token, 'signupassist.chat', {
      input: 'yes',
      sessionId,
      userTimezone: tz,
      ...(userId ? { userId } : {}),
    });
    assert(chat4.status === 200, `signupassist.chat step3 confirm payment: expected 200, got ${chat4.status}`);
    const text4 = extractText(chat4);
    assert(/^(\*\*)?Step\s+4\/5\s+—/i.test(text4), `expected Step 4/5 header, got: ${text4.slice(0, 160)}`);
    assert(/Please review the details below/i.test(text4), `expected full review summary, got: ${text4.slice(0, 240)}`);
  } else {
    console.log('[regression] (note) payment method not on file; Step 4/5 review check skipped (Stripe setup required)');
  }

  console.log('\n[regression] ✅ Signup #2 regression checks passed\n');
}

main().catch((err) => {
  console.error('\n[regression] ❌ FAILED:', err?.message || err);
  process.exit(1);
});


