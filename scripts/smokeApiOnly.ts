#!/usr/bin/env tsx
/**
 * API-only smoke test (no Playwright, no Browserbase, no scraping).
 *
 * Validates:
 * - Well-known ChatGPT apps manifest is reachable
 * - Bookeo cache-backed tools work (find_programs, discover_required_fields)
 * - Canonical conversational tool `signupassist.chat` responds with Step headers
 * - Legacy `scp.*` tools are not present
 *
 * Usage:
 *   MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app \
 *   MCP_ACCESS_TOKEN=... \
 *   ./node_modules/.bin/tsx scripts/smokeApiOnly.ts
 */
import 'dotenv/config';

type Json = any;

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  // Accept both ".../sse" and base URLs.
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

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv('MCP_SERVER_URL') || 'https://signupassist-mcp-production.up.railway.app');
  const token = process.env.MCP_ACCESS_TOKEN;

  console.log(`\n[smoke] Target: ${baseUrl}`);
  console.log(`[smoke] Auth: ${token ? 'MCP_ACCESS_TOKEN set' : 'none (dev/local only)'}\n`);

  // 0) Manifest reachable (no auth)
  {
    const { status, json } = await fetchJson(`${baseUrl}/.well-known/chatgpt-apps-manifest.json`);
    assert(status === 200, `manifest: expected 200, got ${status}`);
    assert(json?.api?.type === 'mcp', `manifest: expected api.type=mcp, got ${json?.api?.type}`);
    assert(String(json?.api?.server_url || '').includes('/sse'), `manifest: expected api.server_url to include /sse`);
    console.log('[smoke] ✅ manifest ok');
  }

  // 1) Bookeo find_programs
  const programs = await callTool(baseUrl, token, 'bookeo.find_programs', { org_ref: 'aim-design', category: 'all' });
  assert(programs.status === 200, `bookeo.find_programs: expected 200, got ${programs.status}`);
  assert(programs.json?.success === true, `bookeo.find_programs: expected success=true, got ${JSON.stringify(programs.json)}`);
  const byTheme = programs.json?.data?.programs_by_theme || {};
  const total = programs.json?.data?.total_programs ?? 0;
  assert(typeof byTheme === 'object', 'bookeo.find_programs: programs_by_theme missing/invalid');
  assert(total > 0, `bookeo.find_programs: expected total_programs > 0, got ${total}`);
  console.log('[smoke] ✅ bookeo.find_programs ok');

  // 2) Bookeo discover_required_fields (first program)
  const firstTheme = Object.keys(byTheme)[0];
  assert(firstTheme, 'bookeo.find_programs: no themes returned');
  const firstProgram = (byTheme[firstTheme] || [])[0];
  const programRef = firstProgram?.program_ref;
  assert(programRef, 'bookeo.find_programs: no program_ref found');

  const fields = await callTool(baseUrl, token, 'bookeo.discover_required_fields', { org_ref: 'aim-design', program_ref: programRef });
  assert(fields.status === 200, `bookeo.discover_required_fields: expected 200, got ${fields.status}`);
  assert(fields.json?.success === true, `bookeo.discover_required_fields: expected success=true, got ${JSON.stringify(fields.json)}`);
  assert(fields.json?.data?.program_questions, 'bookeo.discover_required_fields: missing program_questions');
  console.log('[smoke] ✅ bookeo.discover_required_fields ok');

  // 3) Canonical chat tool responds with Step headers
  const sessionId = `smoke-${Date.now()}`;
  const chat1 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: 'Sign up for AIM Design classes',
    sessionId,
    userTimezone: 'America/Chicago',
  });
  assert(chat1.status === 200, `signupassist.chat: expected 200, got ${chat1.status}`);
  const text1 = String(chat1.json?.content?.[0]?.text || '');
  assert(/^(\*\*)?Step\s+1\/5\s+—/i.test(text1), `signupassist.chat: expected Step 1/5 header, got: ${text1.slice(0, 80)}`);
  console.log('[smoke] ✅ signupassist.chat (step 1) ok');

  // Try numeric selection; allow any Step header 1..5 (selection may be rejected if list not present).
  const chat2 = await callTool(baseUrl, token, 'signupassist.chat', {
    input: '1',
    sessionId,
    userTimezone: 'America/Chicago',
  });
  assert(chat2.status === 200, `signupassist.chat (2): expected 200, got ${chat2.status}`);
  const text2 = String(chat2.json?.content?.[0]?.text || '');
  assert(/^(\*\*)?Step\s+[1-5]\/5\s+—/i.test(text2), `signupassist.chat (2): expected Step header, got: ${text2.slice(0, 80)}`);
  console.log('[smoke] ✅ signupassist.chat (follow-up) ok');

  // 4) Legacy scp.* tools should not exist
  const scp = await callTool(baseUrl, token, 'scp.login', { org_ref: 'blackhawk-ski-club' });
  assert(scp.status === 404, `scp.login: expected 404 (tool removed), got ${scp.status}`);
  console.log('[smoke] ✅ scp.* tools absent');

  console.log('\n[smoke] ✅ ALL API-ONLY SMOKE TESTS PASSED\n');
}

main().catch((err) => {
  console.error('\n[smoke] ❌ FAILED:', err?.message || err);
  process.exit(1);
});


