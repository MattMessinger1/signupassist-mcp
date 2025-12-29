#!/usr/bin/env tsx
/**
 * MCP SSE + OAuth surface smoke (API-first).
 *
 * Validates:
 * - `/.well-known/oauth-authorization-server` exists and points to our proxied endpoints
 * - `/sse` returns 401 (prod) when no auth, and connects when Authorization is provided
 * - Can ListTools + call `signupassist.chat` over MCP SSE transport
 *
 * Usage:
 *   MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app \
 *   MCP_ACCESS_TOKEN=... \
 *   ./node_modules/.bin/tsx scripts/smokeMcpSse.ts
 *
 * Notes:
 * - This uses the MCP SDK client `SSEClientTransport` (not Playwright).
 * - In production, `/sse` is now auth-gated; without a token, expect 401 + WWW-Authenticate.
 */
import 'dotenv/config';

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

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

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv("MCP_SERVER_URL"));
  const token = process.env.MCP_ACCESS_TOKEN;

  console.log(`\n[smoke-sse] Target: ${baseUrl}`);
  console.log(`[smoke-sse] Auth: ${token ? "MCP_ACCESS_TOKEN set" : "none"}\n`);

  // 1) OAuth discovery doc exists
  {
    const { status, json } = await fetchJson(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert(status === 200, `oauth metadata: expected 200, got ${status}`);
    assert(typeof json?.authorization_endpoint === "string", "oauth metadata: missing authorization_endpoint");
    assert(typeof json?.token_endpoint === "string", "oauth metadata: missing token_endpoint");
    assert(String(json.authorization_endpoint).includes("/oauth/authorize"), "oauth metadata: authorization_endpoint should include /oauth/authorize");
    assert(String(json.token_endpoint).includes("/oauth/token"), "oauth metadata: token_endpoint should include /oauth/token");
    console.log("[smoke-sse] ✅ oauth metadata ok");
  }

  // 2) /sse returns 401 without auth in production (or 200 in dev)
  {
    const res = await fetch(`${baseUrl}/sse`, { method: "GET" });
    const status = res.status;
    const www = res.headers.get("www-authenticate");
    if (status === 401) {
      assert(!!www, "/sse unauthorized: expected WWW-Authenticate header");
      console.log("[smoke-sse] ✅ /sse correctly requires auth (401)");
    } else {
      // In dev/local this may be 200 and keep open; accept as informational.
      console.log(`[smoke-sse] ℹ️ /sse returned ${status} without auth (likely non-prod)`);
    }
  }

  // 3) If we have a token, connect over SSE and call signupassist.chat
  if (token) {
    const sseUrl = new URL(`${baseUrl}/sse`);
    const transport = new SSEClientTransport(sseUrl, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const client = new Client({ name: "signupassist-smoke-sse", version: "1.0.0" });
    await client.connect(transport);
    console.log("[smoke-sse] ✅ MCP SSE connected");

    const tools = await client.listTools();
    const toolNames = (tools?.tools || []).map((t: any) => t.name);
    assert(toolNames.includes("signupassist.chat"), `listTools: expected signupassist.chat, got: ${toolNames.join(", ")}`);
    console.log("[smoke-sse] ✅ listTools ok");

    const result = await client.callTool({
      name: "signupassist.chat",
      arguments: {
        input: "Sign up for AIM Design classes",
        sessionId: `smoke-sse-${Date.now()}`,
        userTimezone: "America/Chicago",
      },
    });

    const text = String((result as any)?.content?.[0]?.text || "");
    assert(text.length > 0, "signupassist.chat: expected non-empty text");
    assert(/^(\*\*)?Step\s+[1-5]\/5\s+—/i.test(text), `signupassist.chat: expected Step header, got: ${text.slice(0, 80)}`);
    console.log("[smoke-sse] ✅ signupassist.chat ok");

    await client.close();
    console.log("[smoke-sse] ✅ closed\n");
  } else {
    console.log("[smoke-sse] Skipping MCP SSE connect (no MCP_ACCESS_TOKEN provided)\n");
  }
}

main().catch((err) => {
  console.error("\n[smoke-sse] ❌ FAILED:", err?.message || err);
  process.exit(1);
});


