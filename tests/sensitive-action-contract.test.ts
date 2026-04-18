import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("sensitive action server contract", () => {
  it("creates confirmation and delegation mandate tables with RLS", () => {
    const migration = read("supabase/migrations/20260417140000_add_sensitive_action_gates.sql");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.parent_action_confirmations");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.agent_delegation_mandates");
    expect(migration).toContain("ALTER TABLE public.parent_action_confirmations ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.agent_delegation_mandates ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("auth.uid() = user_id");
    expect(migration).toContain("Service role can manage parent confirmations");
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

    [chargeSuccess, chargeSuccessFee].forEach((source) => {
      expect(source).toContain("parent_action_confirmation_id");
      expect(source).toContain("idempotency_key");
      expect(source).toContain("automated_payment_disabled_until_verified_provider_payment_gate");
      expect(source).not.toContain("paymentIntents.create");
      expect(source).not.toContain("confirm: true");
      expect(source).not.toContain("off_session: true");
    });
  });

  it("pauses scheduled registration worker before provider submit/payment", () => {
    const worker = read("mcp_server/worker/scheduledRegistrationWorker.ts");

    expect(worker).toContain("scheduled_registration_paused_for_parent_review");
    expect(worker).toContain("requires the new sensitive-action confirmation");
    expect(worker).toContain("SignupAssist does not charge a success fee until payment gates are proven safe");
  });
});
