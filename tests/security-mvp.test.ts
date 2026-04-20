import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  corsHeadersForRequest,
  resolveCorsAllowOrigin,
} from "../mcp_server/lib/httpSecurity";
import {
  safeTargetUrlHost,
  validateTargetUrl,
  validateTargetUrlRedirectChain,
  validateTargetUrlWithResolvedIps,
} from "../mcp_server/lib/targetUrlSafety";
import {
  redactSensitiveAuditPayload,
  validateSensitiveActionGate,
  type AgentDelegationMandateSnapshot,
  type ParentActionConfirmationSnapshot,
} from "../src/lib/sensitiveActionGates";
import { buildAutopilotIntentPath } from "../src/lib/signupIntent";
import { buildRedactedProviderObservation } from "../src/lib/providerLearning";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-04-17T19:00:00.000Z");
const future = "2026-04-17T19:10:00.000Z";

function confirmationForUser(userId: string): ParentActionConfirmationSnapshot {
  return {
    id: "confirmation-1",
    user_id: userId,
    action_type: "register",
    provider_key: "daysmart",
    provider_readiness_level: "navigation_verified",
    target_url: "https://pps.daysmartrecreation.com/signup",
    exact_program: "U8 soccer",
    expires_at: future,
    confirmed_at: "2026-04-17T18:55:00.000Z",
    consumed_at: null,
    idempotency_key: "register-1",
  };
}

function mandateForUser(userId: string): AgentDelegationMandateSnapshot {
  return {
    id: "mandate-1",
    user_id: userId,
    provider_key: "daysmart",
    provider_readiness_required: "delegated_signup_candidate",
    target_program: "U8 soccer",
    max_total_cents: 25000,
    allowed_actions: ["delegate_signup", "submit_final"],
    stop_conditions: ["price_changed"],
    expires_at: future,
    revoked_at: null,
    status: "active",
  };
}

describe("MVP security regression suite", () => {
  it("rejects SSRF-prone and unsafe target URLs", async () => {
    [
      null,
      "",
      "notaurl",
      "file:///etc/passwd",
      "ftp://example.com/signup",
      "javascript:alert(1)",
      "data:text/html,hello",
      "https://localhost/signup",
      "https://signup-internal/signup",
      "https://service.internal/signup",
      "https://127.0.0.1/signup",
      "https://10.0.0.5/signup",
      "https://172.16.0.5/signup",
      "https://172.31.255.255/signup",
      "https://192.168.1.5/signup",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/signup",
      "https://[fc00::1]/signup",
      "https://[fd00::1]/signup",
      "https://[fe80::1]/signup",
      "https://user:pass@example.com/signup",
    ].forEach((candidate) => {
      expect(validateTargetUrl(candidate).ok, String(candidate)).toBe(false);
    });

    expect(validateTargetUrl("https://register.active.com/soccer").ok).toBe(true);
    expect(validateTargetUrl("http://example.com/signup").ok).toBe(true);
    expect(validateTargetUrl("http://example.com/signup", { environment: "production" })).toMatchObject({
      ok: false,
      reason: "url_https_required",
    });
    expect(validateTargetUrl("http://localhost:5173/signup", {
      environment: "development",
      allowLocalhostInNonProduction: true,
    }).ok).toBe(true);
    expect(validateTargetUrl("https://register.active.com/soccer", {
      allowedProviderDomains: ["active.com"],
    }).ok).toBe(true);
    expect(validateTargetUrl("https://evil.example/soccer", {
      allowedProviderDomains: ["active.com"],
    })).toMatchObject({
      ok: false,
      reason: "url_provider_domain_not_allowed",
    });
    expect(safeTargetUrlHost("https://pps.daysmartrecreation.com/dash?token=secret")).toBe("pps.daysmartrecreation.com");

    expect(validateTargetUrlRedirectChain([
      "https://register.active.com/soccer",
      "http://169.254.169.254/latest/meta-data",
    ])).toMatchObject({
      ok: false,
      reason: "redirect_url_private_ip_not_allowed",
    });

    await expect(
      validateTargetUrlWithResolvedIps("https://provider.example/signup", async () => ["10.0.0.10"]),
    ).resolves.toMatchObject({
      ok: false,
      reason: "dns_resolved_private_ip_not_allowed",
    });
  });

  it("keeps Activity Finder handoff details out of route query params", () => {
    const path = buildAutopilotIntentPath("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
    const url = new URL(path, "https://app.signupassist.test");

    expect(url.pathname).toBe("/autopilot");
    expect([...url.searchParams.keys()]).toEqual(["intent"]);
    [
      "finderQuery",
      "activity",
      "venue",
      "address",
      "age",
      "grade",
      "location",
      "targetUrl",
      "providerName",
      "providerKey",
      "child",
      "profile",
    ].forEach((key) => expect(url.searchParams.has(key)).toBe(false));
  });

  it("blocks cross-user confirmations and mandates", () => {
    const confirmationResult = validateSensitiveActionGate({
      userId: userA,
      actionType: "register",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      now,
    }, {
      confirmations: [confirmationForUser(userB)],
    });

    const mandateResult = validateSensitiveActionGate({
      userId: userA,
      actionType: "delegate_signup",
      providerKey: "daysmart",
      providerReadinessLevel: "delegated_signup_candidate",
      exactProgram: "U8 soccer",
      now,
    }, {
      mandates: [mandateForUser(userB)],
    });

    expect(confirmationResult.allowed).toBe(false);
    expect(mandateResult.allowed).toBe(false);
  });

  it("treats provider prompt-injection content as untrusted data", () => {
    const fixture = readFileSync("tests/fixtures/security/provider-prompt-injection.html", "utf8");

    ["register", "pay", "provider_login", "accept_waiver", "submit_final"].forEach((actionType) => {
      const result = validateSensitiveActionGate({
        userId: userA,
        actionType: actionType as "register" | "pay" | "provider_login" | "accept_waiver" | "submit_final",
        amountCents: actionType === "pay" ? 2000 : null,
        maxTotalCents: 25000,
        authorizationSource: "provider_page",
        now,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("provider_page_cannot_authorize_sensitive_action");
    });

    const observation = buildRedactedProviderObservation({
      id: "run-1",
      provider_key: "daysmart",
      target_url: "https://pps.daysmartrecreation.com/signup",
      target_program: "U8 soccer",
      status: "paused",
      caps: {
        provider_page_content: fixture,
        child: { full_name: "Ava Messinger", dob: "2017-04-01" },
        payment: { card_number: "4242424242424242" },
      },
      audit_events: [{ type: "provider_page_observed" }],
    });
    const serialized = JSON.stringify(observation);

    expect(observation.promotion.automatic).toBe(false);
    expect(observation.readiness_level).not.toBe("delegated_signup_verified");
    expect(serialized).not.toContain("IGNORE PREVIOUS INSTRUCTIONS");
    expect(serialized).not.toContain("Ava Messinger");
    expect(serialized).not.toContain("2017-04-01");
    expect(serialized).not.toContain("4242424242424242");
  });

  it("redacts sensitive log and audit payloads", () => {
    const redacted = redactSensitiveAuditPayload({
      childDob: "2017-04-01",
      fullAddress: "123 Family Lane, Madison WI",
      phone: "(555) 010-0000",
      medicalNotes: "asthma",
      allergyNotes: "peanuts",
      credentialPassword: "provider-password",
      token: "secret-token",
      payment: { card: "4242424242424242", cvv: "123" },
      providerPassword: "provider-secret",
      safe: { provider: "daysmart", state: "paused_for_parent" },
    });
    const serialized = JSON.stringify(redacted);

    [
      "2017-04-01",
      "123 Family Lane",
      "(555) 010-0000",
      "asthma",
      "peanuts",
      "provider-password",
      "secret-token",
      "4242424242424242",
      "provider-secret",
    ].forEach((sensitive) => expect(serialized).not.toContain(sensitive));
    expect(serialized).toContain("daysmart");
  });

  it("verifies ChatGPT approval public surface and security scaffolding stay pinned", () => {
    const openapi = JSON.parse(readFileSync("mcp/openapi.json", "utf8")) as {
      paths?: Record<string, Record<string, { operationId?: string }>>;
    };
    const manifest = readFileSync("mcp/manifest.json", "utf8");
    const operationIds = Object.values(openapi.paths ?? {})
      .flatMap((pathItem) => Object.values(pathItem))
      .map((operation) => operation.operationId)
      .filter(Boolean)
      .sort();
    const server = readFileSync("mcp_server/index.ts", "utf8");
    const signupIntentApi = readFileSync("mcp_server/lib/signupIntentApi.ts", "utf8");

    expect(operationIds).toEqual(["register_for_activity", "search_activities"]);
    expect(manifest).not.toContain("signup-intents");
    expect(JSON.stringify(openapi)).not.toContain("/api/signup-intents");
    expect(server).toContain("X-Content-Type-Options");
    expect(server).toContain("Permissions-Policy");
    expect(server).toContain("consumeRateLimit");
    expect(server).toContain(":activity_finder_search");
    expect(server).toContain("corsHeadersForRequest(req)");
    expect(server).toContain("ENABLE_BOOKEO_DEBUG_ENDPOINT");
    expect(server).toContain("process.env.NODE_ENV !== 'production'");
    expect(signupIntentApi).toContain(":signup_intents");
  });

  it("supports env-based CORS allowlists for web-only APIs", () => {
    expect(resolveCorsAllowOrigin("https://app.signupassist.com", {
      CORS_ALLOW_ORIGINS: "https://app.signupassist.com,https://chat.openai.com",
    })).toBe("https://app.signupassist.com");
    expect(resolveCorsAllowOrigin("https://evil.example", {
      CORS_ALLOW_ORIGINS: "https://app.signupassist.com",
    })).toBe("null");
    expect(resolveCorsAllowOrigin("https://anything.example", {})).toBe("*");

    const headers = corsHeadersForRequest({
      headers: { origin: "https://app.signupassist.com" },
    } as never, {
      CORS_ALLOW_ORIGINS: "https://app.signupassist.com",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.signupassist.com");
    expect(headers.Vary).toBe("Origin");
  });

  it("keeps test harnesses, admin surfaces, and MCP bearer tokens out of the production web app", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const header = readFileSync("src/components/Header.tsx", "utf8");
    const mcpClient = readFileSync("src/lib/chatMcpClient.ts", "utf8");
    const discoveryRuns = readFileSync("src/pages/DiscoveryRuns.tsx", "utf8");
    const planBuilder = readFileSync("src/pages/PlanBuilder.tsx", "utf8");
    const mcpChatTest = readFileSync("src/pages/MCPChatTest.tsx", "utf8");
    const stripeContext = readFileSync("src/contexts/StripeContext.tsx", "utf8");
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(app).toContain("isTestRoutesEnabled");
    expect(app).toContain("testRoutesEnabled &&");
    expect(app).not.toContain('import ChatTestHarness from "./pages/ChatTestHarness"');
    expect(app).not.toContain('import MCPChatTest from "./pages/MCPChatTest"');

    expect(header).toContain("isTestRoutesEnabled");
    expect(header).toContain("testRoutesEnabled &&");
    expect(header).toContain("isAdminSurfaceEnabled");

    expect(mcpClient).not.toContain("VITE_MCP_ACCESS_TOKEN");
    expect(dockerfile).not.toContain("VITE_MCP_ACCESS_TOKEN");
    expect(mcpClient).toContain("signupassist_mcp_test_token");
    expect(mcpClient).toContain("!import.meta.env.DEV && import.meta.env.VITE_ENABLE_TEST_ROUTES !== 'true'");

    expect(discoveryRuns).toContain("isAdminSurfaceEnabled");
    expect(discoveryRuns).toContain("Admin access required");
    expect(discoveryRuns).not.toContain(".select('*')");

    expect(planBuilder).not.toContain("pk_test_");
    expect(mcpChatTest).not.toContain("pk_test_");
    expect(stripeContext).not.toContain("pk_test_");
    expect(planBuilder).toContain("VITE_STRIPE_PUBLISHABLE_KEY");
    expect(stripeContext).toContain("VITE_STRIPE_PUBLISHABLE_KEY");
  });

  it("requires public HTTPS provider URLs in Autopilot production setup", () => {
    const autopilot = readFileSync("src/pages/Autopilot.tsx", "utf8");

    expect(autopilot).toContain('url.protocol !== "https:"');
    expect(autopilot).toContain("import.meta.env.PROD");
    expect(autopilot).toContain("url.username || url.password");
    expect(autopilot).toContain('hostname.startsWith("10.")');
    expect(autopilot).toContain('hostname.startsWith("192.168.")');
    expect(autopilot).toContain("(?:fc|fd)");
    expect(autopilot).toContain("fe80");
    expect(autopilot).toContain("hostname.endsWith(\".internal\")");
    expect(autopilot).toContain("public HTTPS signup page URL");
  });

  it("locks provider-learning raw tables and RPCs behind service/admin mediation", () => {
    const migration = readFileSync("supabase/migrations/20260419183000_lock_provider_learning_and_audit_events.sql", "utf8");

    expect(migration).toContain('DROP POLICY IF EXISTS "Authenticated users can read discovery_runs"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Authenticated users can read discovery_hints"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Authenticated users can read program_fingerprints"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Users can create their own signup intent events"');
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.upsert_discovery_run");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.get_best_hints");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.refresh_best_hints");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.upsert_discovery_run");
  });

  it("keeps sensitive edge functions auth-bound and fail-closed", () => {
    const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
    const createSystemMandate = readFileSync("supabase/functions/create-system-mandate/index.ts", "utf8");
    const stripeRefund = readFileSync("supabase/functions/stripe-refund-success-fee/index.ts", "utf8");
    const runPlan = readFileSync("supabase/functions/run-plan/index.ts", "utf8");
    const executor = readFileSync("supabase/functions/mcp-executor/index.ts", "utf8");

    expect(supabaseConfig).toContain("[functions.create-system-mandate]");
    expect(supabaseConfig).toContain("verify_jwt = true");
    expect(supabaseConfig).toMatch(/\[functions\.test-provider-search\]\s+verify_jwt = true/);
    expect(supabaseConfig).toMatch(/\[functions\.orchestrator-test\]\s+verify_jwt = true/);
    expect(supabaseConfig).toMatch(/\[functions\.testHarness\]\s+verify_jwt = true/);
    expect(supabaseConfig).toMatch(/\[functions\.setup-system-user\]\s+verify_jwt = true/);
    expect(supabaseConfig).toMatch(/\[functions\.debug-env\]\s+verify_jwt = true/);
    expect(createSystemMandate).toContain("ENABLE_SYSTEM_MANDATE_ISSUE");
    expect(createSystemMandate).toContain("system_mandate_issue_disabled");
    expect(createSystemMandate).toContain("Authorization");
    expect(createSystemMandate).toContain("user_id !== authData.user.id");

    expect(stripeRefund).toContain("auth.getUser()");
    expect(stripeRefund).toContain("mandates!inner(user_id)");
    expect(stripeRefund).toContain("chargeOwner !== authData.user.id");

    expect(runPlan).toContain("consumeParentConfirmation");
    expect(runPlan).toContain("providerAutomationPolicyAllowsLiveAction");
    expect(runPlan).toContain("confirmation_consumed_failed");
    expect(runPlan).toContain("plan.user_id !== user.id");

    expect(executor).toContain("getUserIdFromJwt");
    expect(executor).toContain("plan.user_id !== authenticatedUserId");
  });
});
