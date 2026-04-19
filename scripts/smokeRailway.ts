#!/usr/bin/env tsx
/**
 * Railway smoke checks for the current production posture.
 *
 * Required:
 * - RAILWAY_MCP_URL or MCP_SERVER_URL
 *
 * Optional:
 * - RAILWAY_WORKER_URL or WORKER_HEALTH_URL
 * - RAILWAY_WORKER_HEALTH_REQUIRED=1 to fail when worker URL is absent
 */
import "dotenv/config";

function normalizeBaseUrl(raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json,text/plain,*/*" } });
  const text = await res.text().catch(() => "");
  return { status: res.status, text };
}

async function checkHealth(name: string, baseUrl: string) {
  const url = `${normalizeBaseUrl(baseUrl)}/health`;
  const { status, text } = await fetchText(url);
  if (status < 200 || status >= 300) {
    throw new Error(`${name} /health expected 2xx, got ${status}: ${text.slice(0, 240)}`);
  }
  console.log(`[ok] ${name} /health responded ${status}`);
}

async function checkJsonEndpoint(name: string, baseUrl: string, path: "/status" | "/identity") {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const { status, text } = await fetchText(url);
  if (status < 200 || status >= 300) {
    throw new Error(`${name} ${path} expected 2xx, got ${status}: ${text.slice(0, 240)}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${name} ${path} expected JSON response`);
  }

  if (path === "/status" && json.ok !== true) {
    throw new Error(`${name} /status expected ok=true`);
  }
  if (path === "/identity" && typeof json.git_commit !== "string") {
    throw new Error(`${name} /identity expected git_commit`);
  }

  console.log(`[ok] ${name} ${path} responded ${status}`);
}

async function main() {
  const mcpUrl = normalizeBaseUrl(process.env.RAILWAY_MCP_URL || process.env.MCP_SERVER_URL || "");
  if (!mcpUrl) requiredEnv("RAILWAY_MCP_URL");

  console.log(`[railway-smoke] MCP target: ${mcpUrl}`);
  await checkHealth("MCP web service", mcpUrl);
  await checkJsonEndpoint("MCP web service", mcpUrl, "/status");
  await checkJsonEndpoint("MCP web service", mcpUrl, "/identity");

  const oauth = await fetchText(`${mcpUrl}/.well-known/oauth-authorization-server`);
  if (oauth.status !== 200) {
    throw new Error(`OAuth metadata expected 200, got ${oauth.status}: ${oauth.text.slice(0, 240)}`);
  }
  console.log("[ok] MCP OAuth metadata responded 200");

  const workerUrl = normalizeBaseUrl(process.env.RAILWAY_WORKER_URL || process.env.WORKER_HEALTH_URL || "");
  const workerRequired = ["1", "true", "yes"].includes(
    String(process.env.RAILWAY_WORKER_HEALTH_REQUIRED || "").toLowerCase(),
  );

  if (workerUrl) {
    console.log(`[railway-smoke] Worker target: ${workerUrl}`);
    await checkHealth("Scheduled worker service", workerUrl);
  } else if (workerRequired) {
    throw new Error("Missing RAILWAY_WORKER_URL or WORKER_HEALTH_URL while RAILWAY_WORKER_HEALTH_REQUIRED=1");
  } else {
    console.log("[warn] Worker health URL not provided; skipping scheduled worker /health check");
  }

  console.log("[ok] Railway smoke complete");
}

main().catch((error) => {
  console.error("[fail] Railway smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
