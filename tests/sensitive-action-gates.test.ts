import { describe, expect, it } from "vitest";
import {
  SENSITIVE_ACTION_STATES,
  redactSensitiveAuditPayload,
  validateSensitiveActionGate,
  type AgentDelegationMandateSnapshot,
  type ParentActionConfirmationSnapshot,
} from "../src/lib/sensitiveActionGates";

const now = new Date("2026-04-17T18:00:00.000Z");
const future = "2026-04-17T18:10:00.000Z";
const past = "2026-04-17T17:00:00.000Z";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

function confirmation(
  overrides: Partial<ParentActionConfirmationSnapshot> = {},
): ParentActionConfirmationSnapshot {
  return {
    id: "confirmation-1",
    user_id: userA,
    action_type: "register",
    action_summary: { program: "U8 soccer" },
    provider_key: "daysmart",
    provider_readiness_level: "navigation_verified",
    target_url: "https://pps.daysmartrecreation.com/signup",
    exact_program: "U8 soccer",
    expires_at: future,
    confirmed_at: "2026-04-17T17:55:00.000Z",
    consumed_at: null,
    idempotency_key: "idem-1",
    ...overrides,
  };
}

function mandate(overrides: Partial<AgentDelegationMandateSnapshot> = {}): AgentDelegationMandateSnapshot {
  return {
    id: "mandate-1",
    user_id: userA,
    provider_key: "daysmart",
    provider_readiness_required: "delegated_signup_candidate",
    target_program: "U8 soccer",
    max_total_cents: 25000,
    allowed_actions: ["delegate_signup", "submit_final", "pay"],
    stop_conditions: ["price_changed", "provider_uncertain"],
    expires_at: future,
    revoked_at: null,
    status: "active",
    ...overrides,
  };
}

describe("sensitive action gates", () => {
  it("declares the required sensitive-action state machine", () => {
    expect(SENSITIVE_ACTION_STATES).toEqual([
      "packet_prepared",
      "awaiting_parent_review",
      "registration_review_required",
      "registration_approved",
      "registration_submitted",
      "payment_review_required",
      "payment_approved",
      "payment_submitted",
      "waiver_review_required",
      "waiver_approved",
      "provider_login_required",
      "provider_login_approved",
      "final_submit_review_required",
      "final_submit_approved",
      "paused_for_parent",
      "delegated_signup_ready",
      "delegated_signup_running",
      "completed",
      "manual_fallback",
      "failed",
      "cancelled",
    ]);
  });

  it("blocks registration without fresh explicit parent confirmation", () => {
    const result = validateSensitiveActionGate({
      userId: userA,
      actionType: "register",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      now,
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("requires_parent_confirmation");
    expect(result.state).toBe("registration_review_required");
  });

  it("rejects stale and other-user confirmations", () => {
    const stale = validateSensitiveActionGate({
      userId: userA,
      actionType: "register",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      now,
    }, {
      confirmations: [confirmation({ expires_at: past })],
    });

    const otherUser = validateSensitiveActionGate({
      userId: userA,
      actionType: "register",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      now,
    }, {
      confirmations: [confirmation({ user_id: userB })],
    });

    expect(stale.allowed).toBe(false);
    expect(stale.reason).toBe("parent_confirmation_expired");
    expect(otherUser.allowed).toBe(false);
    expect(otherUser.reason).toBe("parent_confirmation_or_valid_mandate_required");
  });

  it("allows a confirmed registration while keeping payment as a separate gate", () => {
    const registration = validateSensitiveActionGate({
      userId: userA,
      actionType: "register",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      now,
    }, {
      confirmations: [confirmation()],
    });

    const payment = validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      amountCents: 2000,
      maxTotalCents: 25000,
      idempotencyKey: "pay-1",
      now,
    });

    expect(registration.allowed).toBe(true);
    expect(registration.status).toBe("registration_submitted");
    expect(payment.allowed).toBe(false);
    expect(payment.status).toBe("payment_review_required");
  });

  it("blocks stale payment, amount mismatch, over-cap payment, and idempotent duplicates", () => {
    const stalePayment = confirmation({
      id: "payment-1",
      action_type: "pay",
      amount_cents: 2000,
      expires_at: past,
      idempotency_key: "pay-1",
    });
    const mismatchedPayment = confirmation({
      id: "payment-2",
      action_type: "pay",
      amount_cents: 2000,
      idempotency_key: "pay-2",
    });
    const consumedPayment = confirmation({
      id: "payment-3",
      action_type: "pay",
      amount_cents: 2000,
      consumed_at: "2026-04-17T17:59:00.000Z",
      idempotency_key: "pay-3",
    });

    expect(validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      amountCents: 2000,
      maxTotalCents: 25000,
      idempotencyKey: "pay-1",
      now,
    }, { confirmations: [stalePayment] }).reason).toBe("parent_confirmation_expired");

    expect(validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      targetUrl: "https://pps.daysmartrecreation.com/signup",
      amountCents: 2500,
      maxTotalCents: 25000,
      idempotencyKey: "pay-2",
      now,
    }, { confirmations: [mismatchedPayment] }).status).toBe("payment_review_required");

    expect(validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      amountCents: 30000,
      maxTotalCents: 25000,
      now,
    }).reason).toBe("payment_over_price_cap");

    const duplicate = validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      amountCents: 2000,
      maxTotalCents: 25000,
      idempotencyKey: "pay-3",
      now,
    }, { confirmations: [consumedPayment] });

    expect(duplicate.status).toBe("payment_submitted");
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.allowed).toBe(false);
  });

  it("rejects model output and provider page text as authorization", () => {
    const modelResult = validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      amountCents: 2000,
      maxTotalCents: 25000,
      authorizationSource: "model_output",
      now,
    });
    const providerPageResult = validateSensitiveActionGate({
      userId: userA,
      actionType: "accept_waiver",
      authorizationSource: "provider_page",
      now,
    });

    expect(modelResult.allowed).toBe(false);
    expect(modelResult.reason).toBe("model_output_cannot_authorize_sensitive_action");
    expect(providerPageResult.allowed).toBe(false);
    expect(providerPageResult.reason).toBe("provider_page_cannot_authorize_sensitive_action");
  });

  it("future delegated mandate requires verified provider, exact provider/program, and price cap", () => {
    const validDelegation = validateSensitiveActionGate({
      userId: userA,
      actionType: "delegate_signup",
      providerKey: "daysmart",
      providerReadinessLevel: "delegated_signup_candidate",
      providerAutomationPolicyStatus: "written_permission_received",
      exactProgram: "U8 soccer",
      now,
    }, { mandates: [mandate()] });

    const unverifiedProvider = validateSensitiveActionGate({
      userId: userA,
      actionType: "delegate_signup",
      providerKey: "daysmart",
      providerReadinessLevel: "navigation_verified",
      exactProgram: "U8 soccer",
      now,
    }, { mandates: [mandate()] });

    const providerPolicyBlocked = validateSensitiveActionGate({
      userId: userA,
      actionType: "delegate_signup",
      providerKey: "campminder",
      providerReadinessLevel: "delegated_signup_candidate",
      exactProgram: "U8 soccer",
      now,
    }, { mandates: [mandate({ provider_key: "campminder" })] });

    const wrongProgram = validateSensitiveActionGate({
      userId: userA,
      actionType: "delegate_signup",
      providerKey: "daysmart",
      providerReadinessLevel: "delegated_signup_candidate",
      exactProgram: "U10 soccer",
      now,
    }, { mandates: [mandate()] });

    const overCap = validateSensitiveActionGate({
      userId: userA,
      actionType: "pay",
      providerKey: "daysmart",
      providerReadinessLevel: "delegated_signup_verified",
      providerAutomationPolicyStatus: "written_permission_received",
      exactProgram: "U8 soccer",
      amountCents: 26000,
      now,
    }, { mandates: [mandate()] });

    expect(validDelegation.allowed).toBe(true);
    expect(validDelegation.status).toBe("delegated_signup_ready");
    expect(unverifiedProvider.allowed).toBe(false);
    expect(providerPolicyBlocked.allowed).toBe(false);
    expect(providerPolicyBlocked.reason).toBe("provider_live_automation_not_authorized");
    expect(wrongProgram.allowed).toBe(false);
    expect(overCap.allowed).toBe(false);
    expect(overCap.status).toBe("payment_review_required");
  });

  it("redacts PII and secrets before audit payloads are stored or displayed", () => {
    const payload = redactSensitiveAuditPayload({
      child: { firstName: "Ava", dob: "2017-04-01" },
      name: "Ava Messinger",
      label: "Ava registration",
      title: "Ava class signup",
      parent_name: "Matt Messinger",
      guardian_name: "Matt Messinger",
      contact_name: "Matt Messinger",
      emergency_contact_name: "Matt Messinger",
      provider_name: "DaySmart / Dash",
      parentEmail: "parent@example.com",
      token: "secret-token",
      payment: { card_number: "4242424242424242", cvv: "123" },
      safe: { provider: "daysmart", step: "review" },
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("Ava");
    expect(serialized).not.toContain("Matt Messinger");
    expect(serialized).not.toContain("2017-04-01");
    expect(serialized).not.toContain("parent@example.com");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).toContain("daysmart");
    expect(serialized).toContain("DaySmart / Dash");
  });
});
