import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("sensitive action server contract", () => {
  it("creates confirmation and delegation mandate tables with RLS", () => {
    const migration = read("supabase/migrations/20260417140000_add_sensitive_action_gates.sql");
    const lockMigration = read("supabase/migrations/20260419170000_lock_sensitive_action_gates.sql");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.parent_action_confirmations");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.agent_delegation_mandates");
    expect(migration).toContain("ALTER TABLE public.parent_action_confirmations ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.agent_delegation_mandates ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("auth.uid() = user_id");
    expect(migration).toContain("Service role can manage parent confirmations");
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can create their own parent confirmations"');
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can update their own parent confirmations"');
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can delete their own parent confirmations"');
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can create their own delegation mandates"');
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can update their own delegation mandates"');
    expect(lockMigration).toContain('DROP POLICY IF EXISTS "Users can delete their own delegation mandates"');
    expect(lockMigration).toContain("User clients may read their own records but cannot create, confirm, consume, or delete");
  });

  it("keeps registration and payment as separate flows in the client orchestrator", () => {
    const flow = read("src/lib/registrationFlow.ts");

    expect(flow).toContain("registrationConfirmationId");
    expect(flow).toContain("Payment requires separate parent confirmation");
    expect(flow).toContain("payment_review_required");
    expect(flow).not.toContain("Step 5: Executing payment");
    expect(flow).not.toContain("executePayment({");
  });

  it("requires server-verified confirmations or future mandates before run-plan sensitive actions", () => {
    const runPlan = read("supabase/functions/run-plan/index.ts");

    expect(runPlan).toContain("parent_action_confirmations");
    expect(runPlan).toContain("agent_delegation_mandates");
    expect(runPlan).toContain("getAuthenticatedUser");
    expect(runPlan).toContain("model_output");
    expect(runPlan).not.toContain("confirm_booking");
    expect(runPlan).toContain("registration_submit_paused_until_confirmed_provider_executor_is_available");
  });

  it("disables automated payment charge functions until payment gates are proven safe", () => {
    const chargeSuccess = read("supabase/functions/stripe-charge-success/index.ts");
    const chargeSuccessFee = read("supabase/functions/stripe-charge-success-fee/index.ts");
    const stripeProvider = read("mcp_server/providers/stripe.ts");

    [chargeSuccess, chargeSuccessFee].forEach((source) => {
      expect(source).toContain("parent_action_confirmation_id");
      expect(source).toContain("idempotency_key");
      expect(source).toContain("automated_payment_disabled_until_verified_provider_payment_gate");
      expect(source).not.toContain("paymentIntents.create");
      expect(source).not.toContain("confirm: true");
      expect(source).not.toContain("off_session: true");
    });

    expect(stripeProvider).toContain("ENABLE_MCP_SUCCESS_FEE_CHARGE");
    expect(stripeProvider).toContain("SUCCESS_FEE_CHARGE_PAUSED");
    expect(stripeProvider.indexOf("SUCCESS_FEE_CHARGE_PAUSED")).toBeLessThan(
      stripeProvider.indexOf("paymentIntents.create"),
    );
  });

  it("blocks direct mcp-executor write-tool bypasses and redacts logs", () => {
    const executor = read("supabase/functions/mcp-executor/index.ts");

    expect(executor).toContain("SENSITIVE_WRITE_TOOLS");
    expect(executor).toContain("'bookeo.confirm_booking'");
    expect(executor).toContain("sensitive_action_confirmation_required");
    expect(executor).toContain("status: 409");
    expect(executor).toContain("redactForLog");
    expect(executor).not.toContain("mcp-executor invoked with body:");
    expect(executor).not.toContain("with args:");
  });

  it("does not trust client-supplied mandate credentials or tokens", () => {
    const mandateIssueV2 = read("supabase/functions/mandate-issue-v2/index.ts");

    expect(mandateIssueV2).toContain(".select('id, user_id, provider, status')");
    expect(mandateIssueV2).toContain(".eq('id', credential_id)");
    expect(mandateIssueV2).toContain(".eq('user_id', user.id)");
    expect(mandateIssueV2).toContain(".eq('provider', provider)");
    expect(mandateIssueV2).toContain("jws_compact: jws");
    expect(mandateIssueV2).not.toContain(".select('*')");
    expect(mandateIssueV2).not.toContain("jws_compact || jws");
    expect(mandateIssueV2).not.toContain("Query results:");
  });

  it("keeps final receipt copy honest when the success fee is paused", () => {
    const orchestrator = read("mcp_server/ai/APIOrchestrator.ts");

    expect(orchestrator).toContain("success_fee_cents: charge_id ? 2000 : 0");
    expect(orchestrator).toContain("SignupAssist did not charge the");
  });

  it("pauses scheduled registration worker before provider submit/payment", () => {
    const worker = read("mcp_server/worker/scheduledRegistrationWorker.ts");

    expect(worker).toContain("scheduled_registration_paused_for_parent_review");
    expect(worker).toContain("requires the new sensitive-action confirmation");
    expect(worker).toContain("SignupAssist does not charge a success fee until payment gates are proven safe");
  });
});
