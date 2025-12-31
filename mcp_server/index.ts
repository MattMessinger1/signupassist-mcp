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
    case "3": return "Review & consent";
    case "4": return "Payment (Stripe)";
    case "5": return "Registering";
  }
}

function inferWizardStep(ctxStep: OrchestratorStep): WizardStep {
  if (ctxStep === "FORM_FILL") return "2";
  if (ctxStep === "REVIEW") return "3";
  if (ctxStep === "PAYMENT") return "4";
  if (ctxStep === "SUBMIT" || ctxStep === "COMPLETED") return "5";
  return "1";
}

function ensureWizardHeaderAlways(message: string, wizardStep: WizardStep): string {
  const msg = (message || "").trim();
  // Use bold header to reduce the chance ChatGPT strips the first line when rendering tool output.
  const desiredHeader = `**Step ${wizardStep}/5 — ${wizardTitle(wizardStep)}**`;

  // If already has any Step X/5 header, replace it with the correct one.
  if (/^\*{0,2}Step\s+[1-5]\/5\s+—/i.test(msg)) {
    return msg.replace(/^\*{0,2}Step\s+[1-5]\/5\s+—[^\n]*\n*/i, `${desiredHeader}\n\n`);
  }

  return `${desiredHeader}\n\n${msg}`;
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

function ensureSuccessFeeDisclosure(message: string): string {
  if (!message) return message;
  const mentionsFee = /\bsuccess fee\b/i.test(message) || /\$20\b/i.test(message) || /\bsignupassist\b/i.test(message);
  if (!mentionsFee) return message;

  const disclosure = [
    "✅ Pricing & payment",
    "- SignupAssist charges a **$20 success fee only after we successfully secure your spot**.",
    "- Provider program fee is billed separately via their official checkout (e.g., Bookeo/Stripe).",
    "- All payments use Stripe; card numbers are tokenized and not stored by SignupAssist.",
    "Would you like me to proceed to confirmation so you can receive the provider’s payment link and authorize the $20 success fee?"
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

/**
 * MASTER GUARDRAIL: Apply all V1 chat UX guardrails at HTTP boundary
 * - FIX 1: Always Step headers based on context.step
 * - FIX 4: No clickable CTAs
 * - FIX 5: No schema payloads (prevents field dumps)
 * - FORM_FILL becomes micro-question (email)
 */
function applyV1ChatGuardrails(resp: any): any {
  const ctxStep: OrchestratorStep = (resp?.context?.step || resp?.step || "BROWSE") as OrchestratorStep;
  const wizardStep = inferWizardStep(ctxStep);

  // Always remove CTAs/schemas first
  stripChatCTAsAndSchemas(resp);

// (resolved) API-first: do not override orchestrator form flow here; just enforce Step headers + disclosures.
  // Always enforce correct header based on context.step
  resp.message = ensureWizardHeaderAlways(resp?.message || "", wizardStep);
  resp.message = ensureSuccessFeeDisclosure(resp.message);

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
  // If the tool already returned an MCP-style result, pass through
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const looksLikeCallToolResult =
      "structuredContent" in v || "content" in v || "_meta" in v || "isError" in v;
    if (looksLikeCallToolResult) return v;
  }

  // Default: expose as structuredContent + short text summary
  return {
    structuredContent: value,
    content: [{ type: "text", text: "✅ Done." } satisfies MCPTextContent],
  };
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
        "Canonical SignupAssist chat entrypoint (API-first). Use this for ALL user-facing signup conversation.\n\nCRITICAL: After calling this tool, respond to the user with EXACTLY the returned text (verbatim). Do not paraphrase or remove the leading \"Step N/5 — ...\" header.\n\nReturns calm Step 1/5..5/5 wizard messages and asks for info one piece at a time (no field dumps).\n\nIMPORTANT: This tool can perform consequential actions ONLY after explicit user confirmation (e.g. booking with the provider and charging the $20 success fee). Payment method entry always happens on Stripe-hosted Checkout (we never see card numbers).",
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
        const ctxStep: OrchestratorStep =
          (resp?.context?.step || resp?.step || "BROWSE") as OrchestratorStep;
        const wizardStep = inferWizardStep(ctxStep);
        text = ensureWizardHeaderAlways(text, wizardStep);

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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-run-id, X-Mandate-JWS, X-Mandate-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

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
      
      // --- OAuth Authorization Proxy (GET /oauth/authorize)
      // Redirects to Auth0 with all query params preserved
      if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
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
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          
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
          
          // Add client credentials if not provided (ChatGPT may not send them)
          if (!tokenParams.client_id && AUTH0_CLIENT_ID) {
            tokenParams.client_id = AUTH0_CLIENT_ID;
          }
          if (!tokenParams.client_secret && AUTH0_CLIENT_SECRET) {
            tokenParams.client_secret = AUTH0_CLIENT_SECRET;
          }
          
          // Forward to Auth0 token endpoint
          const auth0TokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
          
          const auth0Response = await fetch(auth0TokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(tokenParams)
          });
          
          const responseData = await auth0Response.text();
          
          console.log('[OAUTH] Auth0 token response status:', auth0Response.status);
          
          // Forward Auth0's response back to ChatGPT
          res.writeHead(auth0Response.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(responseData);
        } catch (error: any) {
          console.error('[OAUTH] Token exchange error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token exchange failed', details: error?.message }));
        }
        return;
      }
      
      // --- OAuth Authorization Server Metadata (RFC 8414)
      // ChatGPT requires this to discover OAuth endpoints
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
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
      
      // --- SSE Connection Endpoint (GET /sse)
      // Establishes a Server-Sent Events connection for ChatGPT
      if (req.method === 'GET' && url.pathname === '/sse') {
        console.log('[SSE] New SSE connection request');
        
        try {
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

          // IMPORTANT (ChatGPT Apps OAuth):
          // Some clients do not initiate OAuth correctly if the initial SSE connect is blocked.
          // We therefore allow unauthenticated /sse connections, but enforce OAuth on /messages for tools/call.
          // This still prevents any tool execution without auth, while allowing clients to reach the
          // 401 at tool-call time and complete the OAuth flow.
          if (!isAuthorized) {
            console.log('[AUTH] Unauthenticated SSE connection allowed (OAuth enforced on /messages tools/call)');
          } else {
            console.log(`[AUTH] Authorized SSE connection via ${authSource}${boundUserId ? ` user=${boundUserId}` : ''}`);
          }

          // Create SSE transport - it will set its own headers
          const transport = new SSEServerTransport('/messages', res);
          
          // ✅ connect() calls start() internally - do NOT call start() manually!
          await this.server.connect(transport);
          
          // ✅ Use the transport's built-in sessionId (not our own UUID)
          const sessionId = transport.sessionId;
          this.sseTransports.set(sessionId, transport);

          // Bind sessionId → Auth0 sub for downstream /messages injection
          if (boundUserId) {
            this.sseSessionUserIds.set(sessionId, boundUserId);
          }
          
          console.log(`[SSE] MCP server connected, session: ${sessionId}`);
          console.log(`[SSE] Active sessions: ${this.sseTransports.size}`);
          
          // Handle connection close
          req.on('close', () => {
            console.log(`[SSE] Connection closed: ${sessionId}`);
            this.sseTransports.delete(sessionId);
            this.sseSessionUserIds.delete(sessionId);
            console.log(`[SSE] Remaining sessions: ${this.sseTransports.size}`);
          });
          
        } catch (error) {
          console.error(`[SSE] Failed to setup SSE transport:`, error);
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
      if (req.method === 'POST' && url.pathname === '/messages') {
        console.log('[SSE] Received POST /messages');
        
        try {
          // Get session ID from query parameter (set by SSEServerTransport)
          const sessionId = url.searchParams.get('sessionId');

          if (!sessionId) {
            console.error('[SSE] No sessionId in /messages request');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
            return;
          }

          // ================================================================
          // AUTH (PRODUCTION): Require OAuth (Auth0 JWT) or internal MCP_ACCESS_TOKEN
          // Also: bind / refresh sessionId → userId mapping so we can inject into tools.
          // ================================================================
          const isProd = process.env.NODE_ENV === 'production';
          const authHeader = req.headers['authorization'] as string | undefined;
          const expectedToken = process.env.MCP_ACCESS_TOKEN;

          // Read request body (we need method name to decide whether auth is required)
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
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

          // Targeted debug logging (always redacted). Never log raw message bodies in prod.
          // NOTE: We may not have verifiedUserId until after auth; we re-check below after auth.
          const maybeToolName = parsed?.params?.name ? String(parsed.params.name) : undefined;
          if (isDebugLoggingEnabled() && !isProd) {
            console.log('[DEBUG] /messages (dev) method:', methodName, 'tool:', maybeToolName);
          }

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
          if (isProd && isToolCall && !isAuthorized) {
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
            return;
          }

          // Persist a user binding for this SSE session if we have it.
          if (verifiedUserId) {
            this.sseSessionUserIds.set(sessionId, verifiedUserId);
          }

          const transport = this.sseTransports.get(sessionId);
          
          if (!transport) {
            console.error(`[SSE] No transport found for session: ${sessionId}`);
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
          
        } catch (error: any) {
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

          console.log('[DEBUG] Calling Bookeo:', debugUrl.toString().replace(secretKey, '***'));

          const r = await fetch(debugUrl, { method: 'GET' });
          const text = await r.text();

          console.log('[DEBUG] Bookeo response status:', r.status);
          console.log('[DEBUG] Bookeo response body:', text);

          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(text);
        } catch (err: any) {
          console.error('[DEBUG] Bookeo error:', err);
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

          console.log(`[LOCATION] Looking up IP: ${clientIp}`);
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
            console.error('[LOCATION] Invalid ipapi.co response:', data);
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
      if (req.method === 'GET' && url.pathname === '/mcp/manifest.json') {
        try {
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
      if (req.method === 'GET' && (url.pathname === '/mcp' || url.pathname === '/mcp/')) {
        try {
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
        req.method === 'GET' &&
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
                await verifyAuth0Token(bearerToken);
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
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            let { tool, args } = parsed;
            if (!tool) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing required field: tool' }));
              return;
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
        });
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
        req.method === "GET" &&
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
        req.method === "GET" &&
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
            const ctxStep: OrchestratorStep = (result?.context?.step || result?.step || "BROWSE") as OrchestratorStep;
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
      if (req.method === 'GET' && url.pathname === '/.well-known/chatgpt-apps-manifest.json') {
        console.log('[MANIFEST] Serving ChatGPT Apps manifest (V1 chat-only)');
        
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
