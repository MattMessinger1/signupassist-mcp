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
  const expectUnauthReadonly =
    String(process.env.MCP_ALLOW_UNAUTH_READONLY_TOOLS || "").trim().toLowerCase() === "true";

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

  // 2b) Unauthenticated read-only tool call (signupassist.start) when enabled.
  // This should NOT require OAuth; it helps the ChatGPT router prefer the app over Web Search.
  {
    const rpcId = `smoke-unauth-start-${Date.now()}`;
    const { status, json, text } = await fetchJson(`${baseUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: {
          name: "signupassist.start",
          arguments: { org_ref: "aim-design", category: "all" },
        },
      }),
    });

    if (expectUnauthReadonly) {
      assert(status === 200, `unauth signupassist.start: expected 200, got ${status} :: ${text.slice(0, 200)}`);
      assert(json?.jsonrpc === "2.0", "unauth signupassist.start: missing jsonrpc=2.0");
      assert(String(json?.id) === rpcId, "unauth signupassist.start: id mismatch");
      assert(Array.isArray(json?.result?.content), "unauth signupassist.start: result.content must be an array");
      assert((json?.result?.content || []).length > 0, "unauth signupassist.start: result.content must be non-empty");
      console.log("[smoke-sse] ✅ unauth signupassist.start ok");
    } else {
      // If not enabled, this may 401; treat as informational.
      if (status === 401) {
        console.log("[smoke-sse] ℹ️ unauth signupassist.start is not enabled (401)");
      } else {
        console.log(`[smoke-sse] ℹ️ unauth signupassist.start returned ${status} (flag not enabled?)`);
      }
    }
  }

  // 2c) Ensure unauthenticated signupassist.chat is still OAuth-gated (in prod).
  {
    const rpcId = `smoke-unauth-chat-${Date.now()}`;
    const res = await fetch(`${baseUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: {
          name: "signupassist.chat",
          arguments: { input: "hello", sessionId: `smoke-unauth-${Date.now()}` },
        },
      }),
    });
    if (res.status === 401) {
      const www = res.headers.get("www-authenticate");
      assert(!!www, "unauth signupassist.chat: expected WWW-Authenticate header");
      console.log("[smoke-sse] ✅ unauth signupassist.chat remains OAuth-gated (401)");
    } else {
      console.log(`[smoke-sse] ℹ️ unauth signupassist.chat returned ${res.status} (non-prod or auth posture changed)`);
    }
  }

  // 3) If we have a token, verify the "JSON tools/call over POST /sse" compatibility path
  // This is a critical ChatGPT edge case (prevents 424 "missing required content").
  if (token) {
    const rpcId = `smoke-sse-tools-call-${Date.now()}`;
    const sessionId = `smoke-sse-dedupe-${Date.now()}`;
    const { status, json, text } = await fetchJson(`${baseUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: {
          name: "signupassist.chat",
          arguments: {
            input: "hello",
            sessionId,
            userTimezone: "America/Chicago",
          },
        },
      }),
    });

    assert(status === 200, `POST /sse tools/call: expected 200, got ${status} :: ${text.slice(0, 200)}`);
    assert(json?.jsonrpc === "2.0", "POST /sse tools/call: missing jsonrpc=2.0");
    assert(String(json?.id) === rpcId, `POST /sse tools/call: id mismatch (expected ${rpcId}, got ${String(json?.id)})`);
    assert(Array.isArray(json?.result?.content), "POST /sse tools/call: result.content must be an array");
    assert((json?.result?.content || []).length > 0, "POST /sse tools/call: result.content must be non-empty");
    assert(typeof json?.result?.content?.[0]?.text === "string", "POST /sse tools/call: content[0].text must be a string");
    const firstLine = String(json?.result?.content?.[0]?.text || "").split("\n")[0] || "";
    assert(!/\bcontinued\b/i.test(firstLine), `POST /sse tools/call: first reply should not be 'continued' (got: ${firstLine})`);
    console.log("[smoke-sse] ✅ POST /sse tools/call returns result.content");

    // Retry dedupe: repeating the exact same tool call should NOT advance wizardProgress to "continued".
    const rpcId2 = `smoke-sse-tools-call-${Date.now()}-retry`;
    const { status: status2, json: json2, text: text2 } = await fetchJson(`${baseUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId2,
        method: "tools/call",
        params: {
          name: "signupassist.chat",
          arguments: {
            input: "hello",
            sessionId,
            userTimezone: "America/Chicago",
          },
        },
      }),
    });

    assert(status2 === 200, `POST /sse tools/call retry: expected 200, got ${status2} :: ${text2.slice(0, 200)}`);
    assert(json2?.jsonrpc === "2.0", "POST /sse tools/call retry: missing jsonrpc=2.0");
    assert(String(json2?.id) === rpcId2, `POST /sse tools/call retry: id mismatch (expected ${rpcId2}, got ${String(json2?.id)})`);
    assert(Array.isArray(json2?.result?.content), "POST /sse tools/call retry: result.content must be an array");
    assert((json2?.result?.content || []).length > 0, "POST /sse tools/call retry: result.content must be non-empty");
    const retryFirstLine = String(json2?.result?.content?.[0]?.text || "").split("\n")[0] || "";
    assert(!/\bcontinued\b/i.test(retryFirstLine), `POST /sse tools/call retry: should not be 'continued' (got: ${retryFirstLine})`);
    console.log("[smoke-sse] ✅ retry dedupe prevents 'continued' drift");
  } else {
    console.log("[smoke-sse] Skipping POST /sse tools/call smoke (no MCP_ACCESS_TOKEN provided)");
  }

  // 4) If we have a token, connect over SSE and call signupassist.chat
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
    assert(toolNames.includes("signupassist.start"), `listTools: expected signupassist.start, got: ${toolNames.join(", ")}`);
    console.log("[smoke-sse] ✅ listTools ok");

    // Source-of-truth: provider feed count (via internal tools/call endpoint).
    const providerCountRes = await fetchJson(`${baseUrl}/tools/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool: "bookeo.find_programs", args: { org_ref: "aim-design", category: "all" } }),
    });
    assert(providerCountRes.status === 200, `provider feed: expected 200, got ${providerCountRes.status}`);
    assert(providerCountRes.json?.success === true, `provider feed: expected success=true, got ${JSON.stringify(providerCountRes.json)}`);
    const totalPrograms = Number(providerCountRes.json?.data?.total_programs || 0);
    assert(totalPrograms > 0, `provider feed: expected total_programs > 0, got ${totalPrograms}`);

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

    // Program list should not be unexpectedly truncated (e.g., 3 of 4).
    // Count enumerated items like "1. ..." in the returned text.
    const matches = text.match(/(^|\n)\d+\.\s+/g) || [];
    const shown = matches.length;
    const expectedMin = Math.min(totalPrograms, 8);
    assert(
      shown >= expectedMin,
      `signupassist.chat: expected >=${expectedMin} programs listed (provider total=${totalPrograms}), got ${shown}`
    );
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



