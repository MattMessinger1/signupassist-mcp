/**
 * API-FIRST Smoke Tests
 *
 * v1 posture:
 * - API-only providers (Bookeo). No SkiClubPro. No Browserbase. No login/scraping.
 * - Canonical conversational surface is `signupassist.chat`.
 */

import { test, expect } from '@playwright/test';
import 'dotenv/config';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://signupassist-mcp-production.up.railway.app';
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;

function isLocal(url: string) {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

// /tools/call requires auth in production; local/dev bypasses auth.
if (!MCP_ACCESS_TOKEN && !isLocal(MCP_SERVER_URL) && process.env.NODE_ENV === 'production') {
  throw new Error('MCP_ACCESS_TOKEN not configured for smoke tests (required for production)');
}

type ToolOk = Record<string, any>;

async function callMCPTool(toolName: string, args: any): Promise<ToolOk> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (MCP_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${MCP_ACCESS_TOKEN}`;

  const response = await fetch(`${MCP_SERVER_URL}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: toolName, args }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`MCP tool call failed: ${response.status} ${response.statusText} :: ${JSON.stringify(json)}`);
  }
  return json;
}

async function callMCPToolRaw(toolName: string, args: any): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (MCP_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${MCP_ACCESS_TOKEN}`;

  const response = await fetch(`${MCP_SERVER_URL}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: toolName, args }),
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/**
 * Smoke 1: Bookeo program discovery (aim-design)
 */
test('Smoke 1: Bookeo program discovery (aim-design)', async () => {
  const result = await callMCPTool('bookeo.find_programs', {
    org_ref: 'aim-design',
    category: 'all',
  });

  expect(result.success).toBe(true);
  expect(result.data?.org_ref).toBe('aim-design');
  expect(result.data?.provider).toBe('bookeo');
  expect(result.data?.programs_by_theme).toBeDefined();
  expect(typeof result.data.programs_by_theme).toBe('object');
  expect(result.data?.total_programs).toBeGreaterThan(0);
});

test('Smoke 2: Bookeo required fields discovery (first program)', async () => {
  const programs = await callMCPTool('bookeo.find_programs', {
    org_ref: 'aim-design',
    category: 'all',
  });
  expect(programs.success).toBe(true);

  const byTheme = programs.data?.programs_by_theme || {};
  const firstTheme = Object.keys(byTheme)[0];
  expect(firstTheme).toBeTruthy();

  const firstProgram = (byTheme[firstTheme] || [])[0];
  expect(firstProgram?.program_ref).toBeTruthy();

  const fields = await callMCPTool('bookeo.discover_required_fields', {
    org_ref: 'aim-design',
    program_ref: firstProgram.program_ref,
  });

  expect(fields.success).toBe(true);
  expect(fields.data?.program_questions).toBeDefined();
});

test('Smoke 3: Canonical chat tool responds with Step headers', async () => {
  const sessionId = `smoke-${Date.now()}`;

  const first = await callMCPTool('signupassist.chat', {
    input: 'Sign up for AIM Design classes',
    sessionId,
    userTimezone: 'America/Chicago',
  });

  expect(Array.isArray(first.content)).toBe(true);
  expect(first.content?.[0]?.type).toBe('text');
  expect(String(first.content?.[0]?.text || '')).toMatch(/^Step\\s+1\\/5\\s+—/);

  const second = await callMCPTool('signupassist.chat', {
    input: '1',
    sessionId,
    userTimezone: 'America/Chicago',
  });

  expect(String(second.content?.[0]?.text || '')).toMatch(/^Step\\s+[1-5]\\/5\\s+—/);
});

test('Smoke 4: Legacy scp.* tools are not registered', async () => {
  const { status, json } = await callMCPToolRaw('scp.login', { org_ref: 'blackhawk-ski-club' });
  expect(status).toBe(404);
  expect(String(json?.error || '')).toMatch(/not found/i);
});
