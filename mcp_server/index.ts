/**
 * SignupAssist MCP Server
 * Production-ready with OAuth manifest served at /mcp for ChatGPT discovery
 * Last deployment: 2025-12-22 - Added resources/list and resources/read handlers
 *
 * NOTE: API-first only (no scraping). SkiClubPro + Browserbase workflows are deprecated.
 */

// ============================================================
// V1 Chat UX Guardrails (NO WIDGETS)
// These run at the HTTP boundary (/orchestrator/chat) so behavior is deterministic.
// ============================================================
type WizardStep = "1" | "2" | "3" | "4" | "5";
type OrchestratorStep = "BROWSE" | "FORM_FILL" | "REVIEW" | "PAYMENT" | "SUBMIT" | "COMPLETED" | string;

function wizardTitle(step: WizardStep): string {
  switch (step) {
    case "1": return "Finding classes";
    case "2": return "Parent & child info";
    case "3": return "Payment method (Stripe)";
    case "4": return "Review & consent";
    case "5": return "Registering";
  }
}

function inferWizardStep(ctxStep: OrchestratorStep): WizardStep {
  if (ctxStep === "FORM_FILL") return "2";
  if (ctxStep === "PAYMENT") return "3";
  if (ctxStep === "REVIEW") return "4";
  if (ctxStep === "SUBMIT" || ctxStep === "COMPLETED") return "5";
  return "1";
}

function ensureWizardHeaderAlways(
  message: string,
  wizardStep: WizardStep,
  opts?: { continued?: boolean }
): string {
  const msg = (message || "").trim();
  // Use bold header to reduce the chance ChatGPT strips the first line when rendering tool output.
  const desiredHeader = `**Step ${wizardStep}/5${opts?.continued ? " continued" : ""} — ${wizardTitle(wizardStep)}**`;

  // If already has any Step X/5 header, replace it with the correct one.
  if (/^\*{0,2}Step\s+[1-5]\/5(?:\s+continued)?\s+—/i.test(msg)) {
    return msg.replace(/^\*{0,2}Step\s+[1-5]\/5(?:\s+continued)?\s+—[^\n]*\n*/i, `${desiredHeader}\n\n`);
  }

  return `${desiredHeader}\n\n${msg}`;
}

function stripWizardHeader(message: string): string {
  const msg = (message || "").trim();
  if (!msg) return msg;
  if (!/^\*{0,2}Step\s+[1-5]\/5(?:\s+continued)?\s+—/i.test(msg)) return msg;
  return msg.replace(/^\*{0,2}Step\s+[1-5]\/5(?:\s+continued)?\s+—[^\n]*\n*/i, "").trim();
}

function microQuestionEmail(programName?: string): string {
  const p = programName ? ` for **${programName}**` : "";
  return (
    `Step 2/5 — Parent & child info\n\n` +
    `🔐 I'll only ask for what the provider requires.\n\n` +
    `Please reply with everything in **one message** so we can move faster${p}:\n` +
    `- Parent/guardian email\n` +
    `- Parent/guardian first & last name\n` +
    `- Parent/guardian date of birth (MM/DD/YYYY)\n` +
    `- Relationship to the child (e.g., Parent)\n` +
    `- Child first & last name\n` +
    `- Child date of birth (MM/DD/YYYY)\n` +
    `Optional: phone number or logistical notes (e.g., pickup instructions)\n\n` +
    `Example: Email: name@example.com; Name: Jane Doe; DOB: 05/13/1976; Relationship: Parent; Child: Alex Doe; Child DOB: 02/17/2014; Phone: 555-123-4567`
  );
}

/**
 * FIX 4: Kill CTA buttons in chat mode (ChatGPT chat has nothing to click)
 * FIX 5: Strip ALL schema-ish metadata so ChatGPT never "helpfully dumps fields"
 */
function stripChatCTAsAndSchemas(resp: any): any {
  // Remove clickable CTAs (ChatGPT chat has nothing to click)
  if (resp?.cta) delete resp.cta;
  if (resp?.cards) {
    // cards are OK, but if they embed action CTAs, remove them.
    resp.cards = resp.cards.map((c: any) => {
      const cc = { ...c };
      if (cc?.action) delete cc.action;
      if (cc?.buttons) delete cc.buttons;
      return cc;
    });
  }

  // Remove ALL schema-ish payloads that cause field dumps
  if (resp?.metadata) {
    delete resp.metadata.componentType;
    delete resp.metadata.displayMode;
    delete resp.metadata.signupFormSchema;
    delete resp.metadata.formSchema;
    delete resp.metadata.signupForm;          // <-- the culprit in logs
    delete resp.metadata.fullscreen_form;
  }
  delete resp.signupFormSchema;
  delete resp.formSchema;
  delete resp.signupForm;
  // Reduce model “helpfulness” in Actions mode: prefer the plain `message` string we return.
  // (Otherwise the model may re-render from structured content and drop Step headers.)
  if (resp?.structuredContent) delete resp.structuredContent;
  if (resp?.content) delete resp.content;
  return resp;
}

function ensureSuccessFeeDisclosure(message: string, wizardStep: WizardStep): string {
  if (!message) return message;
  // Never append disclosures on the final "success/execution" step; it can confuse the model
  // and trigger accidental follow-up tool calls (e.g., re-browsing after a booking succeeds).
  if (wizardStep === "5") return message;

  // If the message already includes an explicit SignupAssist fee line, don't duplicate.
  if (/SignupAssist\s+Fee:/i.test(message) || /charged\s+only\s+upon\s+successful\s+registration/i.test(message)) {
    return message;
  }
  const mentionsFee = /\bsuccess fee\b/i.test(message) || /\$20\b/i.test(message) || /\bsignupassist\b/i.test(message);
  if (!mentionsFee) return message;

  const disclosure = [
    "✅ Pricing & payment",
    "- SignupAssist charges a **$20 success fee only after we successfully secure your spot**.",
    "- Provider program fee is billed separately via their official checkout (e.g., Bookeo/Stripe).",
    "- All payments use Stripe; card numbers are tokenized and not stored by SignupAssist.",
  ].join("\n");

  // Avoid duplicating the header; caller already handled wizard header.
  return `${message}\n\n${disclosure}`;
}

function collectMissingFields(context: any): string[] {
  const formData = context?.formData || {};
  const missing: string[] = [];
  const requiredDelegate = context?.requiredFields?.delegate || [];
  const requiredParticipant = context?.requiredFields?.participant || [];

  const check = (fields: any[]) => {
    for (const f of fields) {
      if (!f?.required) continue;
      const key = f.key;
      const val = formData[key];
      if (val == null || (typeof val === "string" && val.trim() === "")) {
        missing.push(f.label || f.key);
      }
    }
  };

  check(requiredDelegate);
  check(requiredParticipant);
  return missing;
}

function isDebugLoggingEnabled(): boolean {
  return String(process.env.DEBUG_LOGGING || "").toLowerCase() === "true";
}

function isMcpRefreshDebugEnabled(): boolean {
  return String(process.env.DEBUG_MCP_REFRESH || "").toLowerCase() === "true";
}

function redactForLogs(input: string): string {
  const s = String(input || "");
  // Emails
  let out = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  // ISO dates + common DOB formats
  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[REDACTED_DATE]");
  out = out.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[REDACTED_DATE]");
  // Bearer tokens
  out = out.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g, "Bearer [REDACTED_TOKEN]");
  return out;
}

function shouldDebugForMcpMessage(msg: any, verifiedUserId?: string): boolean {
  if (!isDebugLoggingEnabled()) return false;
  const debugUserId = String(process.env.DEBUG_USER_ID || "").trim();
  const debugSessionId = String(process.env.DEBUG_SESSION_ID || "").trim();

  // If DEBUG_USER_ID is set, require match.
  if (debugUserId) {
    return !!verifiedUserId && verifiedUserId === debugUserId;
  }

  // If DEBUG_SESSION_ID is set, attempt to match against tool args sessionId when present.
  if (debugSessionId) {
    const argSessionId =
      msg?.params?.arguments?.sessionId ||
      msg?.params?.arguments?.session_id ||
      msg?.params?.sessionId;
    return !!argSessionId && String(argSessionId) === debugSessionId;
  }

  // Targeted-only posture: if no target is specified, do not debug-log.
  return false;
}

// ============================================================
// Security quick wins: lightweight rate limiting (in-memory)
// ============================================================
type RateBucket = { resetAt: number; count: number };
const rateBuckets: Map<string, RateBucket> = new Map();
const activeSseByKey: Map<string, number> = new Map();

function isRateLimitEnabled(): boolean {
  const raw = String(process.env.RATE_LIMIT_ENABLED || "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  // Default on in production, off elsewhere.
  if (!raw) return String(process.env.NODE_ENV || "").toLowerCase() === "production";
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

function normalizeIp(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Common Node format: ::ffff:1.2.3.4
  if (s.startsWith("::ffff:")) return s.slice("::ffff:".length);
  return s;
}

function getClientIp(req: any): string {
  const xff = String(req?.headers?.["x-forwarded-for"] || "");
  const first = xff.split(",")[0]?.trim();
  const real = String(req?.headers?.["x-real-ip"] || "").trim();
  const remote = req?.socket?.remoteAddress ? String(req.socket.remoteAddress) : "";
  return normalizeIp(first || real || remote) || "unknown";
}

function getRateLimitKey(req: any): string {
  const authHeader = String(req?.headers?.["authorization"] || "").trim();
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (token) {
    // Never store raw tokens; hash to reduce sensitivity and cardinality.
    const h = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
    return `tok_${h}`;
  }
  return `ip_${getClientIp(req)}`;
}

function pruneRateBuckets(nowMs: number) {
  // Opportunistic cleanup to avoid unbounded growth (Auth0 JWTs are high-cardinality).
  if (rateBuckets.size < 5000) return;
  for (const [k, v] of rateBuckets) {
    if (nowMs >= v.resetAt) rateBuckets.delete(k);
  }
  if (rateBuckets.size > 20000) rateBuckets.clear();
}

function consumeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  pruneRateBuckets(now);

  const bucketKey = `${key}`;
  let b = rateBuckets.get(bucketKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, b);
  }
  b.count += 1;
  const allowed = b.count <= max;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { allowed, retryAfterSec };
}

// Body size caps (quick win): avoid unbounded buffering on POST endpoints.
function normalizeMaxBodyBytes(raw: any, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Clamp to sane bounds for an API server.
  return Math.max(16 * 1024, Math.min(n, 2 * 1024 * 1024));
}

async function readBodyWithLimit(req: any, maxBytes: number): Promise<string> {
  const max = normalizeMaxBodyBytes(maxBytes, 256 * 1024);
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > max) {
      const err: any = new Error('Request body too large');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * MASTER GUARDRAIL: Apply all V1 chat UX guardrails at HTTP boundary
 * - FIX 1: Always Step headers based on context.step
 * - FIX 4: No clickable CTAs
 * - FIX 5: No schema payloads (prevents field dumps)
 * - FORM_FILL becomes micro-question (email)
 */
function applyV1ChatGuardrails(resp: any): any {
  // Prefer explicit `resp.step` when set by the orchestrator (e.g., receipts/audit views),
  // otherwise fall back to `resp.context.step`.
  const ctxStep: OrchestratorStep = (resp?.step || resp?.context?.step || "BROWSE") as OrchestratorStep;
  const wizardStep = inferWizardStep(ctxStep);

  // Always remove CTAs/schemas first
  stripChatCTAsAndSchemas(resp);

  // API-first: do not override orchestrator form flow here; enforce wizard headers for the signup flow only.
  // Receipts/audit/cancel are "account management" views and should not show Step 1/5–5/5 headers.
  const suppressWizardHeader = !!resp?.metadata?.suppressWizardHeader;
  if (suppressWizardHeader) {
    resp.message = stripWizardHeader(resp?.message || "");
    return resp;
  }

  // Always enforce correct header based on context.step
  const continued = !!resp?.metadata?.wizardContinued || Number(resp?.metadata?.wizardTurnInStep || 0) > 1;
  resp.message = ensureWizardHeaderAlways(resp?.message || "", wizardStep, { continued });
  resp.message = ensureSuccessFeeDisclosure(resp.message, wizardStep);

  return resp;
}

// Version info for runtime debugging
const VERSION_INFO = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'dev',
  builtAt: new Date().toISOString(),
  nodeVersion: process.version,
  useNewAAP: process.env.USE_NEW_AAP === 'true'
};

// ============================================================
// V1 "MCP-only" hardening (optional)
// If enabled, we disable legacy OpenAPI/Actions surfaces to prevent
// ChatGPT from silently routing through the OpenAPI wrapper instead of MCP.
// ============================================================
function isMcpOnlyMode(): boolean {
  const raw = process.env.MCP_ONLY_MODE ?? process.env.DISABLE_OPENAPI_WRAPPER;

  // Default posture for App Store: in production, prefer MCP-only unless explicitly disabled.
  // This prevents ChatGPT from silently routing through legacy OpenAPI/Actions endpoints.
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return String(process.env.NODE_ENV || "").toLowerCase() === "production";
  }

  const v = String(raw).toLowerCase().trim();
  if (["false", "0", "no", "off"].includes(v)) return false;
  return ["true", "1", "yes", "on"].includes(v);
}

function getRequestBaseUrl(req: any): string {
  const host =
    (req?.headers?.["x-forwarded-host"] as string | undefined) ||
    (req?.headers?.["host"] as string | undefined);
  const forwardedProto = req?.headers?.["x-forwarded-proto"] as string | undefined;
  const proto =
    forwardedProto ||
    (host && (host.startsWith("localhost") || host.startsWith("127.0.0.1")) ? "http" : "https");
  return host ? `${proto}://${host}` : "https://signupassist-mcp-production.up.railway.app";
}

function respondOpenApiDisabled(req: any, res: any, endpoint: string) {
  const baseUrl = getRequestBaseUrl(req);
  res.writeHead(410, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  // Some validators probe with HEAD. Return headers only (no body) for HEAD.
  if (String(req?.method || "").toUpperCase() === "HEAD") {
    res.end();
    return;
  }
  res.end(
    JSON.stringify(
      {
        error: "openapi_disabled",
        endpoint,
        message:
          "This legacy OpenAPI/Actions endpoint is disabled (MCP-only mode). Use the MCP app instead.",
        mcp_sse_url: `${baseUrl}/sse`,
        mcp_manifest_url: `${baseUrl}/.well-known/chatgpt-apps-manifest.json`,
        hint:
          "In ChatGPT, disable GPT Actions for this GPT and connect the MCP app under Settings → Apps.",
      },
      null,
      2
    )
  );
}

// ChatGPT Apps SDK V1 Metadata (NO WIDGETS)
// V1 App Store submission: avoid widget templates to eliminate CSP/domain requirements.
// We still provide progress via toolInvocation messages.
const CHATGPT_APPS_V1_META = {
  "openai/toolInvocation/invoking": "Working…",
  "openai/toolInvocation/invoked": "Done."
};

// V1 App Store posture: keep public surface small + mostly read-only.
// Allow Stripe "setup" flow to remain public (hosted Stripe checkout link), but keep write/execute tools private.
function v1VisibilityForTool(toolName: string, toolMeta: Record<string, any> = {}): "public" | "private" {
  // Deprecate SkiClubPro entirely (old scraping workflow)
  if (toolName.startsWith("scp.") || toolName.startsWith("scp:") || toolName.includes("skiclubpro")) {
    return "private";
  }

  // V1 posture: keep the model-facing tool surface extremely small to make
  // ChatGPT's behavior deterministic and prevent it from "helpfully" reformatting
  // or dumping raw fields from lower-level provider tools.
  //
  // We still REGISTER all tools (so the orchestrator can call them internally),
  // but we only LIST the canonical chat tool for the model.
  if (toolName === "signupassist.chat") return "public";
  // Read-only discovery entrypoint. Kept public to encourage app invocation for browsing queries.
  if (toolName === "signupassist.start") return "public";
  return "private";
}

// Wizard-style progress strings (no widget needed)
// Keep these short, calm, and consistent to build trust + reduce overwhelm.
function wizardInvocationForTool(toolName: string): { invoking: string; invoked: string } {
  // Step 1/5 — Program discovery
  const step1Invoking = "Step 1/5 — Finding classes…";
  const step1Invoked  = "Step 1/5 — Classes ready.";

  // Step 2/5 — Requirements / info needed
  const step2Invoking = "Step 2/5 — Checking what info is required…";
  const step2Invoked  = "Step 2/5 — Requirements ready.";

  // Step 3/5 — Review & consent
  const step3Invoking = "Step 3/5 — Reviewing details…";
  const step3Invoked  = "Step 3/5 — Review ready.";

  // Step 4/5 — Payment method / Stripe
  const step4Invoking = "Step 4/5 — Payment setup (Stripe)…";
  const step4Invoked  = "Step 4/5 — Payment step ready.";

  // Step 5/5 — Registration execution
  const step5Invoking = "Step 5/5 — Registering…";
  const step5Invoked  = "Step 5/5 — Registration step complete.";

  // Entry point / feed / chat
  // IMPORTANT: For the single public tool (signupassist.chat), do NOT duplicate a Step header
  // in the toolInvocation status text. Some ChatGPT surfaces appear to suppress the first line
  // of tool output when they think "progress" is already shown.
  if (toolName === "signupassist.chat") {
    return { invoking: "Working…", invoked: "Reply ready." };
  }
  if (toolName === "signupassist.start" || toolName === "program_feed.get") {
    return { invoking: step1Invoking, invoked: step1Invoked };
  }

  // Program discovery tools
  if (toolName === "bookeo.find_programs") {
    return { invoking: step1Invoking, invoked: step1Invoked };
  }

  // Required fields / probes
  if (toolName === "bookeo.discover_required_fields") {
    return { invoking: step2Invoking, invoked: step2Invoked };
  }

  // Stripe / billing checks
  if (
    toolName.startsWith("stripe.") ||
    toolName === "user.check_payment_method"
  ) {
    return { invoking: step4Invoking, invoked: step4Invoked };
  }

  // Mandates / consent + execution
  if (
    toolName === "mandates.create" ||
    toolName === "mandates.prepare_registration"
  ) {
    // Treat mandate creation/prep as Step 3/5: clarifying + confirming what's needed
    return { invoking: step3Invoking, invoked: "Step 3/5 — Consent step ready." };
  }
  if (
    toolName === "mandates.submit_registration"
  ) {
    return { invoking: step5Invoking, invoked: "Step 5/5 — Registered (or attempted). See details above." };
  }

  // Provider booking execution
  if (
    toolName === "bookeo.create_hold" ||
    toolName === "bookeo.confirm_booking"
  ) {
    return { invoking: step5Invoking, invoked: step5Invoked };
  }

  // Default: keep it neutral
  return { invoking: "Working…", invoked: "Done." };
}

function applyWizardMeta(toolName: string) {
  const { invoking, invoked } = wizardInvocationForTool(toolName);
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function applyV1Visibility(toolName: string, toolMeta: Record<string, any> = {}) {
  return {
    "openai/visibility": v1VisibilityForTool(toolName, toolMeta),
  };
}

function isAllowUnauthReadonlyToolsEnabled(): boolean {
  const raw = String(process.env.MCP_ALLOW_UNAUTH_READONLY_TOOLS || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function isUnauthReadonlyToolAllowed(toolName: string): boolean {
  // Hard allowlist: only allow the read-only discovery entrypoint.
  // Everything else remains OAuth-gated.
  return toolName === "signupassist.start";
}

// Import Auth0 middleware and protected actions config
import { verifyAuth0Token, extractBearerToken, getAuth0Config } from './middleware/auth0.js';
import { isProtectedAction, PROTECTED_ACTIONS } from './config/protectedActions.js';

// Print build info banner on startup
console.info(
  `[BUILD] Version: ${VERSION_INFO.commit} | Built: ${VERSION_INFO.builtAt} | USE_NEW_AAP: ${VERSION_INFO.useNewAAP}`
);

// ============================================================================
// Type Exports - Single Source of Truth
// ============================================================================
// All types are centrally defined in ./types.ts and re-exported here
// Import types from mcp_server/types throughout the codebase
export * from './types.js';

// ============================================================================
// MCP Tool Result Helpers
// ============================================================================
type MCPTextContent = { type: "text"; text: string };

// Always return a valid MCP CallToolResult shape.
// IMPORTANT: Prefer structuredContent so ChatGPT can render rich content natively.
export function mcpOk(value: unknown) {
  const defaultText: MCPTextContent = { type: "text", text: "✅ Done." };

  // If the tool already returned an MCP-style result, ensure it STILL includes `content`.
  // ChatGPT validates CallToolResult and will fail if `content` is missing.
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const hasContentArray = Array.isArray((v as any).content);
    const looksLikeCallToolResult =
      "structuredContent" in v || "content" in v || "_meta" in v || "isError" in v;

    if (looksLikeCallToolResult) {
      if (hasContentArray && (v as any).content.length > 0) return v;
      return {
        ...v,
        content: hasContentArray && (v as any).content.length === 0 ? [defaultText] : (hasContentArray ? (v as any).content : [defaultText]),
      };
    }
  }

  // Default: expose as structuredContent + short text summary
  return { structuredContent: value, content: [defaultText] };
}

export function mcpError(message: string, details?: unknown) {
  const text =
    details === undefined
      ? message
      : `${message}\n\nDetails:\n${JSON.stringify(details, null, 2)}`;

  return {
    isError: true,
    content: [{ type: "text", text } satisfies MCPTextContent],
  };
}

// ============================================================================
// Core Imports
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getPlaceholderImage } from './lib/placeholderImages.js';

import { createServer } from 'http';
import { URL, fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import path, { dirname } from 'path';
import crypto from 'crypto';

// ✅ Fix for ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== OAuth/OIDC Discovery Helpers ====================
// Some clients (including ChatGPT) may fetch OpenID Connect discovery endpoints even when using OAuth.
// We expose OIDC discovery + JWKS under our own domain for maximum compatibility.
const AUTH0_JWKS_JSON_TTL_MS = 5 * 60 * 1000;
let cachedAuth0JwksJson:
  | { domain: string; fetchedAt: number; jwks: any }
  | null = null;

async function getCachedAuth0JwksJson(domain: string): Promise<any> {
  const now = Date.now();
  if (
    cachedAuth0JwksJson &&
    cachedAuth0JwksJson.domain === domain &&
    now - cachedAuth0JwksJson.fetchedAt < AUTH0_JWKS_JSON_TTL_MS
  ) {
    return cachedAuth0JwksJson.jwks;
  }

  const jwksUrl = `https://${domain}/.well-known/jwks.json`;
  const res = await fetch(jwksUrl, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Auth0 JWKS (${res.status}): ${text.slice(0, 200)}`);
  }
  const jwks = await res.json();
  cachedAuth0JwksJson = { domain, fetchedAt: now, jwks };
  return jwks;
}

// Import tool providers
import { bookeoTools } from './providers/bookeo.js';
import { stripeTools } from './providers/stripe.js';
import { programFeedTools } from './providers/programFeed.js';
import { mandateTools } from './providers/mandates.js';
import { schedulerTools } from './providers/scheduler.js';
import { registrationTools } from './providers/registrations.js';
import { userTools } from './providers/user.js';
// import { daysmartTools } from '../providers/daysmart/index';
// import { campminderTools } from '../providers/campminder/index';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for database operations (service role)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Import prereqs registry
import { registerAllProviders } from './prereqs/providers.js';

// Import provider and organization registries
import './providers/bookeo/config.js'; // Auto-registers Bookeo
import './config/organizations.js'; // Auto-registers organizations
// import './providers/campminder/config.js'; // Uncomment when ready

// Import OpenAI smoke test
import { runOpenAISmokeTests } from './startup/openaiSmokeTest.js';

// Import provider cache preloader
import { preloadProviderCache } from './startup/preloadProviders.js';

// Type-only imports for orchestrators (safe - doesn't execute module code)
import type { IOrchestrator } from './ai/types.js';
// Note: AIOrchestrator is DEPRECATED - APIOrchestrator is the only runtime path

// Register error handlers FIRST to catch any import failures
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown handlers (API-first; no Browserbase session cleanup)
function gracefulShutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}, exiting...`);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

class SignupAssistMCPServer {
  private server: any;
  private tools: Map<string, any> = new Map();
  private orchestrator: IOrchestrator | null = null;
  private sseTransports: Map<string, any> = new Map(); // SSE session storage
  // Auth binding for MCP SSE transport: sessionId (SSEServerTransport.sessionId) → Supabase auth user id (UUID)
  // Used to inject `userId` into `signupassist.chat` tool calls so sessions persist per-user AND DB writes use UUIDs.
  private sseSessionUserIds: Map<string, string> = new Map();
  // Cache Auth0 sub → Supabase user id for the lifetime of this process (best-effort).
  private auth0SubToSupabaseUserId: Map<string, string> = new Map();

  constructor() {
    console.log('[STARTUP] SignupAssistMCPServer constructor called');

    const capabilities = {
      tools: {},
    };

    this.server = new Server(
      {
        name: 'signupassist-mcp',
        version: '1.0.0',
      },
      {
        capabilities,
      }
    );

    // Defensive: some deployments appear to run an older compiled artifact. This log makes it obvious.
    console.log('[STARTUP] MCP capabilities configured:', Object.keys(capabilities));

    console.log('[STARTUP] MCP Server instance created');

    this.setupRequestHandlers();
    this.registerTools();
  }

  async initializeOrchestrator() {
    // =========================================================================
    // API-FIRST MODE IS NOW THE ONLY RUNTIME PATH
    // AIOrchestrator (legacy/scraping mode) is deprecated and removed.
    // All flows go through APIOrchestrator for consistency and audit compliance.
    // =========================================================================
    try {
      console.log('[STARTUP] 🔵 API-FIRST MODE (ONLY PATH) - Loading APIOrchestrator...');
      const { default: APIOrchestrator } = await import('./ai/APIOrchestrator.js');
      console.log('[STARTUP] APIOrchestrator module loaded successfully');
      
      this.orchestrator = new APIOrchestrator(this); // Pass server instance for MCP tool access
      console.log('✅ [API-FIRST MODE] APIOrchestrator initialized with MCP tool access');
      console.log('✅ API-first providers: Bookeo (aim-design)');
      console.log('✅ No scraping, no prerequisites, no login required');
      console.log('✅ All API calls go through MCP layer for audit compliance');
      console.log('✅ Unified activation policy: triad + program match required');
      
      // Log that legacy mode is disabled
      if (process.env.USE_API_ORCHESTRATOR === 'false') {
        console.warn('⚠️  USE_API_ORCHESTRATOR=false is ignored. APIOrchestrator is now the only path.');
      }
      
    } catch (error) {
      console.error('❌ CRITICAL: APIOrchestrator failed to load - server cannot process chat');
      console.error('Error:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('Tip: Set OPENAI_API_KEY environment variable');
      this.orchestrator = null;
    }
  }

  private setupRequestHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // ChatGPT App Store (text-only V1): keep public surface minimal.
      // We still register private tools internally, but we do NOT list them to ChatGPT.
      const includePrivate = process.env.MCP_LISTTOOLS_INCLUDE_PRIVATE === 'true';

      const apiTools = Array.from(this.tools.values())
        .filter((tool) => tool?._meta?.["openai/visibility"] !== "private")
        .map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          _meta: tool._meta  // Include ChatGPT Apps SDK widget metadata
        }));

      // Default: only return publicly-visible tools (reduces model confusion and enforces SSoT via signupassist.chat).
      const visibleTools = includePrivate
        ? apiTools
        : apiTools.filter(t => t._meta?.["openai/visibility"] === "public");

      console.log(
        `[MCP] ListTools returning ${visibleTools.length} tools (${includePrivate ? "all" : "public-only"}):`,
        visibleTools.map(t => t.name)
      );
      return { tools: visibleTools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!this.tools.has(name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
      }
      const tool = this.tools.get(name);
      try {
        const result = await tool.handler(args);
        return mcpOk(result);  // Wrap in MCP-compliant format
      } catch (err: any) {
        console.error(`[MCP] Tool ${name} failed:`, err);
        return mcpError(`Tool ${name} failed`, {
          message: err?.message,
          stack: err?.stack
        });
      }
    });

  }

  private registerTools() {
    // Register Bookeo tools with ChatGPT Apps SDK V1 metadata
    bookeoTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),  // Preserve read-only safety metadata
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // Register Stripe tools
    stripeTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // Register Mandate tools with ChatGPT Apps SDK V1 metadata
    mandateTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // Register Scheduler tools
    schedulerTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // Register program feed (cache-first) tools
    Object.entries(programFeedTools).forEach(([name, tool]) => {
      this.tools.set(name, {
        name,
        description: `Program Feed tool: ${name}`,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(name, ((tool as any)._meta || {})),
          ...applyWizardMeta(name)
        }
      });
    });

    // Register Registration tools (receipts/audit trail)
    registrationTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // Register User tools (children, billing - ChatGPT App Store compliance)
    userTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        _meta: {
          ...CHATGPT_APPS_V1_META,
          ...((tool as any)._meta || {}),
          ...applyV1Visibility(tool.name, ((tool as any)._meta || {})),
          ...applyWizardMeta(tool.name)
        }
      });
    });

    // ============================================================
    // ACTION MODE ENTRYPOINT (READ-ONLY)
    // ============================================================
    // This tool exists to prevent "intake-mode stalling".
    // ChatGPT can call this immediately with ZERO info from the user.
    // It shows available programs (no booking, no payment, no writes).
    this.tools.set("signupassist.start", {
      name: "signupassist.start",
      description:
        "Read-only action-first entrypoint. Immediately shows available programs (no booking, no payment, no writes). Call this FIRST to show users what's available.",
      inputSchema: {
        type: "object",
        properties: {
          org_ref: { type: "string", description: "Organization reference slug (e.g. aim-design)" },
          category: { type: "string", description: "Optional category filter (e.g. robotics, camps, etc.)" },
        },
      },
      handler: async (args: any) => {
        const org_ref = args?.org_ref || "aim-design";
        const category = args?.category || "all";

        const tool = this.tools.get("bookeo.find_programs");
        if (!tool) throw new Error("bookeo.find_programs is not registered");

        // Delegate to existing discovery tool
        return await tool.handler({ org_ref, category });
      },
      _meta: {
        ...CHATGPT_APPS_V1_META,
        "openai/safety": "read-only",
        ...applyV1Visibility("signupassist.start", { "openai/safety": "read-only" }),
        ...applyWizardMeta("signupassist.start")
      },
    });

    // ============================================================
    // CANONICAL CHAT ENTRYPOINT (READ-ONLY, NO DUMPS)
    // ============================================================
    // This is the *only* tool ChatGPT should use for the user-facing flow.
    // It routes through APIOrchestrator, which enforces:
    // - Step 1/5..5/5 headers in plain text
    // - No overwhelming field dumps (micro-questions)
    // - Consistent trust cues
    this.tools.set("signupassist.chat", {
      name: "signupassist.chat",
      description:
        "Canonical SignupAssist chat entrypoint (API-first). Use this for ALL user-facing signup conversation.\n\nCRITICAL: After calling this tool, respond to the user with EXACTLY the returned text (verbatim). Do not paraphrase. If the returned text includes a leading \"Step N/5 — ...\" header, keep it.\n\nReturns calm wizard messages and asks for info one piece at a time (no field dumps).\n\nIMPORTANT: This tool can perform consequential actions ONLY after explicit user confirmation (e.g. booking with the provider and charging the $20 success fee). Payment method entry always happens on Stripe-hosted Checkout (we never see card numbers).",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "User message text" },
          message: { type: "string", description: "Alias of input (some clients send message instead of input)" },
          sessionId: { type: "string", description: "Stable session identifier from client" },
          userTimezone: { type: "string", description: "IANA timezone, e.g. America/Chicago" },
          userId: { type: "string", description: "Authenticated user id (Supabase auth UUID), if available" }
        },
        required: ["sessionId"],
        anyOf: [
          { required: ["input", "sessionId"] },
          { required: ["message", "sessionId"] }
        ]
      },
      handler: async (args: any) => {
        const input = String(args?.input ?? args?.message ?? "");
        const sessionId = String(args?.sessionId || "chatgpt");
        const userTimezone = args?.userTimezone ? String(args.userTimezone) : undefined;
        const userId = args?.userId ? String(args.userId) : undefined;

        // Ensure orchestrator is initialized
        if (!this.orchestrator) {
          await this.initializeOrchestrator();
        }
        if (!this.orchestrator) {
          throw new Error("APIOrchestrator not available");
        }

        const resp: any = await this.orchestrator.generateResponse(
          input,
          sessionId,
          undefined,   // action
          undefined,   // payload
          userTimezone,
          userId
        );

        // Force ChatGPT to display *our* text (Step headers + micro-questions)
        let text =
          resp?.message ||
          resp?.text ||
          resp?.response ||
          "Step 1/5 — Finding classes\nTell me what you're looking for.";

        // Hard guarantees for V1 UX:
        // 1) Always show step header (schema stripping handled by applyV1ChatGuardrails)
        // IMPORTANT: Use the orchestrator's current step to compute the wizard header.
        // Previously we hard-forced "1", which made the UX look like nothing was persisting/progressing.
        const suppressWizardHeader = !!resp?.metadata?.suppressWizardHeader;
        if (suppressWizardHeader) {
          text = stripWizardHeader(text);
        } else {
        const ctxStep: OrchestratorStep =
            (resp?.step || resp?.context?.step || "BROWSE") as OrchestratorStep;
        const wizardStep = inferWizardStep(ctxStep);
          const continued = !!resp?.metadata?.wizardContinued || Number(resp?.metadata?.wizardTurnInStep || 0) > 1;
          text = ensureWizardHeaderAlways(text, wizardStep, { continued });
        }

        return {
          content: [{ type: "text", text }],
        };
      },
      _meta: {
        ...CHATGPT_APPS_V1_META,
        // This tool can ultimately book/charge after explicit confirmation, so it is NOT "read-only".
        // Lower-level tools remain private and are invoked internally by the orchestrator with audit logging.
        "openai/safety": "write",
        ...applyV1Visibility("signupassist.chat", { "openai/safety": "write" }),
        ...applyWizardMeta("signupassist.chat")
      }
    });

    // Future array tools (no-op for now)
    const arrayTools: any[] = [];
    arrayTools.forEach((tool) => this.tools.set(tool.name, tool));
  }

  private isUuid(value: string): boolean {
    const v = String(value || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }

  private shadowEmailForAuth0Sub(sub: string): string {
    const s = String(sub || "").trim();
    const hash = crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
    return `auth0-${hash}@signupassist.internal`;
  }

  private async findSupabaseUserIdByEmail(email: string): Promise<string | null> {
    const target = String(email || "").trim().toLowerCase();
    if (!target) return null;

    // Supabase Admin API does not support direct email lookup; paginate listUsers.
    // This is acceptable for v1 and is cached per-process; for scale we can add a mapping table later.
    const perPage = 1000;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage } as any);
      if (error) {
        console.warn("[AUTH] Supabase listUsers error while resolving user:", error.message);
        return null;
      }
      const users = (data as any)?.users || (data as any)?.users?.users || (data as any)?.users || [];
      const list = Array.isArray(users) ? users : (Array.isArray((data as any)?.users) ? (data as any).users : []);
      const match = list.find((u: any) => String(u?.email || "").toLowerCase() === target);
      if (match?.id) return String(match.id);

      // Stop if we've exhausted the list.
      if (!list.length || list.length < perPage) break;
    }
    return null;
  }

  private async findSupabaseUserIdByAuth0Sub(sub: string): Promise<string | null> {
    const target = String(sub || "").trim();
    if (!target) return null;

    const perPage = 1000;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage } as any);
      if (error) {
        console.warn("[AUTH] Supabase listUsers error while resolving auth0_sub:", error.message);
        return null;
      }
      const users = (data as any)?.users || (data as any)?.users?.users || (data as any)?.users || [];
      const list = Array.isArray(users) ? users : (Array.isArray((data as any)?.users) ? (data as any).users : []);
      const match = list.find((u: any) => String(u?.user_metadata?.auth0_sub || "") === target);
      if (match?.id) return String(match.id);

      if (!list.length || list.length < perPage) break;
    }
    return null;
  }

  /**
   * Resolve (or provision) a Supabase auth user id for an Auth0 subject.
   *
   * Why: Our DB schema uses UUID user_id columns (and mandates references auth.users),
   * but Auth0 `sub` is typically a string like `auth0|...`.
   *
   * Approach:
   * - If Auth0 token includes email, try to map by that email.
   * - Else, derive a deterministic "shadow" email from sub (auth0-<sha>@signupassist.internal).
   * - Create the Supabase user if missing (email_confirm=true, random password).
   */
  private async resolveSupabaseUserIdFromAuth0(payload: any): Promise<string | undefined> {
    const sub = String(payload?.sub || "").trim();
    if (!sub) return undefined;

    const cached = this.auth0SubToSupabaseUserId.get(sub);
    if (cached) return cached;

    // Prefer deterministic mapping by Auth0 subject (stored in user_metadata.auth0_sub).
    // This avoids mismatches between email-based mapping and sub-based mapping.
    const bySub = await this.findSupabaseUserIdByAuth0Sub(sub);
    if (bySub) {
      this.auth0SubToSupabaseUserId.set(sub, bySub);
      return bySub;
    }

    // If sub already looks like a UUID, it might already be a Supabase auth user id.
    if (this.isUuid(sub)) {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(sub);
        if (!error && (data as any)?.user?.id) {
          this.auth0SubToSupabaseUserId.set(sub, sub);
          return sub;
        }
      } catch {
        // ignore
      }
    }

    const email = String(payload?.email || "").trim() || this.shadowEmailForAuth0Sub(sub);
    let userId = await this.findSupabaseUserIdByEmail(email);

    if (!userId) {
      try {
        const password = `sa_${crypto.randomBytes(24).toString("base64url")}`;
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            auth0_sub: sub,
            auth0_iss: payload?.iss,
            provisioned_by: "mcp_auth0_bridge",
          },
        } as any);

        if (error) {
          console.warn("[AUTH] Supabase createUser failed:", error.message);
        } else {
          userId = (data as any)?.user?.id ? String((data as any).user.id) : undefined;
        }
      } catch (e: any) {
        console.warn("[AUTH] Supabase createUser exception:", e?.message || e);
      }

      // If createUser raced with another instance, re-lookup.
      if (!userId) {
        userId = await this.findSupabaseUserIdByEmail(email);
      }
    }

    if (userId) {
      this.auth0SubToSupabaseUserId.set(sub, userId);
      return userId;
    }

    console.warn("[AUTH] Unable to resolve Supabase user id for Auth0 sub");
    return undefined;
  }

  getToolsList() {
    return Array.from(this.tools.keys());
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('SignupAssist MCP Server started (stdio mode)');
  }

  async startHTTP(): Promise<any> {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;

    const httpServer = createServer(async (req, res) => {
      // --- CORS setup
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-run-id, X-Mandate-JWS, X-Mandate-Id');
      // --- Baseline security headers (safe defaults for an API server)
      // NOTE: We avoid aggressive CSP/HSTS changes here to prevent breaking existing static assets or proxy behavior.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      // Keep minimal; deny powerful features by default.
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // Avoid caching for sensitive endpoints (tokens, tool execution, long-lived SSE).
      // Some endpoints (e.g., /.well-known/*) may override this with their own Cache-Control later.
      const pathnameForCache = url.pathname || '/';
      const noStore =
        pathnameForCache.startsWith('/oauth/') ||
        pathnameForCache === '/tools/call' ||
        pathnameForCache === '/messages' ||
        pathnameForCache.startsWith('/sse');
      if (noStore) {
        res.setHeader('Cache-Control', 'no-store');
      }

      // Reduce scanner/probe noise and avoid accidentally serving SPA index.html for common secret-leak probes.
      // This is especially important on public Railway deployments.
      const pathname = url.pathname || '/';
      const method = (req.method || 'GET').toUpperCase();
      const probeDenylistEnabled = process.env.PROBE_DENYLIST_ENABLED !== 'false';

      const isLikelyProbePath = (m: string, p: string): boolean => {
        if (!probeDenylistEnabled) return false;
        if (m !== 'GET') return false;
        const lower = p.toLowerCase();

        // Allow well-known + our known endpoints
        if (lower.startsWith('/.well-known/')) return false;
        if (lower === '/health') return false;
        if (lower.startsWith('/mcp')) return false;
        if (lower.startsWith('/oauth/')) return false;
        if (lower.startsWith('/sse')) return false;
        if (lower.startsWith('/messages')) return false;
        if (lower.startsWith('/assets/')) return false;

        // High-signal secret/config probes
        if (lower.includes('.env')) return true;
        if (lower.includes('phpinfo')) return true;
        if (lower.endsWith('.php')) return true;

        // Common framework/config files that should never exist in this app
        const suspiciousSuffixes = [
          '.sql', '.sqlite', '.sqlite3', '.db',
          '.bak', '.backup', '.old', '.save',
          '.ini', '.toml', '.yml', '.yaml',
          '.pem', '.key', '.crt', '.p12', '.pfx'
        ];
        if (suspiciousSuffixes.some(s => lower.endsWith(s))) return true;

        // Common exploit paths
        const suspiciousPrefixes = [
          '/.git', '/.svn', '/.hg',
          '/_profiler',
          '/wp-', '/wp/',
          '/vendor', '/laravel', '/storage', '/bootstrap',
          '/secrets', '/secret', '/keys', '/credentials'
        ];
        if (suspiciousPrefixes.some(prefix => lower.startsWith(prefix))) return true;

        return false;
      };

      if (isLikelyProbePath(method, pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // --- Rate limiting (quick win)
      if (isRateLimitEnabled()) {
        const key = getRateLimitKey(req);
        const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
        const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;

        const respond429 = (retryAfterSec: number) => {
          res.writeHead(429, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Retry-After': String(retryAfterSec || 1),
          });
          res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Please retry shortly.' }));
        };

        // Endpoint-specific limits (token-hash keyed when auth header is present; otherwise IP keyed).
        if (pathname === '/tools/call' && method === 'POST') {
          const max = Number(process.env.RATE_LIMIT_TOOLS_MAX || 240);
          const { allowed, retryAfterSec } = consumeRateLimit(`${key}:tools_call`, Number.isFinite(max) ? max : 240, window);
          if (!allowed) return respond429(retryAfterSec);
        }
        if ((pathname === '/messages' || pathname === '/sse/messages') && method === 'POST') {
          const max = Number(process.env.RATE_LIMIT_MESSAGES_MAX || 600);
          const { allowed, retryAfterSec } = consumeRateLimit(`${key}:messages`, Number.isFinite(max) ? max : 600, window);
          if (!allowed) return respond429(retryAfterSec);
        }
        if (pathname === '/sse' && (method === 'GET' || method === 'POST' || method === 'HEAD')) {
          const max = Number(process.env.RATE_LIMIT_SSE_MAX || 240);
          const { allowed, retryAfterSec } = consumeRateLimit(`${key}:sse_connect`, Number.isFinite(max) ? max : 240, window);
          if (!allowed) return respond429(retryAfterSec);
        }
        if (pathname === '/oauth/token' && method === 'POST') {
          // OAuth token exchanges may be bursty; keep a high default to avoid false positives.
          const max = Number(process.env.RATE_LIMIT_OAUTH_TOKEN_MAX || 2000);
          const { allowed, retryAfterSec } = consumeRateLimit(`${key}:oauth_token`, Number.isFinite(max) ? max : 2000, window);
          if (!allowed) return respond429(retryAfterSec);
        }
      }

      console.log(`[REQUEST] ${method} ${pathname}`);

      // --- Bookeo API Helper (for deprecated legacy endpoints)
      // Extract Bookeo credentials once for all handlers
      const BOOKEO_API_KEY = process.env.BOOKEO_API_KEY;
      const BOOKEO_SECRET_KEY = process.env.BOOKEO_SECRET_KEY;
      
      /**
       * Build Bookeo API URL with query parameter authentication
       * This matches the working curl pattern and sync-bookeo edge function
       */
      function buildBookeoUrl(path: string, extra: Record<string, string> = {}): string {
        const url = new URL(`https://api.bookeo.com/v2${path}`);
        if (BOOKEO_API_KEY) url.searchParams.set("apiKey", BOOKEO_API_KEY);
        if (BOOKEO_SECRET_KEY) url.searchParams.set("secretKey", BOOKEO_SECRET_KEY);
        for (const [k, v] of Object.entries(extra)) {
          url.searchParams.set(k, v);
        }
        return url.toString();
      }

      // ==================== OAUTH PROXY ENDPOINTS ====================
      // These proxy Auth0 endpoints through Railway to satisfy GPT Builder's
      // same-domain requirement (all URLs must share the same root domain)
      
      const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'dev-xha4aa58ytpvlqyl.us.auth0.com';
      const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
      const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;
      const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://shipworx.ai/api';

      // --- OAuth Protected Resource Metadata (RFC 9728)
      // ChatGPT probes this (and sometimes appends `/sse` or prefixes with `/sse/`) while validating MCP OAuth.
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (url.pathname === '/.well-known/oauth-protected-resource' ||
          url.pathname === '/.well-known/oauth-protected-resource/sse' ||
          url.pathname === '/sse/.well-known/oauth-protected-resource')
      ) {
        console.log('[OAUTH] OAuth protected resource metadata request');
        const baseUrl = getRequestBaseUrl(req);

        const meta = {
          resource: `${baseUrl}/sse`,
          authorization_servers: [baseUrl],
          scopes_supported: ["openid", "profile", "email", "offline_access"],
          bearer_methods_supported: ["header"],
          authorization_endpoint: `${baseUrl}/oauth/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          jwks_uri: `${baseUrl}/.well-known/jwks.json`,
          service_documentation: `${baseUrl}/docs`,
        };

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify(meta, null, 2));
        return;
      }

      // --- OpenID Connect Discovery (GET/HEAD /.well-known/openid-configuration)
      // Some clients fetch OIDC discovery even for OAuth-only use-cases.
      // ChatGPT sometimes probes with odd `/sse` prefixes/suffixes.
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (url.pathname === '/.well-known/openid-configuration' ||
          url.pathname === '/.well-known/openid_configuration' ||
          url.pathname === '/.well-known/openid-configuration/sse' ||
          url.pathname === '/.well-known/openid_configuration/sse' ||
          url.pathname === '/sse/.well-known/openid-configuration' ||
          url.pathname === '/sse/.well-known/openid_configuration')
      ) {
        console.log('[OAUTH] OpenID configuration request');
        const baseUrl = getRequestBaseUrl(req);

        // Provide a minimal, proxy-friendly OIDC discovery document.
        const openid = {
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/oauth/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          jwks_uri: `${baseUrl}/.well-known/jwks.json`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'name'],
          code_challenge_methods_supported: ['S256', 'plain'],
          service_documentation: `${baseUrl}/docs`,
        };

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify(openid, null, 2));
        return;
      }

      // --- JWKS Endpoint (GET/HEAD /.well-known/jwks.json)
      // Serves Auth0 JWKS under our own domain (same-root-domain compatibility).
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (url.pathname === '/.well-known/jwks.json' || url.pathname === '/oauth/jwks')
      ) {
        console.log('[OAUTH] JWKS request');
        try {
          const jwks = await getCachedAuth0JwksJson(AUTH0_DOMAIN);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          res.end(JSON.stringify(jwks));
        } catch (e: any) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'jwks_unavailable', message: e?.message || 'Failed to fetch JWKS' }));
        }
        return;
      }
      
      // --- OAuth Authorization Proxy (GET/HEAD /oauth/authorize)
      // Redirects to Auth0 with all query params preserved.
      // NOTE: Some clients probe with HEAD during validation.
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/oauth/authorize') {
        console.log('[OAUTH] Authorization request received, proxying to Auth0');
        
        const auth0Url = new URL(`https://${AUTH0_DOMAIN}/authorize`);
        
        // Forward all query params from ChatGPT
        url.searchParams.forEach((value, key) => {
          auth0Url.searchParams.set(key, value);
        });
        
        // Ensure audience is set for API access
        if (!auth0Url.searchParams.has('audience')) {
          auth0Url.searchParams.set('audience', AUTH0_AUDIENCE);
        }

        // Force canonical Auth0 client id from server config (ignore any client-supplied override).
        // This makes reconnect flows resilient if the ChatGPT UI stores/uses an outdated client id.
        if (AUTH0_CLIENT_ID) {
          auth0Url.searchParams.set('client_id', AUTH0_CLIENT_ID);
        }

        // Make it easy to switch accounts inside ChatGPT's embedded browser.
        // Without this, Auth0 can silently reuse an existing SSO session.
        if (!auth0Url.searchParams.has('prompt')) {
          auth0Url.searchParams.set('prompt', process.env.AUTH0_OAUTH_PROMPT || 'login');
        }
        
        console.log('[OAUTH] Redirecting to:', auth0Url.toString().replace(/client_secret=[^&]+/, 'client_secret=***'));
        
        res.writeHead(302, { 'Location': auth0Url.toString() });
        res.end();
        return;
      }
      
      // --- OAuth Token Proxy (POST /oauth/token)
      // Forwards token exchange request to Auth0
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        console.log('[OAUTH] Token exchange request received, proxying to Auth0');
        
        try {
          // Read request body
          const maxBytes = normalizeMaxBodyBytes(process.env.MAX_OAUTH_TOKEN_BODY_BYTES, 64 * 1024);
          const body = await readBodyWithLimit(req, maxBytes);
          
          // Parse the body (could be JSON or form-urlencoded)
          let tokenParams: Record<string, string> = {};
          const contentType = req.headers['content-type'] || '';
          
          if (contentType.includes('application/json')) {
            tokenParams = JSON.parse(body);
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const parsed = new URLSearchParams(body);
            parsed.forEach((value, key) => {
              tokenParams[key] = value;
            });
          } else {
            // Try to parse as form-urlencoded by default
            const parsed = new URLSearchParams(body);
            parsed.forEach((value, key) => {
              tokenParams[key] = value;
            });
          }
          
          console.log('[OAUTH] Token request params (redacted):', {
            grant_type: tokenParams.grant_type,
            code: tokenParams.code ? '***' : undefined,
            redirect_uri: tokenParams.redirect_uri,
            client_id: tokenParams.client_id ? '***' : undefined
          });

          // Extra debug (safe): log which fields are present, without values.
          const keys = Object.keys(tokenParams || {}).sort();
          console.log('[OAUTH] Token request keys:', keys);
          console.log('[OAUTH] Token request has_code_verifier:', !!tokenParams.code_verifier, 'len:', tokenParams.code_verifier ? String(tokenParams.code_verifier).length : 0);
          
          // Force canonical Auth0 client credentials from server config.
          // This avoids "invalid_client" errors if the ChatGPT UI has stale/incorrect values.
          if (AUTH0_CLIENT_ID) tokenParams.client_id = AUTH0_CLIENT_ID;
          if (AUTH0_CLIENT_SECRET) tokenParams.client_secret = AUTH0_CLIENT_SECRET;
          
          // Forward to Auth0 token endpoint
          const auth0TokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
          
          // OAuth spec default is x-www-form-urlencoded. Use it for maximum compatibility,
          // especially for PKCE code_verifier handling.
          const form = new URLSearchParams();
          for (const [k, v] of Object.entries(tokenParams || {})) {
            if (v === undefined || v === null) continue;
            form.set(k, String(v));
          }

          const auth0Response = await fetch(auth0TokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: form.toString()
          });
          
          const responseData = await auth0Response.text();
          
          console.log('[OAUTH] Auth0 token response status:', auth0Response.status);
          if (auth0Response.status >= 400) {
            console.warn('[OAUTH] Auth0 token response error (truncated):', String(responseData || '').slice(0, 400));
          }
          
          // Forward Auth0's response back to ChatGPT
          res.writeHead(auth0Response.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(responseData);
        } catch (error: any) {
          if (error?.code === 'BODY_TOO_LARGE') {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'payload_too_large', message: 'Request body too large' }));
            return;
          }
          console.error('[OAUTH] Token exchange error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token exchange failed', details: error?.message }));
        }
        return;
      }

      // --- OAuth Token Probe (HEAD /oauth/token)
      // Some clients probe token endpoint reachability with HEAD.
      if (req.method === 'HEAD' && url.pathname === '/oauth/token') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end();
        return;
      }
      
      // --- OAuth Authorization Server Metadata (RFC 8414)
      // ChatGPT requires this to discover OAuth endpoints
      // NOTE: Some clients probe with HEAD during validation.
      // ChatGPT sometimes probes with odd `/sse` prefixes/suffixes.
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (url.pathname === '/.well-known/oauth-authorization-server' ||
          url.pathname === '/.well-known/oauth-authorization-server/sse' ||
          url.pathname === '/sse/.well-known/oauth-authorization-server')
      ) {
        console.log('[OAUTH] Authorization server metadata request');
        
        const host =
          (req.headers['x-forwarded-host'] as string | undefined) ||
          (req.headers['host'] as string | undefined);
        const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined);
        const proto =
          forwardedProto ||
          (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
        const baseUrl =
          host
            ? `${proto}://${host}`
            : (process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                : `https://signupassist-mcp-production.up.railway.app`);
        
        // RFC 8414 metadata - explicitly NOT including registration_endpoint
        // to indicate we don't support RFC 7591 Dynamic Client Registration
        const metadata = {
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/oauth/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          response_types_supported: ["code"],
          scopes_supported: ["openid", "profile", "email", "offline_access"],
          code_challenge_methods_supported: ["S256", "plain"],
          // Explicitly indicate PKCE is supported (ChatGPT uses this)
          service_documentation: `${baseUrl}/docs`,
          ui_locales_supported: ["en"]
        };
        
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600'
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify(metadata, null, 2));
        return;
      }
      
      // --- OAuth Dynamic Client Registration (RFC 7591) - NOT SUPPORTED
      // Return proper error per spec section 3.2.2
      if (req.method === 'POST' && url.pathname === '/oauth/register') {
        console.log('[OAUTH] Dynamic client registration request - not supported');
        
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "invalid_client_metadata",
          error_description: "Dynamic client registration is not supported. Please use pre-configured OAuth credentials."
        }));
        return;
      }
      
      // ==================== END OAUTH PROXY ENDPOINTS ====================

      // --- Service documentation (referenced by /.well-known/oauth-authorization-server)
      if (req.method === 'GET' && url.pathname === '/docs') {
        const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
        const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers['host'] as string | undefined);
        const baseUrl = host ? `${proto}://${host}` : `https://signupassist-mcp-production.up.railway.app`;

        const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SignupAssist MCP — Docs</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5; margin: 40px auto; max-width: 980px; padding: 0 16px; }
      code { background: #f4f4f5; padding: 2px 6px; border-radius: 6px; }
      a { color: #0b5fff; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .muted { color: #555; }
      ul { padding-left: 18px; }
    </style>
  </head>
  <body>
    <h1>SignupAssist MCP — Service Docs</h1>
    <p class="muted">This is a lightweight service-doc page referenced by OAuth discovery metadata.</p>

    <h2>Key endpoints</h2>
    <ul>
      <li><code>/.well-known/chatgpt-apps-manifest.json</code> — ChatGPT Apps (MCP) manifest</li>
      <li><code>/sse</code> — MCP SSE transport endpoint</li>
      <li><code>/messages</code> — MCP SSE message endpoint</li>
      <li><code>/.well-known/oauth-authorization-server</code> — OAuth discovery metadata</li>
      <li><code>/oauth/authorize</code> — OAuth authorization proxy</li>
      <li><code>/oauth/token</code> — OAuth token proxy</li>
      <li><code>/privacy</code> — Privacy policy</li>
      <li><code>/terms</code> — Terms of Use</li>
    </ul>

    <h2>Useful links</h2>
    <ul>
      <li><a href="${baseUrl}/.well-known/chatgpt-apps-manifest.json">ChatGPT Apps manifest</a></li>
      <li><a href="${baseUrl}/.well-known/oauth-authorization-server">OAuth metadata</a></li>
      <li><a href="${baseUrl}/privacy">Privacy policy</a></li>
      <li><a href="${baseUrl}/terms">Terms of Use</a></li>
      <li><a href="${baseUrl}/mcp/openapi.json">OpenAPI (legacy tooling)</a></li>
    </ul>
  </body>
</html>`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300'
        });
        res.end(html);
        return;
      }

      // ==================== MCP SSE TRANSPORT ENDPOINTS ====================
      // These endpoints allow ChatGPT Apps Connector to communicate via SSE
      // instead of stdio (which ChatGPT cannot use)
      
      // SSE session storage is now a class property (this.sseTransports)
      
      // --- SSE Connection Endpoint (/sse)
      // Establishes a Server-Sent Events connection for ChatGPT.
      // NOTE: Some clients use POST /sse (connector refresh), others use GET /sse, and
      // some validation flows may probe with HEAD /sse.
      if ((req.method === 'GET' || req.method === 'POST' || req.method === 'HEAD') && url.pathname === '/sse') {
        console.log('[SSE] New SSE connection request');

        if (isMcpRefreshDebugEnabled()) {
          const accept = String(req.headers['accept'] || '');
          const hasAuth = !!req.headers['authorization'];
          console.log(
            `[DEBUG_MCP_REFRESH] /sse method=${req.method} accept=${JSON.stringify(accept)} hasAuth=${hasAuth}`
          );
        }
        
        // Track per-token/IP concurrent SSE streams; ensure we can always release on error.
        let releaseSseSlot: (() => void) | null = null;

        try {
          // Lightweight probe support: respond OK without opening an SSE transport.
          if (req.method === 'HEAD') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            });
            res.end();
            return;
          }

          // ----------------------------------------------------------------
          // Discovery compatibility: Some clients (including ChatGPT refresh flows)
          // appear to POST JSON-RPC discovery calls directly to /sse and expect a
          // finite JSON response (not a long-lived SSE stream).
          //
          // If we detect a small JSON-RPC body for initialize/tools/list, we return
          // HTTP 200 JSON-RPC immediately and do NOT open an SSE transport.
          // ----------------------------------------------------------------
          if (req.method === 'POST') {
            const contentType = String(req.headers['content-type'] || '');
            const contentLength = Number(req.headers['content-length'] || 0);
            const maxDiscoveryBodyBytes = 64 * 1024; // 64KB safety cap

            if (
              contentLength > 0 &&
              contentLength <= maxDiscoveryBodyBytes &&
              contentType.toLowerCase().includes('application/json')
            ) {
              if (isMcpRefreshDebugEnabled()) {
                console.log(
                  `[DEBUG_MCP_REFRESH] /sse has JSON body contentLength=${contentLength} contentType=${JSON.stringify(contentType)}`
                );
              }

              let body = '';
              for await (const chunk of req) {
                body += chunk;
                if (body.length > maxDiscoveryBodyBytes) break;
              }

              let parsed: any = null;
              try {
                parsed = JSON.parse(body);
              } catch {
                // ignore
              }

              const methodName = parsed?.method ? String(parsed.method) : '';
              if (isMcpRefreshDebugEnabled()) {
                console.log(`[DEBUG_MCP_REFRESH] /sse body methodName=${methodName || 'unknown'}`);
              }

              if (methodName === 'tools/list') {
                const includePrivate = process.env.MCP_LISTTOOLS_INCLUDE_PRIVATE === 'true';
                const apiTools = Array.from(this.tools.values())
                  .filter((tool) => tool?._meta?.["openai/visibility"] !== "private")
                  .map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    _meta: tool._meta,
                  }));
                const visibleTools = includePrivate
                  ? apiTools
                  : apiTools.filter((t) => t._meta?.["openai/visibility"] === "public");

                console.log(
                  `[MCP] /sse discovery tools/list (HTTP 200) returning ${visibleTools.length} tools (${includePrivate ? "all" : "public-only"}):`,
                  visibleTools.map((t) => t.name)
                );

                res.writeHead(200, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store',
                });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed?.id ?? 1,
                    result: { tools: visibleTools },
                  })
                );
                return;
              }

              if (methodName === 'initialize') {
                const requestedVersion =
                  (parsed?.params?.protocolVersion as string | undefined) ||
                  (parsed?.params?.protocol_version as string | undefined) ||
                  '2024-11-05';

                const serverVersion =
                  process.env.APP_VERSION ||
                  process.env.RAILWAY_GIT_COMMIT_SHA ||
                  VERSION_INFO.commit ||
                  'dev';

                const result = {
                  protocolVersion: requestedVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: 'SignupAssist MCP', version: serverVersion },
                };

                console.log(`[MCP] /sse discovery initialize (HTTP 200) protocolVersion=${requestedVersion}`);

                res.writeHead(200, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store',
                });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed?.id ?? 0,
                    result,
                  })
                );
                return;
              }

              // JSON-RPC notifications are fire-and-forget; return quickly so we don't
              // accidentally open a long-lived SSE stream after consuming a JSON body.
              if (methodName.startsWith('notifications/')) {
                res.writeHead(204, {
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store',
                });
                res.end();
                return;
              }

              // --------------------------------------------------------------
              // tools/call compatibility: Some clients POST tools/call directly
              // to /sse and expect a finite JSON-RPC response (not an SSE stream).
              //
              // If we open an SSE stream here, we may emit an eager tools/list
              // message whose `id` can collide with the tools/call request id,
              // causing ChatGPT validation errors like:
              //   "missing required content field"
              // --------------------------------------------------------------
              if (methodName === 'tools/call') {
                const toolName = parsed?.params?.name ? String(parsed.params.name) : '';

                // Enforce OAuth for tool calls in production
                const isProd = process.env.NODE_ENV === 'production';
                const authHeader = req.headers['authorization'] as string | undefined;
                const expectedToken = process.env.MCP_ACCESS_TOKEN;

                let isAuthorized = false;
                let authSource: 'mcp_access_token' | 'auth0' | 'dev' | 'none' = 'none';
                let verifiedUserId: string | undefined;

                if (!isProd) {
                  isAuthorized = true;
                  authSource = 'dev';
                } else {
                  if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
                    isAuthorized = true;
                    authSource = 'mcp_access_token';
                  } else {
                    const bearerToken = extractBearerToken(authHeader);
                    if (bearerToken) {
                      try {
                        const payload = await verifyAuth0Token(bearerToken);
                        // Map Auth0 subject → Supabase auth UUID for DB writes.
                        verifiedUserId = await this.resolveSupabaseUserIdFromAuth0(payload);
                        isAuthorized = true;
                        authSource = 'auth0';
                      } catch (e: any) {
                        console.warn('[AUTH] Auth0 JWT rejected for /sse tools/call:', e?.message);
                      }
                    }
                  }
                }

                const allowUnauthReadonly =
                  isAllowUnauthReadonlyToolsEnabled() &&
                  isUnauthReadonlyToolAllowed(toolName);

                if (isProd && !isAuthorized && !allowUnauthReadonly) {
                  const baseUrl = getRequestBaseUrl(req);
                  res.writeHead(401, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                    "WWW-Authenticate": `Bearer realm="signupassist", error="authentication_required", authorization_uri="${baseUrl}/oauth/authorize", token_uri="${baseUrl}/oauth/token"`,
                  });
                  res.end(JSON.stringify({ error: "authentication_required", message: "OAuth token required" }));
                  console.log('[AUTH] Unauthorized tools/call via POST /sse (OAuth required)');
                  return;
                }

                if (!toolName || !this.tools.has(toolName)) {
                  res.writeHead(404, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                  });
                  res.end(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: parsed?.id ?? 1,
                      error: {
                        code: -32601,
                        message: `Tool ${toolName || '(missing)'} not found`,
                      },
                    })
                  );
                  return;
                }

                const rawArgs = (parsed?.params?.arguments ?? {}) as any;
                const argsObj =
                  rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};

                // Inject Auth0-derived userId for canonical chat tool so APIOrchestrator can persist per-user.
                // Also ensure `sessionId` exists (ChatGPT occasionally omits it in some refresh/invoke flows).
                if (toolName === 'signupassist.chat') {
                  if (verifiedUserId) argsObj.userId = verifiedUserId;
                  if (!argsObj.sessionId) argsObj.sessionId = verifiedUserId || 'chatgpt';
                }

                let toolResult: any;
                try {
                  if (isMcpRefreshDebugEnabled()) {
                    console.log(`[DEBUG_MCP_REFRESH] /sse tools/call (sync) tool=${toolName} auth=${authSource}`);
                  }
                  const tool = this.tools.get(toolName)!;
                  const raw = await tool.handler(argsObj);
                  toolResult = mcpOk(raw);
                } catch (err: any) {
                  console.error(`[MCP] /sse tools/call failed (sync) tool=${toolName}:`, err);
                  toolResult = mcpError(`Tool ${toolName} failed`, {
                    message: err?.message,
                    stack: err?.stack,
                  });
                }

                res.writeHead(200, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store',
                });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed?.id ?? 1,
                    result: toolResult,
                  })
                );
                return;
              }

              // Guardrail: if a client POSTs JSON-RPC to /sse with an unsupported method,
              // respond with a finite JSON-RPC error instead of falling through into an SSE stream.
              if (methodName) {
                res.writeHead(400, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store',
                });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed?.id ?? null,
                    error: {
                      code: -32601,
                      message: `Method not found: ${methodName}`,
                    },
                  })
                );
                return;
              }
            }
          }

          // ================================================================
          // AUTH (PRODUCTION): Require OAuth (Auth0 JWT) or internal MCP_ACCESS_TOKEN
          // ================================================================
          const isProd = process.env.NODE_ENV === 'production';
          const authHeader = req.headers['authorization'] as string | undefined;
          const expectedToken = process.env.MCP_ACCESS_TOKEN;

          let isAuthorized = false;
          let authSource: 'mcp_access_token' | 'auth0' | 'dev' | 'none' = 'none';
          let boundUserId: string | undefined;

          if (!isProd) {
            isAuthorized = true;
            authSource = 'dev';
          } else {
            // Internal service token path (ops / scripts)
            if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
              isAuthorized = true;
              authSource = 'mcp_access_token';
            } else {
              // Auth0 JWT access token path (ChatGPT OAuth)
              const bearerToken = extractBearerToken(authHeader);
              if (bearerToken) {
                try {
                  const payload = await verifyAuth0Token(bearerToken);
                  // Map Auth0 subject → Supabase auth UUID for DB writes.
                  boundUserId = await this.resolveSupabaseUserIdFromAuth0(payload);
                  isAuthorized = true;
                  authSource = 'auth0';
                } catch (e: any) {
                  console.warn('[AUTH] Auth0 JWT rejected for /sse:', e?.message);
                }
              }
            }
          }

          // Auth posture:
          // - GET /sse:
          //   - If unauthenticated, return a fast 401 + WWW-Authenticate header (so ChatGPT can discover OAuth config)
          //     and to avoid holding a never-ending SSE stream open during validation.
          // - POST /sse:
          //   - Allow unauthenticated connect for "refresh" flows, but still enforce OAuth for consequential calls
          //     (see POST /messages tools/call handling).
          if (!isAuthorized) {
            // Auth posture (compat with ChatGPT connector):
            // - GET /sse: return fast 401 + WWW-Authenticate (avoids hanging SSE during validation)
            // - POST /sse:
            //    - If it's a real SSE request (Accept: text/event-stream), allow unauthenticated connect
            //      so ChatGPT can refresh/connect and then OAuth at tool-call time.
            //    - Otherwise, return fast 401 to avoid probe timeouts.
            if (req.method === 'GET') {
              const baseUrl = getRequestBaseUrl(req);
              res.writeHead(401, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                "WWW-Authenticate": `Bearer realm="signupassist", error="authentication_required", authorization_uri="${baseUrl}/oauth/authorize", token_uri="${baseUrl}/oauth/token"`,
              });
              res.end(JSON.stringify({ error: "authentication_required", message: "OAuth token required" }));
              console.log('[AUTH] Unauthorized GET /sse (OAuth required; avoiding long-lived SSE during validation)');
              return;
            }

            const accept = String(req.headers['accept'] || '');
            if (!accept.toLowerCase().includes('text/event-stream')) {
              const baseUrl = getRequestBaseUrl(req);
              res.writeHead(401, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                "WWW-Authenticate": `Bearer realm="signupassist", error="authentication_required", authorization_uri="${baseUrl}/oauth/authorize", token_uri="${baseUrl}/oauth/token"`,
              });
              res.end(JSON.stringify({ error: "authentication_required", message: "OAuth token required" }));
              console.log('[AUTH] Unauthorized POST /sse probe (non-SSE Accept; avoiding long-lived SSE during validation)');
              return;
            }

            console.log('[AUTH] Allowing unauthenticated POST /sse (SSE Accept); tools/call still requires OAuth');
          } else {
            console.log(`[AUTH] Authorized SSE connection via ${authSource}${boundUserId ? ` user=${boundUserId}` : ''}`);
          }

          // Limit concurrent SSE streams per auth token (or per IP when unauthenticated).
          // This protects the server from retry storms without penalizing other users (token-hash keyed).
          const sseKey = getRateLimitKey(req);
          const maxActiveRaw = Number(process.env.SSE_MAX_ACTIVE || 5);
          const maxActive = Number.isFinite(maxActiveRaw) && maxActiveRaw > 0 ? Math.max(1, Math.min(maxActiveRaw, 50)) : 5;
          const currentActive = activeSseByKey.get(sseKey) || 0;
          if (isRateLimitEnabled() && currentActive >= maxActive) {
            res.writeHead(429, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
              'Retry-After': '5',
            });
            res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many active connections. Please retry shortly.' }));
            return;
          }
          activeSseByKey.set(sseKey, currentActive + 1);
          let sseSlotReleased = false;
          releaseSseSlot = () => {
            if (sseSlotReleased) return;
            sseSlotReleased = true;
            const next = Math.max(0, (activeSseByKey.get(sseKey) || 1) - 1);
            if (next === 0) activeSseByKey.delete(sseKey);
            else activeSseByKey.set(sseKey, next);
          };

          // Create SSE transport - it will set its own headers.
          // IMPORTANT: ChatGPT appears to treat `/sse` as a base path in some probes.
          // Advertise the message endpoint under `/sse/messages` for maximum compatibility.
          const transport = new SSEServerTransport('/sse/messages', res);
          
          // ✅ connect() calls start() internally - do NOT call start() manually!
          await this.server.connect(transport);
          
          // ✅ Use the transport's built-in sessionId (not our own UUID)
          const sessionId = transport.sessionId;
          this.sseTransports.set(sessionId, transport);

          // Bind sessionId → Auth0 sub for downstream /messages injection
          if (boundUserId) {
            this.sseSessionUserIds.set(sessionId, boundUserId);
          }

          // Compatibility: some server-side clients treat the "endpoint" event as a full URL, not a path.
          // SSEServerTransport emits a relative path; we additionally emit an absolute URL.
          try {
            const baseUrl = getRequestBaseUrl(req);
            res.write(`event: endpoint\n`);
            res.write(`data: ${baseUrl}/sse/messages?sessionId=${sessionId}\n\n`);
          } catch {
            // ignore
          }

          // Eager discovery: emit a tools/list result on connect so refresh flows can succeed
          // even if the client never sends a follow-up POST /messages.
          try {
            const includePrivate = process.env.MCP_LISTTOOLS_INCLUDE_PRIVATE === 'true';
            const apiTools = Array.from(this.tools.values())
              .filter((tool) => tool?._meta?.["openai/visibility"] !== "private")
              .map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                _meta: tool._meta,
              }));
            const visibleTools = includePrivate
              ? apiTools
              : apiTools.filter((t) => t._meta?.["openai/visibility"] === "public");

            const msg = {
              jsonrpc: '2.0',
              // Use a non-numeric id to avoid colliding with client request ids (many clients start at 1).
              id: 'eager-tools-list',
              result: { tools: visibleTools },
            };
            res.write(`event: message\n`);
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
            console.log(`[MCP] /sse eager tools/list emitted (${visibleTools.length} tools)`);
            if (isMcpRefreshDebugEnabled()) {
              console.log(`[DEBUG_MCP_REFRESH] /sse eager tools/list emitted (tools=${visibleTools.length})`);
            }
          } catch {
            // ignore
          }
          
          console.log(`[SSE] MCP server connected, session: ${sessionId}`);
          console.log(`[SSE] Active sessions: ${this.sseTransports.size}`);
          
          // Keep-alive: some proxies/clients are sensitive to "silent" SSE streams.
          // Send a lightweight comment heartbeat so the connection stays warm.
          const keepAlive = setInterval(() => {
            try {
              res.write(`:keep-alive\n\n`);
            } catch {
              // ignore
            }
          }, 15000);

          // Handle connection close (prefer response close; req close can fire in odd edge cases).
          let cleanedUp = false;
          const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            releaseSseSlot?.();
            clearInterval(keepAlive);
            console.log(`[SSE] Connection closed: ${sessionId}`);
            this.sseTransports.delete(sessionId);
            this.sseSessionUserIds.delete(sessionId);
            console.log(`[SSE] Remaining sessions: ${this.sseTransports.size}`);
          };

          res.on('close', cleanup);
          req.on('aborted', cleanup);
          
        } catch (error) {
          console.error(`[SSE] Failed to setup SSE transport:`, error);
          // If we reserved an active SSE slot but failed to establish the stream, release it.
          releaseSseSlot?.();
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to establish SSE connection' }));
          }
        }
        
        // Keep the connection open (don't call res.end())
        return;
      }
      
      // --- SSE Message Endpoint (POST /messages)
      // Receives JSON-RPC messages from ChatGPT and forwards to the SSE transport
      if (req.method === 'POST' && (url.pathname === '/messages' || url.pathname === '/sse/messages')) {
        console.log('[SSE] Received POST /messages');
        
        try {
          // Read request body (needed to decide whether auth / SSE is required)
          const maxBytes = normalizeMaxBodyBytes(process.env.MAX_MESSAGES_BODY_BYTES, 256 * 1024);
          const body = await readBodyWithLimit(req, maxBytes);
          // PROD SAFETY: do not log raw message bodies (can contain PII like email/DOB).
          // Enable extra debugging only via DEBUG_LOGGING + DEBUG_SESSION_ID/DEBUG_USER_ID,
          // and even then only log redacted summaries (not raw bodies).

          let parsed: any = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            // leave null; transport will handle parse errors when possible
          }

          const methodName = parsed?.method ? String(parsed.method) : '';
          const isToolCall = methodName === 'tools/call';
          const isDiscoveryCall = methodName === 'tools/list' || methodName === 'initialize';

          // Targeted debug logging (always redacted). Never log raw message bodies in prod.
          // NOTE: We may not have verifiedUserId until after auth; we re-check below after auth.
          const maybeToolName = parsed?.params?.name ? String(parsed.params.name) : undefined;
          const isProd = process.env.NODE_ENV === 'production';
          if (isDebugLoggingEnabled() && !isProd) console.log('[DEBUG] /messages (dev) method:', methodName, 'tool:', maybeToolName);

          // Get session ID from query parameter (set by SSEServerTransport).
          // IMPORTANT: For discovery calls (initialize/tools/list), some clients omit sessionId.
          // We intentionally allow discovery without a live SSE transport so refresh flows don't time out.
          const sessionId = url.searchParams.get('sessionId');
          if (isMcpRefreshDebugEnabled()) {
            const sid = sessionId ? `${sessionId.slice(0, 8)}…` : 'none';
            const hasAuth = !!req.headers['authorization'];
            console.log(
              `[DEBUG_MCP_REFRESH] /messages path=${url.pathname} methodName=${methodName || 'unknown'} tool=${maybeToolName || ''} sessionId=${sid} hasAuth=${hasAuth}`
            );
          }

          // MCP discovery compatibility: respond synchronously (HTTP 200 + JSON-RPC body).
          // This avoids relying on a live SSE stream during ChatGPT refresh_actions.
          if (isDiscoveryCall) {
            if (methodName === 'tools/list') {
              const includePrivate = process.env.MCP_LISTTOOLS_INCLUDE_PRIVATE === 'true';
              const apiTools = Array.from(this.tools.values())
                .filter((tool) => tool?._meta?.["openai/visibility"] !== "private")
                .map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema,
                  _meta: tool._meta,
                }));

              const visibleTools = includePrivate
                ? apiTools
                : apiTools.filter((t) => t._meta?.["openai/visibility"] === "public");

              console.log(
                `[MCP] /messages discovery tools/list (HTTP 200) returning ${visibleTools.length} tools (${includePrivate ? "all" : "public-only"}):`,
                visibleTools.map((t) => t.name)
              );
              if (isMcpRefreshDebugEnabled()) {
                console.log(`[DEBUG_MCP_REFRESH] /messages tools/list -> 200 (sessionIdPresent=${!!sessionId})`);
              }

              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store',
              });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: parsed?.id ?? 1,
                  result: { tools: visibleTools },
                })
              );
              return;
            }

            if (methodName === 'initialize') {
              const requestedVersion =
                (parsed?.params?.protocolVersion as string | undefined) ||
                (parsed?.params?.protocol_version as string | undefined) ||
                '2024-11-05';

              const serverVersion =
                process.env.APP_VERSION ||
                process.env.RAILWAY_GIT_COMMIT_SHA ||
                VERSION_INFO.commit ||
                'dev';

              const result = {
                protocolVersion: requestedVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'SignupAssist MCP', version: serverVersion },
              };

              console.log(`[MCP] /messages discovery initialize (HTTP 200) protocolVersion=${requestedVersion}`);
              if (isMcpRefreshDebugEnabled()) {
                console.log(`[DEBUG_MCP_REFRESH] /messages initialize -> 200 (sessionIdPresent=${!!sessionId})`);
              }

              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store',
              });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: parsed?.id ?? 0,
                  result,
                })
              );
              return;
            }
          }

          if (!sessionId) {
            console.error('[SSE] No sessionId in /messages request');
            if (isMcpRefreshDebugEnabled()) {
              console.log(`[DEBUG_MCP_REFRESH] /messages missing sessionId -> 400 methodName=${methodName || 'unknown'}`);
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
            return;
          }

          // ================================================================
          // AUTH (PRODUCTION): Require OAuth (Auth0 JWT) or internal MCP_ACCESS_TOKEN
          // Also: bind / refresh sessionId → userId mapping so we can inject into tools.
          // ================================================================
          const authHeader = req.headers['authorization'] as string | undefined;
          const expectedToken = process.env.MCP_ACCESS_TOKEN;

          let isAuthorized = false;
          let authSource: 'mcp_access_token' | 'auth0' | 'dev' | 'none' = 'none';
          let verifiedUserId: string | undefined;

          if (!isProd) {
            isAuthorized = true;
            authSource = 'dev';
          } else {
            if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
              isAuthorized = true;
              authSource = 'mcp_access_token';
            } else {
              const bearerToken = extractBearerToken(authHeader);
              if (bearerToken) {
                try {
                  const payload = await verifyAuth0Token(bearerToken);
                  // Map Auth0 subject → Supabase auth UUID for DB writes.
                  verifiedUserId = await this.resolveSupabaseUserIdFromAuth0(payload);
                  isAuthorized = true;
                  authSource = 'auth0';
                } catch (e: any) {
                  console.warn('[AUTH] Auth0 JWT rejected for /messages:', e?.message);
                }
              }
            }
          }

          if (shouldDebugForMcpMessage(parsed, verifiedUserId)) {
            const summary = {
              method: methodName,
              tool: maybeToolName,
              sessionId,
              auth: authSource,
            };
            console.log('[DEBUG] /messages summary:', redactForLogs(JSON.stringify(summary)));
          }

          // Only require auth for consequential calls.
          // Allow initialize/tools/list without auth so the client can connect and then OAuth at tool-call time.
          //
          // Additionally, allow a very small set of read-only tools to be called without OAuth
          // (guarded by env flag + allowlist) to improve discovery UX.
          const allowUnauthReadonly =
            isAllowUnauthReadonlyToolsEnabled() &&
            !!maybeToolName &&
            isUnauthReadonlyToolAllowed(maybeToolName);

          if (isProd && isToolCall && !isAuthorized && !allowUnauthReadonly) {
            const host =
              (req.headers['x-forwarded-host'] as string | undefined) ||
              (req.headers['host'] as string | undefined);
            const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined);
            const proto =
              forwardedProto ||
              (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
            const baseUrl =
              host
                ? `${proto}://${host}`
                : (process.env.RAILWAY_PUBLIC_DOMAIN
                    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                    : `https://signupassist-mcp-production.up.railway.app`);

            res.writeHead(401, {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
              // Include endpoints to help clients locate OAuth flows.
              "WWW-Authenticate": `Bearer realm="signupassist", error="authentication_required", authorization_uri="${baseUrl}/oauth/authorize", token_uri="${baseUrl}/oauth/token"`,
            });
            res.end(JSON.stringify({ error: "authentication_required", message: "OAuth token required" }));
            console.log('[AUTH] Unauthorized tool call attempt via /messages (OAuth required)');
            if (isMcpRefreshDebugEnabled()) {
              console.log(`[DEBUG_MCP_REFRESH] /messages tools/call unauthorized -> 401 sessionId=${sessionId.slice(0, 8)}…`);
            }
            return;
          }

          // Persist a user binding for this SSE session if we have it.
          if (verifiedUserId) {
            this.sseSessionUserIds.set(sessionId, verifiedUserId);
          }
          
          const transport = this.sseTransports.get(sessionId);
          
          if (!transport) {
            // Compatibility: some clients open /sse briefly, then POST /messages after the SSE stream
            // has already closed. For non-consequential calls (tools/list), return the result directly
            // in the HTTP response so clients don't need a live SSE stream to refresh actions.
            if (methodName === 'tools/list') {
              const includePrivate = process.env.MCP_LISTTOOLS_INCLUDE_PRIVATE === 'true';
              const apiTools = Array.from(this.tools.values())
                .filter((tool) => tool?._meta?.["openai/visibility"] !== "private")
                .map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema,
                  _meta: tool._meta,
                }));
              const visibleTools = includePrivate
                ? apiTools
                : apiTools.filter((t) => t._meta?.["openai/visibility"] === "public");

              console.log(
                `[MCP] /messages fallback tools/list (no transport) returning ${visibleTools.length} tools (${includePrivate ? "all" : "public-only"}):`,
                visibleTools.map((t) => t.name)
              );

              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store',
              });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: parsed?.id ?? 1,
                  result: { tools: visibleTools },
                })
              );
              return;
            }

            console.error(`[SSE] No transport found for session: ${sessionId}`);
            if (isMcpRefreshDebugEnabled()) {
              console.log(`[DEBUG_MCP_REFRESH] /messages no transport -> 404 methodName=${methodName || 'unknown'} sessionId=${sessionId.slice(0, 8)}…`);
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found. Please reconnect to /sse' }));
            return;
          }

          // Inject Auth0 userId into canonical chat tool calls so APIOrchestrator can persist per-user.
          // (Do not trust client-supplied userId in production; overwrite with verified binding.)
          const boundUserId = this.sseSessionUserIds.get(sessionId) || verifiedUserId;
          let bodyToForward = body;
          if (boundUserId) {
            try {
              const msg = parsed || JSON.parse(body);
              if (
                msg?.method === 'tools/call' &&
                msg?.params?.name === 'signupassist.chat' &&
                msg?.params
              ) {
                msg.params.arguments = msg.params.arguments || {};
                if (isProd) {
                  msg.params.arguments.userId = boundUserId;
                } else if (!msg.params.arguments.userId) {
                  msg.params.arguments.userId = boundUserId;
                }
                if (!msg.params.arguments.sessionId) {
                  // Ensure required `sessionId` exists; fall back to SSE sessionId.
                  msg.params.arguments.sessionId = sessionId;
                }
                bodyToForward = JSON.stringify(msg);
              }
            } catch {
              // If parsing fails, forward original body unchanged.
            }
          }
          
          // Forward the message to the SSE transport
          await transport.handlePostMessage(req, res, bodyToForward);
          console.log(`[SSE] Message handled for session: ${sessionId}`);
          if (isMcpRefreshDebugEnabled()) {
            console.log(`[DEBUG_MCP_REFRESH] /messages forwarded -> 202 methodName=${methodName || 'unknown'} sessionId=${sessionId.slice(0, 8)}…`);
          }
          
        } catch (error: any) {
          if (error?.code === 'BODY_TOO_LARGE') {
            res.writeHead(413, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({ error: 'payload_too_large', message: 'Request body too large' }));
            return;
          }
          console.error('[SSE] Error handling message:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to process message', details: error?.message }));
        }
        return;
      }
      
      // ==================== END MCP SSE TRANSPORT ENDPOINTS ====================

      // --- Health check endpoint (includes version info for deploy verification)
      // Railway healthchecks may use GET or HEAD depending on platform/router behavior.
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
        console.log('[HEALTH] check received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify({
          ok: true,
          version: process.env.APP_VERSION || '2.1.1-full-gating',
          build_id: process.env.APP_BUILD_ID || '2025-06-22T02:30:00Z',
          git_commit: VERSION_INFO.commit,
          started_at: VERSION_INFO.builtAt,
          useNewAAP: VERSION_INFO.useNewAAP,
          ts: Date.now()
        }));
        return;
      }

      // --- Status endpoint - returns build info for debugging deployments
      if (req.method === 'GET' && url.pathname === '/status') {
        console.log('[STATUS] build info request received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          build: {
            build_id: process.env.APP_BUILD_ID || '2025-06-22T02:30:00Z',
            orchestrator_mode: 'api-first',
            version: process.env.APP_VERSION || '2.1.1-full-gating',
            step_gating: true
          },
          server: {
            env: process.env.NODE_ENV || 'unknown',
            git_commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'dev',
            started_at: VERSION_INFO.builtAt,
            node_version: process.version
          },
          timestamp: new Date().toISOString()
        }));
        return;
      }
      
      // --- Keep-warm ping endpoint to prevent cold starts
      if (req.method === 'GET' && url.pathname === '/ping') {
        console.log('[PING] keep-warm request received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now() }));
        return;
      }

      // --- Identity endpoint for backend verification
      if (req.method === 'GET' && url.pathname === '/identity') {
        console.log('[IDENTITY] backend identity request received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          env: process.env.NODE_ENV || 'unknown',
          git_commit: process.env.GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
          timestamp: new Date().toISOString(),
          backend: 'Railway Production MCP'
        }));
        return;
      }

      // --- Bookeo Debug Endpoint - Tests Bookeo API credentials from Railway
      if (req.method === 'GET' && url.pathname === '/bookeo-debug') {
        console.log('[DEBUG] Bookeo credentials test request received');
        
        try {
          const apiKey = process.env.BOOKEO_API_KEY;
          const secretKey = process.env.BOOKEO_SECRET_KEY;

          if (!apiKey || !secretKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: "Missing Bookeo API key or secret key in Railway environment variables"
            }));
            return;
          }

          // Build the Bookeo API URL EXACTLY like your working curl
          const debugUrl = new URL('https://api.bookeo.com/v2/settings/apikeyinfo');
          debugUrl.searchParams.set('apiKey', apiKey);
          debugUrl.searchParams.set('secretKey', secretKey);

          if (isDebugLoggingEnabled()) {
            console.log('[DEBUG] Calling Bookeo: /v2/settings/apikeyinfo (apiKey/secretKey redacted)');
          }

          const r = await fetch(debugUrl, { method: 'GET' });
          const text = await r.text();

          if (isDebugLoggingEnabled()) {
            console.log('[DEBUG] Bookeo response status:', r.status, 'body_len:', text.length);
          }

          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(text);
        } catch (err: any) {
          console.error('[DEBUG] Bookeo error:', err?.message || err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Unexpected failure' }));
        }
        return;
      }

      // ==================== BOOKEO BOOKING ENDPOINTS (DEPRECATED) ====================
      // These endpoints are now handled by MCP tools in mcp_server/providers/bookeo.ts
      // Kept for backward compatibility only
      
      // --- GET /list-programs - DEPRECATED: Use bookeo.find_programs tool instead
      if (req.method === 'GET' && url.pathname === '/list-programs') {
        console.log('[BOOKEO] List programs request received');
        
        try {
          const nowIso = new Date().toISOString();
          
          // Fetch programs from cached_provider_feed table
          const { data: programs, error } = await supabase
            .from('cached_provider_feed')
            .select('program_ref, program, org_ref, category')
            .eq('org_ref', 'bookeo-default')
            .order('cached_at', { ascending: false });
          
          if (error) {
            console.error('[BOOKEO] DB error on list-programs:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch programs' }));
            return;
          }
          
          if (!programs || programs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: "carousel", items: [] }));
            return;
          }
          
          // Transform programs into ChatGPT carousel format
          const carouselItems = programs
            .filter((p: any) => {
              const prog = p.program;
              // Filter for active, open programs with future dates
              const startTime = prog.next_available || prog.signup_start_time;
              return prog.status === 'Open' && 
                     prog.active !== false && 
                     startTime && 
                     new Date(startTime) > new Date();
            })
            .slice(0, 8) // Limit to 8 items per ChatGPT best practices
            .map((p: any) => {
              const prog = p.program;
              const startTime = prog.next_available || prog.signup_start_time;
              const seats = prog.max_participants || prog.available_slots || 0;
              const emoji = prog.emoji || '🎯';
              const price = prog.price || null;
              
              return {
                title: `${emoji} ${prog.title || prog.name}`,
                subtitle: `${new Date(startTime).toLocaleDateString()} @ ${new Date(startTime).toLocaleTimeString()} – ${seats} seats left`,
                image_url: prog.image_url || prog.imageUrl || prog.thumbnail || getPlaceholderImage(prog.title || prog.name || '', prog.category),
                action: {
                  label: "Reserve Spot",
                  tool: "create_hold",
                  input: {
                    eventId: p.program_ref,
                    productId: p.program_ref.split('_')[0] || p.program_ref,
                    adults: 1,
                    children: 0,
                    firstName: "<YourFirstName>",
                    lastName: "<YourLastName>",
                    email: "you@example.com",
                    phone: "<YourPhone>"
                  }
                }
              };
            });
          
          console.log(`[BOOKEO] Returning carousel with ${carouselItems.length} programs`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: "carousel",
            items: carouselItems
          }));
        } catch (err: any) {
          console.error('[BOOKEO] Unexpected error on list-programs:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server error' }));
        }
        return;
      }
      
      // ==================== END BOOKEO ENDPOINTS ====================



      // --- Get user location via ipapi.co
      if (req.method === 'GET' && url.pathname === '/get-user-location') {
        console.log('[LOCATION] User location request received');
        
        try {
          const apiKey = process.env.IPAPI_KEY;

          if (!apiKey) {
            const env = (process.env.NODE_ENV || "").toLowerCase();
            const isDev = env === "development";

            if (!isDev) {
              console.error("[get-user-location] CRITICAL: IPAPI_KEY missing in production");
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: "IPAPI_KEY not configured",
                mock: true,
                reason: "missing_ipapi_key"
              }));
              return;
            }

            console.warn('[LOCATION] IPAPI_KEY not configured - returning mock Madison location for dev');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin",
              country: "US",
              mock: true,
              reason: "no_api_key"
            }));
            return;
          }

          // Extract client IP (Railway / proxies)
          let clientIp = req.headers['x-forwarded-for'] as string | undefined;
          if (Array.isArray(clientIp)) clientIp = clientIp[0];
          if (!clientIp) {
            clientIp = req.socket.remoteAddress;
          }

          // Strip IPv6 prefix "::ffff:"
          if (clientIp && clientIp.startsWith('::ffff:')) {
            clientIp = clientIp.replace('::ffff:', '');
          }

          // Handle localhost
          if (!clientIp || clientIp === '127.0.0.1' || clientIp === '::1') {
            console.log('[LOCATION] Localhost detected - returning mock location');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "localhost",
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          if (isDebugLoggingEnabled()) {
            console.log(`[LOCATION] Looking up IP (redacted)`);
          }
          const apiUrl = `https://ipapi.co/${clientIp}/json/?key=${apiKey}`;
          const response = await fetch(apiUrl);

          if (!response.ok) {
            console.error(`[LOCATION] ipapi.co error: ${response.status}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "ipapi_http_error",
              status: response.status,
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          const data = await response.json();

          if (!data || data.error || data.latitude === undefined || data.longitude === undefined) {
            console.error('[LOCATION] Invalid ipapi.co response');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "ipapi_invalid_response",
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          console.log(`[LOCATION] ✅ Real location: ${data.city}, ${data.region}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            lat: data.latitude,
            lng: data.longitude,
            city: data.city,
            region: data.region,
            country: data.country_name,
            mock: false
          }));
        } catch (err: any) {
          console.error('[LOCATION] Exception:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            mock: true,
            reason: "ipapi_exception",
            error: err.message,
            lat: 43.0731,
            lng: -89.4012,
            city: "Madison",
            region: "Wisconsin"
          }));
        }
        return;
      }

      // --- Serve manifest.json at /mcp/manifest.json
      // NOTE: Some clients probe with HEAD during validation.
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/mcp/manifest.json') {
        try {
          if (req.method === 'HEAD') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store, no-cache, must-revalidate'
            });
            res.end();
            return;
          }

          // For "apps via MCP", the authoritative manifest is:
          //   /.well-known/chatgpt-apps-manifest.json
          // We serve the SAME content here to avoid confusion with legacy OpenAPI manifests.
          const manifestPath = path.resolve(process.cwd(), 'public', '.well-known', 'chatgpt-apps-manifest.json');

          const content = existsSync(manifestPath)
            ? readFileSync(manifestPath, 'utf-8')
            : JSON.stringify(
                {
                  schema_version: "1.0.0",
                  name_for_human: "SignupAssist",
                  name_for_model: "signupassist",
                  description_for_human: "SignupAssist helps parents discover, schedule, and complete class signups for their children."
                },
                null,
                2
              );

          // Rewrite URLs to match the current request host (avoids cross-domain OAuth issues).
          const host =
            (req.headers['x-forwarded-host'] as string | undefined) ||
            (req.headers['host'] as string | undefined);
          const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined);
          const proto =
            forwardedProto ||
            (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
          const baseUrl =
            host
              ? `${proto}://${host}`
              : 'https://signupassist-mcp-production.up.railway.app';

          let out = content;
          try {
            const json = JSON.parse(content);
            if (json?.auth?.type === 'oauth') {
              json.auth.authorization_url = `${baseUrl}/oauth/authorize`;
              json.auth.token_url = `${baseUrl}/oauth/token`;
            }
            if (json?.api?.type === 'mcp') {
              json.api.server_url = `${baseUrl}/sse`;
            }
            json.logo_url = `${baseUrl}/logo-512.svg`;
            json.legal_info_url = `${baseUrl}/privacy`;
            out = JSON.stringify(json, null, 2);
          } catch (e: any) {
            console.warn('[MANIFEST] Failed to rewrite /mcp/manifest.json URLs:', e?.message);
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          res.end(out);
          console.log('[ROUTE] Served MCP manifest at /mcp/manifest.json');
        } catch (error: any) {
          console.error('[MANIFEST ERROR]', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load manifest', details: error.message }));
        }
        return;
      }

      // --- Serve manifest JSON directly at /mcp (ChatGPT OAuth discovery)
      // NOTE: Some clients probe with HEAD during validation.
      if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/mcp' || url.pathname === '/mcp/')) {
        try {
          if (req.method === 'HEAD') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store, no-cache, must-revalidate'
            });
            res.end();
            return;
          }

          // Keep /mcp aligned with the MCP app manifest to avoid multiple sources of truth.
          const manifestPath = path.resolve(process.cwd(), 'public', '.well-known', 'chatgpt-apps-manifest.json');

          const content = existsSync(manifestPath)
            ? readFileSync(manifestPath, 'utf-8')
            : JSON.stringify(
                {
                  schema_version: "1.0.0",
                  name_for_human: "SignupAssist",
                  name_for_model: "signupassist",
                  description_for_human: "SignupAssist helps parents discover, schedule, and complete class signups for their children."
                },
                null,
                2
              );

          const host =
            (req.headers['x-forwarded-host'] as string | undefined) ||
            (req.headers['host'] as string | undefined);
          const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined);
          const proto =
            forwardedProto ||
            (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
          const baseUrl =
            host
              ? `${proto}://${host}`
              : 'https://signupassist-mcp-production.up.railway.app';

          let out = content;
          try {
            const json = JSON.parse(content);
            if (json?.auth?.type === 'oauth') {
              json.auth.authorization_url = `${baseUrl}/oauth/authorize`;
              json.auth.token_url = `${baseUrl}/oauth/token`;
            }
            if (json?.api?.type === 'mcp') {
              json.api.server_url = `${baseUrl}/sse`;
            }
            json.logo_url = `${baseUrl}/logo-512.svg`;
            json.legal_info_url = `${baseUrl}/privacy`;
            out = JSON.stringify(json, null, 2);
          } catch (e: any) {
            console.warn('[MANIFEST] Failed to rewrite /mcp URLs:', e?.message);
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          res.end(out);
        } catch (error: any) {
          console.error('[MCP ROOT ERROR]', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load manifest', details: error.message }));
        }
        return;
      }

      // --- Serve OpenAPI spec at /mcp/openapi.json AND /openapi.json AND /.well-known/openapi.json
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (url.pathname === '/mcp/openapi.json' ||
          url.pathname === '/openapi.json' ||
          url.pathname === '/.well-known/openapi.json')
      ) {
        if (isMcpOnlyMode()) {
          respondOpenApiDisabled(req, res, url.pathname);
          return;
        }
        try {
          // Prefer source OpenAPI to avoid stale dist artifacts (Railway cache)
          let openapiPath = path.resolve(process.cwd(), 'mcp', 'openapi.json');
          if (!existsSync(openapiPath)) {
            // Fallback: dist build output
            openapiPath = path.resolve(process.cwd(), 'dist', 'mcp', 'openapi.json');
          }
          if (!existsSync(openapiPath)) {
            // Last resort: try relative path
            openapiPath = './mcp/openapi.json';
          }
          console.log('[DEBUG] Using OpenAPI spec at:', openapiPath, 'exists:', existsSync(openapiPath));

          const specText = readFileSync(openapiPath, 'utf8');

          // Ensure GPT Builder "same root domain" requirement by forcing OAuth URLs to our proxy.
          // (We rewrite at response-time to prevent stale build artifacts from leaking Auth0 URLs.)
          let out = specText;
          try {
            const specJson = JSON.parse(specText);
            const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
            const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers['host'] as string | undefined);
            const baseUrl = host ? `${proto}://${host}` : 'https://signupassist-mcp-production.up.railway.app';

            if (Array.isArray(specJson.servers) && specJson.servers[0]?.url) {
              specJson.servers[0].url = baseUrl;
            }

            const schemes = specJson?.components?.securitySchemes;
            if (schemes && typeof schemes === 'object') {
              for (const scheme of Object.values(schemes as Record<string, any>)) {
                const authCode = scheme?.flows?.authorizationCode;
                if (authCode) {
                  authCode.authorizationUrl = `${baseUrl}/oauth/authorize`;
                  authCode.tokenUrl = `${baseUrl}/oauth/token`;
                }
              }
            }

            out = JSON.stringify(specJson, null, 2);
          } catch (e: any) {
            console.warn('[OPENAPI] Failed to rewrite OAuth URLs:', e?.message);
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          if (req.method === 'HEAD') {
            res.end();
            console.log('[ROUTE] Served', url.pathname, '(HEAD)');
            return;
          }
          res.end(out);
          console.log('[ROUTE] Served', url.pathname);
        } catch (error: any) {
          console.error('[OPENAPI ERROR]', error);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'OpenAPI spec not found',
            details: error.message,
            cwd: process.cwd()
          }));
        }
        return;
      }

      // NOTE: /.well-known/ai-plugin.json is served later from `public/.well-known/ai-plugin.json`
      // (kept for legacy compatibility, but the authoritative submission surface is
      // `/.well-known/chatgpt-apps-manifest.json` for "apps via MCP").

      // --- Tool invocation endpoint
      if (url.pathname === '/tools/call') {
        // If request is authorized via Auth0, we bind Auth0 subject → Supabase auth UUID
        // and overwrite any client-supplied user_id/userId.
        let verifiedUserId: string | undefined;

        // Development mode bypass (non-production only)
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[AUTH] Dev mode: bypassing auth for /tools/call');
          // Continue to tool execution below
        } else {
          // Production auth validation
          // Accept either:
          // 1) Internal service token (MCP_ACCESS_TOKEN)
          // 2) Auth0 JWT access token (from ChatGPT OAuth flow)
          const authHeader = req.headers['authorization'] as string | undefined;
          const expectedToken = process.env.MCP_ACCESS_TOKEN;

          let isAuthorized = false;
          let authSource: 'mcp_access_token' | 'auth0' | 'none' = 'none';

          // Internal token path (used by internal scripts/ops)
          if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
            isAuthorized = true;
            authSource = 'mcp_access_token';
          } else {
            // Auth0 token path (used by ChatGPT actions)
            const bearerToken = extractBearerToken(authHeader);
            if (bearerToken) {
              try {
                const payload = await verifyAuth0Token(bearerToken);
                // Bind Auth0 identity to a Supabase auth UUID (DB uses uuid user_id columns).
                verifiedUserId = await this.resolveSupabaseUserIdFromAuth0(payload);
                isAuthorized = true;
                authSource = 'auth0';
              } catch (e: any) {
                console.warn('[AUTH] Auth0 JWT rejected for /tools/call:', e?.message);
              }
            }
          }

          if (!isAuthorized) {
            res.writeHead(401, {
              "Content-Type": "application/json",
              "WWW-Authenticate": "Bearer realm=\"signupassist\", error=\"authentication_required\""
            });
            res.end(JSON.stringify({ error: "Unauthorized - Valid OAuth token required" }));
            console.log('[AUTH] Unauthorized access attempt to /tools/call');
            return;
          }

          console.log(`[AUTH] Authorized request to /tools/call via ${authSource}`);
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported. Use POST with { tool, args }.' }));
          return;
        }

        let body = '';
        try {
          const maxBytes = normalizeMaxBodyBytes(process.env.MAX_TOOLS_CALL_BODY_BYTES, 256 * 1024);
          body = await readBodyWithLimit(req, maxBytes);
        } catch (e: any) {
          if (e?.code === 'BODY_TOO_LARGE') {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'payload_too_large', message: 'Request body too large' }));
            return;
          }
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'invalid_request_body' }));
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        try {
          let { tool, args } = parsed;
          if (!tool) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required field: tool' }));
            return;
          }

            // ================================================================
            // AUTH0 USER BINDING / MAPPING (DEFENSE-IN-DEPTH)
            //
            // - If request is authorized via Auth0, do NOT trust client-supplied user_id/userId.
            //   Overwrite with the verified Supabase UUID.
            // - If request is authorized via internal token, allow convenience: if caller supplies
            //   an Auth0 subject (auth0|... / google-oauth2|...), map it to a Supabase UUID.
            // ================================================================
            if (args && typeof args === 'object') {
              if (verifiedUserId) {
                if ('user_id' in args) (args as any).user_id = verifiedUserId;
                if ('userId' in args) (args as any).userId = verifiedUserId;
              } else {
                const raw = (args as any).user_id ?? (args as any).userId;
                if (typeof raw === 'string' && (raw.startsWith('auth0|') || raw.startsWith('google-oauth2|'))) {
                  const mapped = await this.resolveSupabaseUserIdFromAuth0({ sub: raw });
                  if (mapped) {
                    if ('user_id' in args) (args as any).user_id = mapped;
                    if ('userId' in args) (args as any).userId = mapped;
                  }
                }
              }
            }

            // Tool aliases for ChatGPT compatibility (OpenAPI uses clearer names)
            // Internal names are preserved for audit trail consistency
            const TOOL_ALIASES: Record<string, string> = {
              'bookeo.get_registration_form': 'bookeo.discover_required_fields',
              'bookeo.reserve_spot': 'bookeo.create_hold',
            };
            
            const originalToolName = tool;
            if (TOOL_ALIASES[tool]) {
              tool = TOOL_ALIASES[tool];
              console.log(`[TOOLS] Alias: ${originalToolName} → ${tool}`);
            }

            if (!this.tools.has(tool)) {
              // Return only API-friendly tools in error message (exclude internal/scraping tools)
              const apiTools = Array.from(this.tools.keys())
                .filter(t => t.startsWith('bookeo.') && !t.includes('test'))
                .sort();
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: `Tool '${originalToolName}' not found. Available tools: ${apiTools.join(', ')}`,
                })
              );
              return;
            }

            const runId = req.headers['x-run-id'] || crypto.randomUUID();
            const stage = args?.stage || 'program';
            const prefix = stage === 'prereq' ? '[Prereq]' : '[Program]';
            console.log(`${prefix} run=${runId} start tool=${tool}`);

            const toolInstance = this.tools.get(tool);
            const enrichedArgs = { ...args, _stage: stage, _run_id: runId };
            const result = await toolInstance.handler(enrichedArgs);

            console.log(`${prefix} run=${runId} done success=${!!result?.success}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('[TOOLS/CALL ERROR]', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
          }
        return;
      }

      // --- Credential storage endpoint
      if (url.pathname === '/tools/cred-store') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { provider, alias, email, password, user_id } = JSON.parse(body);
            
            if (!provider || !alias || !email || !password) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Missing required fields: provider, alias, email, password' 
              }));
              return;
            }

            // Check for CRED_SEAL_KEY
            const sealKey = process.env.CRED_SEAL_KEY;
            if (!sealKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'CRED_SEAL_KEY not configured' }));
              return;
            }

            // Use system user ID if not provided (for service credentials)
            const SYSTEM_USER_ID = 'eb8616ca-a2fa-4849-aef6-723528d8c273';
            const effectiveUserId = user_id || SYSTEM_USER_ID;

            console.log(`[cred-store] Storing credential for provider=${provider}, alias=${alias}, user=${effectiveUserId}`);

            // Encrypt credentials using Web Crypto API (AES-GCM)
            const credentialData = JSON.stringify({ email, password });
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(credentialData);
            
            // Generate random IV (12 bytes for AES-GCM)
            const iv = crypto.randomBytes(12);
            
            // Import the encryption key
            const keyData = Buffer.from(sealKey, 'base64');
            const cryptoKey = await crypto.subtle.importKey(
              'raw',
              keyData,
              { name: 'AES-GCM', length: 256 },
              false,
              ['encrypt']
            );
            
            // Encrypt the data
            const encryptedBuffer = await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              cryptoKey,
              dataBuffer
            );
            
            // Format as base64:base64 (encrypted:iv)
            const encryptedBase64 = Buffer.from(encryptedBuffer).toString('base64');
            const ivBase64 = iv.toString('base64');
            const encryptedData = `${encryptedBase64}:${ivBase64}`;

            // Store in database using service role
            const supabaseUrl = process.env.SUPABASE_URL!;
            const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
            
            const { createClient } = await import('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseServiceKey);

            const { data, error } = await supabase
              .from('stored_credentials')
              .upsert(
                {
                  user_id: effectiveUserId,
                  provider,
                  alias,
                  encrypted_data: encryptedData,
                },
                { onConflict: 'user_id,provider', ignoreDuplicates: false }
              )
              .select()
              .single();

            if (error) {
              console.error('[cred-store] Database error:', error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Database error: ${error.message}` }));
              return;
            }

            console.log(`[cred-store] ✅ Stored credential with ID: ${data.id}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true,
              id: data.id,
              alias: data.alias,
              provider: data.provider,
              created_at: data.created_at
            }));
          } catch (err: any) {
            console.error('[cred-store] Error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
          }
        });
        return;
      }

      // --- List tools
      if (req.method === 'GET' && url.pathname === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            tools: Array.from(this.tools.values()).map((t) => ({
              name: t.name,
              description: t.description,
            })),
          })
        );
        return;
      }

      // --- Serve ai-plugin.json from both /.well-known and /mcp/.well-known
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        (url.pathname === "/.well-known/ai-plugin.json" ||
         url.pathname === "/mcp/.well-known/ai-plugin.json")
      ) {
        if (isMcpOnlyMode()) {
          respondOpenApiDisabled(req, res, url.pathname);
          return;
        }
        try {
          const manifestPath = path.resolve(process.cwd(), "public", ".well-known", "ai-plugin.json");
          const manifestText = readFileSync(manifestPath, "utf8");

          // Rewrite URLs to match request host to satisfy "same root domain" requirements.
          const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
          const host =
            (req.headers['x-forwarded-host'] as string | undefined) ||
            (req.headers['host'] as string | undefined);
          const baseUrl = host ? `${proto}://${host}` : 'https://signupassist-mcp-production.up.railway.app';

          let out = manifestText;
          try {
            const json = JSON.parse(manifestText);
            if (json?.auth?.type === 'oauth') {
              json.auth.authorization_url = `${baseUrl}/oauth/authorize`;
              json.auth.token_url = `${baseUrl}/oauth/token`;
            }
            if (json?.api?.type === 'openapi') {
              json.api.url = `${baseUrl}/mcp/openapi.json`;
            }
            if (json?.logo_url) json.logo_url = `${baseUrl}/logo-512.svg`;
            if (json?.legal_info_url) json.legal_info_url = `${baseUrl}/privacy`;
            out = JSON.stringify(json, null, 2);
          } catch (e: any) {
            console.warn('[AI-PLUGIN] Failed to rewrite URLs:', e?.message);
          }
          res.writeHead(200, { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache"
          });
          if (req.method === "HEAD") {
            res.end();
            console.log("[ROUTE] Served ai-plugin.json for", url.pathname, "(HEAD)");
            return;
          }
          res.end(out);
          console.log("[ROUTE] Served ai-plugin.json for", url.pathname);
        } catch (error: any) {
          console.error("[AI-PLUGIN SERVE ERROR]", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to load ai-plugin.json", details: error.message }));
        }
        return;
      }

      // --- Serve /.well-known/openai-connector.json (ChatGPT connector discovery)
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        (url.pathname === "/.well-known/openai-connector.json" ||
         url.pathname === "/mcp/.well-known/openai-connector.json")
      ) {
        if (isMcpOnlyMode()) {
          respondOpenApiDisabled(req, res, url.pathname);
          return;
        }
        try {
          const manifestPath = path.resolve(process.cwd(), "public", ".well-known", "openai-connector.json");
          const manifestText = readFileSync(manifestPath, "utf8");

          // Rewrite URLs to match request host for consistency / cross-domain safety.
          const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
          const host =
            (req.headers['x-forwarded-host'] as string | undefined) ||
            (req.headers['host'] as string | undefined);
          const baseUrl = host ? `${proto}://${host}` : 'https://signupassist-mcp-production.up.railway.app';

          let out = manifestText;
          try {
            const json = JSON.parse(manifestText);
            if (json?.auth?.type === 'oauth') {
              json.auth.authorization_url = `${baseUrl}/oauth/authorize`;
              json.auth.token_url = `${baseUrl}/oauth/token`;
            }
            if (json?.api?.type === 'openapi') {
              json.api.url = `${baseUrl}/mcp/openapi.json`;
            }
            if (json?.logo_url) json.logo_url = `${baseUrl}/logo-512.svg`;
            if (json?.legal_info_url) json.legal_info_url = `${baseUrl}/privacy`;
            out = JSON.stringify(json, null, 2);
          } catch (e: any) {
            console.warn('[CONNECTOR] Failed to rewrite URLs:', e?.message);
          }
          res.writeHead(200, { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache"
          });
          if (req.method === "HEAD") {
            res.end();
            console.log("[ROUTE] Served openai-connector.json for", url.pathname, "(HEAD)");
            return;
          }
          res.end(out);
          console.log("[ROUTE] Served openai-connector.json for", url.pathname);
        } catch (error: any) {
          console.error("[CONNECTOR JSON ERROR]", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to load openai-connector.json", details: error.message }));
        }
        return;
      }

      // --- OpenAI Domain Verification (for ChatGPT app submission)
      if (
        req.method === "GET" &&
        (
          // Legacy/alternate path used by some OpenAI UIs
          url.pathname === "/.well-known/openai-verification.txt" ||
          url.pathname === "/mcp/.well-known/openai-verification.txt" ||
          // Current ChatGPT Apps UI path
          url.pathname === "/.well-known/openai-apps-challenge" ||
          url.pathname === "/mcp/.well-known/openai-apps-challenge"
        )
      ) {
        let verificationToken = (process.env.OPENAI_VERIFICATION_TOKEN || '').trim();

        // Optional fallback: allow storing the token as a static file in the repo.
        // Useful if you prefer not to manage a Railway env var for a non-secret verification token.
        if (!verificationToken) {
          try {
            const candidates = [
              path.resolve(process.cwd(), "public", ".well-known", "openai-apps-challenge"),
              path.resolve(process.cwd(), "public", ".well-known", "openai-verification.txt"),
            ];
            for (const p of candidates) {
              if (existsSync(p)) {
                verificationToken = String(readFileSync(p, "utf8") || "").trim();
                if (verificationToken) break;
              }
            }
          } catch {
            // ignore
          }
        }

        if (!verificationToken) {
          console.warn("[ROUTE] OpenAI domain verification requested but token not configured");
          res.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
          });
          res.end("OPENAI_VERIFICATION_TOKEN not set");
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(verificationToken);
        console.log("[ROUTE] Served OpenAI domain verification token for", url.pathname);
        return;
      }

      // --- Prompt override endpoint for tone training
      if (url.pathname === '/api/override-prompt') {
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported' }));
          return;
        }
        
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { sessionId, newPrompt } = JSON.parse(body);
            
            if (!sessionId || !newPrompt) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId or newPrompt' }));
              return;
            }
            
            if (!this.orchestrator) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'AI Orchestrator unavailable' }));
              return;
            }
            
            // overridePrompt is only available in legacy AIOrchestrator
            const isAPIMode = process.env.USE_API_ORCHESTRATOR === 'true';
            if (isAPIMode) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Prompt override not supported in API-first mode' }));
              return;
            }
            
            (this.orchestrator as any).overridePrompt(sessionId, newPrompt);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: `Prompt overridden for session ${sessionId}` 
            }));
          } catch (err: any) {
            console.error('[Override Prompt] Error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
          }
        });
        return;
      }

      // --- Identity endpoint (helps Supabase functions auto-detect worker URL)
      if (req.method === 'GET' && url.pathname === '/identity') {
        const host = req.headers['host'];
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const workerUrl = `${protocol}://${host}`;
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ worker_url: workerUrl }));
        console.log('[IDENTITY] Served worker URL:', workerUrl);
        return;
      }

      // --- Refresh programs feed (DEPRECATED)
      // Scraping-based providers (SkiClubPro/Browserbase) are removed; this endpoint is intentionally disabled.
      if (req.method === 'POST' && url.pathname === '/refresh-feed') {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Deprecated: scraping-based feed refresh removed (API-first only).' }));
          return;
        }
        
      // --- Hydrate program details (DEPRECATED)
      // Scraping-based detail hydration is removed; this endpoint is intentionally disabled.
      if (req.method === 'POST' && url.pathname === '/hydrate-program-details') {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Deprecated: scraping-based detail hydration removed (API-first only).' }));
        return;
      }

      // --- Orchestrator endpoint for Chat Test Harness
      // Version endpoint for deployment verification
      if (url.pathname === '/version') {
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(VERSION_INFO, null, 2));
        return;
      }

      // ============================================================
      // ACTION-FIRST ENTRYPOINT - signupassist.start via HTTP
      // ============================================================
      // ChatGPT can call this immediately with zero user input
      if (url.pathname === '/signupassist/start') {
        console.log('[ROUTE] /signupassist/start hit - ACTION MODE');
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        
        try {
          const org_ref = url.searchParams.get('org_ref') || 'aim-design';
          const category = url.searchParams.get('category') || 'all';
          
          // Get the signupassist.start tool and call it
          const tool = this.tools.get('signupassist.start');
          if (!tool) {
            res.end(JSON.stringify({ error: 'signupassist.start tool not registered' }));
            return;
          }
          
          const result = await tool.handler({ org_ref, category });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          console.error('[signupassist.start] Error:', err);
          res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
        }
        return;
      }

      if (url.pathname === '/orchestrator/chat') {
        console.log('[ROUTE] /orchestrator/chat hit');
        if (isMcpOnlyMode()) {
          respondOpenApiDisabled(req, res, url.pathname);
          return;
        }
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mandate-JWS, X-Mandate-Id'
          });
          res.end();
          return;
        }
        
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsedBody = JSON.parse(body);
            const { message, sessionId, action, payload, userLocation, userJwt, category, childAge, currentAAP, userTimezone, user_id } = parsedBody;
            
            console.log('[Orchestrator] Request params:', { 
              hasMessage: !!message,
              hasAction: !!action,
              hasAAP: !!currentAAP,
              hasCategory: !!category,
              hasChildAge: !!childAge,
              hasLocation: !!(userLocation?.lat && userLocation?.lng),
              location: userLocation,
              userTimezone
            });
            
            // ================================================================
            // AUTH0 JWT VERIFICATION (Production ChatGPT App Store Flow)
            // ================================================================
            const authHeader = req.headers['authorization'] as string | undefined;
            const bearerToken = extractBearerToken(authHeader);
            
            let authenticatedUserId: string | null = null;
            let authSource: 'auth0' | 'test_harness' | 'none' = 'none';
            
            // Production: Verify Auth0 JWT if present
            if (bearerToken) {
              try {
                const payload = await verifyAuth0Token(bearerToken);
                authenticatedUserId = payload.sub;
                authSource = 'auth0';
                console.log('[AUTH] ✅ Auth0 JWT verified, user_id:', authenticatedUserId);
              } catch (jwtError: any) {
                console.warn('[AUTH] ⚠️ Auth0 JWT verification failed:', jwtError.message);
                // JWT invalid - fall through to check test harness user_id
              }
            }
            
            // Test harness fallback: Accept user_id from body (only if no valid Auth0 token)
            if (!authenticatedUserId && user_id) {
              authenticatedUserId = user_id;
              authSource = 'test_harness';
              console.log('[AUTH] Using test harness user_id:', authenticatedUserId);
            }
            
            // ================================================================
            // PROTECTED ACTION ENFORCEMENT
            // Return 401 for protected actions without authentication
            // ChatGPT SDK interprets this as "trigger OAuth consent"
            // ================================================================
            if (action && isProtectedAction(action) && !authenticatedUserId) {
              console.log('[AUTH] 🚫 Protected action without auth:', action);
              const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
              const host =
                (req.headers['x-forwarded-host'] as string | undefined) ||
                (req.headers['host'] as string | undefined);
              const baseUrl = host ? `${proto}://${host}` : 'https://signupassist-mcp-production.up.railway.app';
              const authUrl = `${baseUrl}/oauth/authorize`;
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'WWW-Authenticate': `Bearer realm="SignupAssist", error="authentication_required"`
              });
              res.end(JSON.stringify({
                error: 'authentication_required',
                requiresAuth: true,
                authUrl,
                message: 'Sign in required to perform this action',
                action_requiring_auth: action,
                protected_actions: PROTECTED_ACTIONS as unknown as string[]
              }));
              return;
            }
            
            // Use authenticated user_id for downstream operations
            const finalUserId = authenticatedUserId;
            console.log('[AUTH] Final user context:', { userId: finalUserId, authSource });
            
            // Capture mandate from headers or body (with dev bypass)
            const mandate_jws = (req.headers['x-mandate-jws'] as string) 
                             || parsedBody.mandate_jws 
                             || process.env.MANDATE_JWS_DEV 
                             || null;
            const mandate_id = (req.headers['x-mandate-id'] as string) 
                            || parsedBody.mandate_id 
                            || null;
            
            // Dev bypass if no mandate in dev mode
            const finalMandateJws = (!mandate_jws && process.env.MANDATE_OPTIONAL === 'true') 
              ? '__DEV_BYPASS__' 
              : mandate_jws;
            
            if (finalMandateJws || mandate_id) {
              console.log('[mandate] attached:', !!finalMandateJws, !!mandate_id);
            }
            
            // Check if orchestrator is available - if not, provide mock responses
            if (!this.orchestrator) {
              console.warn('[Orchestrator] APIOrchestrator unavailable - returning limited response (OPENAI_API_KEY likely missing)');

              const mockResult = {
                message:
                  "⚠️ SignupAssist is running in limited mode because OPENAI_API_KEY is not configured.\n\n" +
                  "This deployment is **API-first only** (no SkiClubPro, no Browserbase, no login/scraping).\n\n" +
                  "To enable the conversational signup flow, set **OPENAI_API_KEY** and retry."
              };
              
              res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify(mockResult));
              return;
            }
            
            // Validate required fields
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId' }));
              return;
            }

            let result;
            
            // Check orchestrator mode
            const isAPIMode = process.env.USE_API_ORCHESTRATOR === 'true';
            
            // Route to appropriate orchestrator method
            // ================================================================
            // SESSION KEY: Use userId as the stable session identifier
            // ChatGPT may send different sessionIds each turn, but userId (from Auth0) is stable
            // This ensures multi-turn conversations find the same session context
            // ================================================================
            const stableSessionId = finalUserId || sessionId;
            console.log('[SESSION] Using stable session key:', { stableSessionId, originalSessionId: sessionId, finalUserId });
            
            if (action) {
              // Card action (button click)
              console.log(`[Orchestrator] handleAction: ${action}`, { hasJwt: !!userJwt });
              
              if (isAPIMode) {
                // APIOrchestrator: Use generateResponse with action parameter
                console.log('[API-FIRST MODE] Routing action via generateResponse', { finalUserId });
                // IMPORTANT: preserve the incoming message so APIOrchestrator can do NL fallback parsing
                // (ChatGPT sometimes sends empty payloads for card actions)
                result = await (this.orchestrator as any).generateResponse(message || '', stableSessionId, action, payload || {}, userTimezone, finalUserId);
              } else {
                // Legacy AIOrchestrator: Use handleAction method
                try {
                  console.log('[LEGACY MODE] Calling AIOrchestrator.handleAction');
                  result = await (this.orchestrator as any).handleAction(action, payload || {}, sessionId, userJwt, { 
                    mandate_jws: finalMandateJws, 
                    mandate_id 
                  });
                  console.log(`[Orchestrator] handleAction result:`, result ? 'success' : 'null/undefined');
                  
                  if (!result) {
                    throw new Error(`handleAction returned ${result} for action: ${action}`);
                  }
                } catch (actionError: any) {
                  console.error(`[Orchestrator] handleAction error for ${action}:`, actionError);
                  throw actionError; // Re-throw to outer catch
                }
              }
            } else if (message) {
              // Fetch ipapi location if not already provided via userLocation
              let finalUserLocation = userLocation;
              
              // Only fetch location and update context in legacy mode
              // (isAPIMode already declared above)
              
              if (!isAPIMode && (!userLocation?.lat || !userLocation?.lng)) {
                try {
                  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SB_URL;
                  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
                  
                  if (SUPABASE_URL && SUPABASE_KEY) {
                    console.log('[Orchestrator] Fetching ipapi location...');
                    
                    // Forward client IP headers to ipapi function
                    const locationRes = await fetch(`${SUPABASE_URL}/functions/v1/get-user-location`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        // Forward IP headers from original request
                        ...(req.headers['x-forwarded-for'] && { 'x-forwarded-for': req.headers['x-forwarded-for'] as string }),
                        ...(req.headers['x-real-ip'] && { 'x-real-ip': req.headers['x-real-ip'] as string }),
                        ...(req.headers['cf-connecting-ip'] && { 'cf-connecting-ip': req.headers['cf-connecting-ip'] as string })
                      }
                    });
                    
                    if (locationRes.ok) {
                      const locationData = await locationRes.json();
                      console.log('[Orchestrator] ipapi location:', locationData);
                      
                      // Store in session context for AAP triage and provider search (legacy only)
                      await (this.orchestrator as any).updateContext(sessionId, {
                        location: {
                          lat: locationData.lat,
                          lng: locationData.lng,
                          city: locationData.city,
                          region: locationData.region,
                          country: 'US',
                          source: 'ipapi',
                          mock: locationData.mock || false,
                          reason: locationData.reason
                        }
                      } as any);
                      
                      // Also pass as userLocation for backward compatibility
                      finalUserLocation = { lat: locationData.lat, lng: locationData.lng };
                    }
                  }
                } catch (locationError: any) {
                  console.warn('[Orchestrator] Failed to fetch ipapi location:', locationError.message);
                  // Continue without location - not a critical failure
                }
              }
              
              // Phase 3: Update context with structured AAP if provided (legacy only)
              if (!isAPIMode && currentAAP) {
                console.log(`[Orchestrator] Updating context with AAP object:`, currentAAP);
                await (this.orchestrator as any).updateContext(sessionId, { aap: currentAAP } as any);
              }
              
              // Quick Win #1: Capture intent parameters (category, childAge) from request (legacy only)
              if (!isAPIMode && (category || childAge)) {
                console.log(`[Orchestrator] Updating context with legacy intent:`, { category, childAge });
                await (this.orchestrator as any).updateContext(sessionId, { category, childAge } as any);
              }
              
              // Text message
              console.log(`[Orchestrator] generateResponse: ${message}`, { 
                hasLocation: !!finalUserLocation, 
                hasJwt: !!userJwt,
                hasAAP: !!currentAAP,
                category,
                childAge 
              });
              
              // Use isAPIMode declared above (no redeclaration)
              
              if (isAPIMode) {
                // APIOrchestrator: Simple signature (input, sessionId, action?, payload?, userTimezone?, userId?)
                console.log('[API-FIRST MODE] Calling APIOrchestrator.generateResponse', { finalUserId, stableSessionId });
                result = await (this.orchestrator as any).generateResponse(message, stableSessionId, undefined, undefined, userTimezone, finalUserId);
              } else {
                // Legacy AIOrchestrator: Complex signature with location, JWT, mandate
                console.log('[LEGACY MODE] Calling AIOrchestrator.generateResponse');
                result = await (this.orchestrator as any).generateResponse(
                  message, 
                  stableSessionId, 
                  finalUserLocation, 
                  userJwt, 
                  { 
                    mandate_jws: finalMandateJws, 
                    mandate_id 
                  }
                );
              }
              
              console.log(`[Orchestrator] generateResponse result:`, result ? 'success' : 'null/undefined');
              
              // Handle null response (silent pass for LOW confidence anonymous users)
              if (!result) {
                console.log('[Orchestrator] generateResponse returned null - silent pass (not activating for this query)');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  message: null,
                  silentPass: true 
                }));
                return;
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing message or action' }));
              return;
            }

            // -------------------------
            // V1 UX Guardrails (ChatGPT chat-only)
            //
            // These guardrails are critical for the ChatGPT App Store *chat* surface:
            // - FIX 1: Always Step headers based on context.step
            // - FIX 4: No clickable CTAs in ChatGPT chat mode
            // - FIX 5: No schema payloads (prevents field dumps)
            //
            // V1 focus: ChatGPT only. Always enforce at the HTTP boundary.
            // -------------------------
            const safe = applyV1ChatGuardrails(result);
            
            // Also expose the step in the response for debugging
            const ctxStep: OrchestratorStep = (result?.step || result?.context?.step || "BROWSE") as OrchestratorStep;
            const wizardStep = inferWizardStep(ctxStep);
            if (!safe.context) safe.context = {};
            safe.context.wizardStep = wizardStep;

            console.log('[Orchestrator] Sending sanitized response:', JSON.stringify({ 
              message: safe?.message?.substring(0, 100), 
              step: safe?.context?.step || safe?.step,
              wizardStep 
            }, null, 2));

            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(safe));
          } catch (err: any) {
            console.error('[Orchestrator] Error:', err);
            res.writeHead(500, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ 
              error: err.message || 'Unknown error',
              message: "Something went wrong. Let's try that again.",
              cta: [{ label: "Retry", action: "retry_last", variant: "accent" }]
            }));
          }
        });
        return;
      }

      // --- ChatGPT Apps SDK Manifest (chat-only V1 - no widget)
      // NOTE: Some clients probe with HEAD during validation.
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/.well-known/chatgpt-apps-manifest.json') {
        console.log('[MANIFEST] Serving ChatGPT Apps manifest (V1 chat-only)');

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          res.end();
          return;
        }
        
        const manifestPath = path.resolve(process.cwd(), 'public', '.well-known', 'chatgpt-apps-manifest.json');
        if (existsSync(manifestPath)) {
          try {
            const content = readFileSync(manifestPath, 'utf-8');
            // Rewrite URLs to match the current request host (avoids cross-domain OAuth issues).
            const host =
              (req.headers['x-forwarded-host'] as string | undefined) ||
              (req.headers['host'] as string | undefined);
            const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined);
            const proto =
              forwardedProto ||
              (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
            const baseUrl =
              host
                ? `${proto}://${host}`
                : 'https://signupassist-mcp-production.up.railway.app';

            let out = content;
            try {
              const json = JSON.parse(content);
              if (json?.auth?.type === 'oauth') {
                json.auth.authorization_url = `${baseUrl}/oauth/authorize`;
                json.auth.token_url = `${baseUrl}/oauth/token`;
              }
              if (json?.api?.type === 'mcp') {
                json.api.server_url = `${baseUrl}/sse`;
              }
              json.logo_url = `${baseUrl}/logo-512.svg`;
              json.legal_info_url = `${baseUrl}/privacy`;
              out = JSON.stringify(json, null, 2);
            } catch (e: any) {
              console.warn('[MANIFEST] Failed to rewrite chatgpt-apps-manifest.json URLs:', e?.message);
            }
            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(out);
            return;
          } catch (err: any) {
            console.error('[MANIFEST ERROR]', err);
          }
        }
        
        // Fallback inline manifest (V1 chat-only - NO widget block)
        const manifest = {
          schema_version: "1.0.0",
          name_for_human: "SignupAssist",
          name_for_model: "signupassist",
          description_for_human: "SignupAssist helps parents discover, schedule, and complete class signups for their children."
        };
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(manifest, null, 2));
        return;
      }

      // --- Legal: Privacy Policy (served from repo markdown for review accuracy)
      if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/privacy' || url.pathname === '/privacy.html')) {
        try {
          const mdPath = path.resolve(process.cwd(), 'docs', 'PRIVACY_POLICY.md');
          const md = existsSync(mdPath)
            ? readFileSync(mdPath, 'utf-8')
            : 'Privacy policy not found. Please contact support@shipworx.ai.';

          const escapeHtml = (s: string) =>
            s
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');

          const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SignupAssist Privacy Policy</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5; margin: 40px auto; max-width: 980px; padding: 0 16px; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      .muted { color: #555; }
      .topbar { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:16px; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <h1>Privacy Policy</h1>
      <div class="muted">Served by SignupAssist MCP</div>
    </div>
    <pre>${escapeHtml(md)}</pre>
  </body>
</html>`;

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          if (req.method === 'HEAD') res.end();
          else res.end(html);
          return;
        } catch (err: any) {
          console.error('[PRIVACY] Error serving privacy policy:', err);
          res.writeHead(500, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          res.end('Failed to load privacy policy.');
          return;
        }
      }

      // --- Stripe return (success/cancel landing page)
      // Stripe Checkout needs a success_url/cancel_url.
      // IMPORTANT: In the ChatGPT Apps flow, users won't return through our web frontend,
      // so we finalize the setup-mode checkout here by calling the `stripe-checkout-success`
      // Supabase Edge Function. That updates `user_billing.default_payment_method_id` so
      // the MCP orchestrator can detect a saved payment method when the user types "done".
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/stripe_return') {
        const status = url.searchParams.get('payment_setup') || 'unknown';
        const sessionId = url.searchParams.get('session_id') || '';
        const title =
          status === 'success'
            ? 'Payment method saved'
            : status === 'canceled'
              ? 'Payment setup canceled'
              : 'Payment setup';

        let finalized: { ok: boolean; brand?: string; last4?: string; error?: string } | null = null;
        if (req.method === 'GET' && status === 'success' && sessionId) {
          try {
            const { data, error } = await supabase.functions.invoke('stripe-checkout-success', {
              body: { session_id: sessionId }
            });
            if (error) {
              finalized = { ok: false, error: error.message || String(error) };
              console.warn('[stripe_return] stripe-checkout-success error:', finalized.error);
            } else {
              finalized = {
                ok: true,
                brand: (data as any)?.brand,
                last4: (data as any)?.last4
              };
              console.log('[stripe_return] ✅ stripe-checkout-success finalized', {
                session_id: sessionId,
                brand: finalized.brand,
                last4: finalized.last4
              });
            }
          } catch (e: any) {
            finalized = { ok: false, error: e?.message || String(e) };
            console.warn('[stripe_return] stripe-checkout-success exception:', finalized.error);
          }
        }

        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — SignupAssist</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5; margin: 40px auto; max-width: 820px; padding: 0 16px; }
      .card { border: 1px solid #eee; border-radius: 12px; padding: 16px; }
      .muted { color: #555; }
      code { background: #f6f6f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="card">
      ${
        finalized
          ? finalized.ok
            ? `<p>✅ Payment method saved${finalized.brand && finalized.last4 ? ` (${escapeHtml(finalized.brand)} •••• ${escapeHtml(finalized.last4)})` : ''}.</p>`
            : `<p class="muted">⚠️ We couldn't confirm your payment method automatically. If you completed Stripe Checkout, wait a moment and type <code>done</code> in ChatGPT.</p>`
          : ''
      }
      <p>Return to ChatGPT and type <code>done</code> to continue your SignupAssist flow.</p>
      ${sessionId ? `<p class="muted">Session: <code>${escapeHtml(sessionId)}</code></p>` : ''}
    </div>
  </body>
</html>`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        res.end(html);
        return;
      }

      // --- Legal: Terms of Use (served from repo markdown for review accuracy)
      if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/terms' || url.pathname === '/terms.html')) {
        try {
          const mdPath = path.resolve(process.cwd(), 'docs', 'TERMS_OF_USE.md');
          const md = existsSync(mdPath)
            ? readFileSync(mdPath, 'utf-8')
            : 'Terms of use not found. Please contact support@shipworx.ai.';

          const escapeHtml = (s: string) =>
            s
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');

          const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SignupAssist Terms of Use</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5; margin: 40px auto; max-width: 980px; padding: 0 16px; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      .muted { color: #555; }
      .topbar { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:16px; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <h1>Terms of Use</h1>
      <div class="muted">Served by SignupAssist MCP</div>
    </div>
    <pre>${escapeHtml(md)}</pre>
  </body>
</html>`;

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          if (req.method === 'HEAD') res.end();
          else res.end(html);
          return;
        } catch (err: any) {
          console.error('[TERMS] Error serving terms of use:', err);
          res.writeHead(500, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          res.end('Failed to load terms of use.');
          return;
        }
      }

 
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/logo-512.svg') {
        try {
          const candidates = [
            path.resolve(process.cwd(), 'dist', 'client', 'logo-512.svg'),
            path.resolve(process.cwd(), 'public', 'logo-512.svg'),
          ];
          const logoPath = candidates.find((p) => existsSync(p));
          if (!logoPath) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'logo_not_found' }));
            return;
          }

          const svg = readFileSync(logoPath);
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          });
          if (req.method === 'HEAD') res.end();
          else res.end(svg);
          return;
        } catch (err: any) {
          console.error('[LOGO] Error serving logo:', err);
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'logo_serve_failed' }));
          return;
        }
      }

      // --- Serve static frontend files (React SPA)
      // IMPORTANT: avoid SPA fallback for protocol endpoints (some clients probe with GET/HEAD).
      // Returning index.html here can cause opaque failures/timeouts in validators.
      if ((url.pathname === '/messages' || url.pathname === '/sse/messages') && req.method !== 'POST') {
        res.writeHead(405, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Allow': 'POST, OPTIONS',
        });
        res.end(JSON.stringify({ error: 'method_not_allowed', endpoint: url.pathname, allowed: ['POST'] }));
        return;
      }
      if (url.pathname === '/oauth/token' && req.method !== 'POST' && req.method !== 'HEAD') {
        res.writeHead(405, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Allow': 'POST, HEAD, OPTIONS',
        });
        res.end(JSON.stringify({ error: 'method_not_allowed', endpoint: '/oauth/token', allowed: ['POST', 'HEAD'] }));
        return;
      }

      if (req.method === 'GET') {
        const servePath = url.pathname === '/' ? '/index.html' : url.pathname;
        const filePath = path.resolve(process.cwd(), 'dist', 'client', `.${servePath}`);
        
        if (existsSync(filePath)) {
          // Determine content type by file extension
          const ext = path.extname(filePath);
          const contentTypeMap: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.json': 'application/json',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
          };
          const contentType = contentTypeMap[ext] || 'application/octet-stream';
          
          try {
            const content = readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
            console.log('[STATIC] Served:', servePath);
            return;
          } catch (err: any) {
            console.error('[STATIC ERROR]', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
            return;
          }
        }
        
        // For SPA routing: serve index.html for non-file paths
        if (!servePath.includes('.')) {
          try {
            const indexPath = path.resolve(process.cwd(), 'dist', 'client', 'index.html');
            const content = readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
            console.log('[SPA] Served index.html for:', url.pathname);
            return;
          } catch (err: any) {
            console.error('[SPA ERROR]', err);
            // Fall through to 404
          }
        }
      }

      // --- Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // Add error handler for the HTTP server
    httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[HTTP ERROR] Port ${port} is already in use`);
        process.exit(1);
      } else {
        console.error('[HTTP ERROR]', error);
        process.exit(1);
      }
    });

    // Log startup info before binding
    console.log(`[STARTUP] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[STARTUP] PORT: ${port}`);

    return new Promise((resolve, reject) => {
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`✅ MCP HTTP Server listening on port ${port}`);
        console.log(`   Health: http://localhost:${port}/health`);
        console.log(`   Manifest: http://localhost:${port}/mcp/manifest.json`);
        console.log(`   Root: http://localhost:${port}/mcp`);
        console.log(`   Well-known: http://localhost:${port}/.well-known/ai-plugin.json`);
        
        // CRITICAL: Give Railway's probe time to connect after bind
        setTimeout(() => {
          console.log('[STARTUP] Server ready for healthcheck');
          resolve(httpServer);
        }, 100);
      });

      httpServer.on('error', reject);
    });
  }
}

// --- Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, closing server gracefully...');
  process.exit(0);
});

// --- Startup sequence
console.log('[STARTUP] Registering prerequisite checkers...');
registerAllProviders();
console.log('[STARTUP] Prerequisite checkers registered');

// Log build info for deployment verification
console.info(
  `[BUILD] Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || "dev"} | Built at: ${new Date().toISOString()}`
);

console.log('[STARTUP] Creating SignupAssistMCPServer instance...');
const server = new SignupAssistMCPServer();

console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);

// Enhanced logging for MCP_ACCESS_TOKEN
const token = process.env.MCP_ACCESS_TOKEN;
if (token) {
  console.log('[AUTH] Token configured:', token.slice(0, 4) + '****');
} else {
  console.warn('[AUTH] Warning: No MCP_ACCESS_TOKEN detected in environment');
}

// Railway Docker deployments sometimes do not set NODE_ENV=production and can be inconsistent
// about injecting PORT. Detect Railway explicitly so we always start HTTP mode there.
const isRailway =
  !!process.env.RAILWAY_PROJECT_ID ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_SERVICE_ID ||
  !!process.env.RAILWAY_PUBLIC_DOMAIN ||
  !!process.env.RAILWAY_GIT_COMMIT_SHA;

const shouldStartHttp = isRailway || process.env.NODE_ENV === 'production' || !!process.env.PORT;

console.log('[STARTUP] shouldStartHttp:', shouldStartHttp, {
  isRailway,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,
  RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
});

if (shouldStartHttp) {
  // IMPORTANT: Start HTTP server ASAP so Railway healthcheck can pass.
  // Any slower startup work (AI orchestrator init, smoke tests) must not block the listener.
  console.log('[STARTUP] Starting HTTP server...');
  const startTime = Date.now();

  server
    .startHTTP()
    .then(() => {
      const bootTime = Date.now() - startTime;
      console.log('[STARTUP] ✅ HTTP server fully operational');
      console.log('[STARTUP] Boot time:', bootTime, 'ms');
      console.log('[STARTUP] Process uptime:', process.uptime().toFixed(2), 'seconds');
      console.log('[STARTUP] Memory usage:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');

      // Health monitoring heartbeat - logs every 30 seconds
      setInterval(() => {
        console.log(
          '[HEARTBEAT] Server healthy | Uptime:',
          process.uptime().toFixed(0),
          's | Memory:',
          Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          'MB'
        );
      }, 30000);

      // Background init (non-blocking)
      void (async () => {
        console.log('[STARTUP] Initializing AIOrchestrator (background)...');
        try {
          await server.initializeOrchestrator();
          console.log('[STARTUP] AIOrchestrator initialization complete');
        } catch (error) {
          console.warn('[STARTUP] AIOrchestrator init failed (non-fatal):', error);
        }

        // Optional: OpenAI smoke tests (disabled by default)
        // Enable explicitly via RUN_OPENAI_SMOKE_TESTS=true
        const shouldRunSmokeTests = String(process.env.RUN_OPENAI_SMOKE_TESTS || '').toLowerCase() === 'true';
        if (shouldRunSmokeTests) {
        console.log('[STARTUP] Running OpenAI smoke tests (background)...');
        try {
          await runOpenAISmokeTests({ failFast: false });
        } catch (error) {
          console.warn('[STARTUP] OpenAI smoke tests failed (non-fatal):', error);
          }
        } else {
          console.log('[STARTUP] Skipping OpenAI smoke tests (set RUN_OPENAI_SMOKE_TESTS=true to enable)');
        }
      })();
    })
    .catch((err) => {
      console.error('[STARTUP ERROR] Failed to start HTTP server:', err);
      console.error('[STARTUP ERROR] Stack:', err?.stack);
      process.exit(1);
    });
} else {
  console.log('[STARTUP] Starting stdio server...');
  server.start().catch((err) => {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  });
}
