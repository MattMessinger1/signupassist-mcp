import { describe, expect, it } from "vitest";
import { findPlaybookByKey } from "../src/lib/autopilot/playbooks";
import {
  FUTURE_SET_AND_FORGET_SUCCESS_FEE_CENTS,
  SUPERVISED_AUTOPILOT_SUCCESS_FEE_CENTS,
  buildAutopilotRunPacket,
  buildPreflightState,
  calculateReadinessScore,
} from "../src/lib/autopilot/runPacket";

describe("autopilot run packets", () => {
  it("records V1 supervised billing without charging the future success fee", () => {
    const packet = buildAutopilotRunPacket({
      playbook: findPlaybookByKey("active"),
      targetUrl: "https://register.active.com/soccer",
      targetProgram: "U8 soccer",
      registrationOpensAt: "2026-05-01T09:00",
      maxTotalCents: 25000,
      child: { id: "child_123", name: "Ava M." },
      preflight: buildPreflightState({
        providerAccountReady: true,
        childProfileReady: true,
        paymentPrepared: true,
        helperInstalled: true,
        targetUrlConfirmed: true,
      }),
    });

    expect(packet.mode).toBe("supervised_autopilot");
    expect(packet.billing.successFeeCents).toBe(SUPERVISED_AUTOPILOT_SUCCESS_FEE_CENTS);
    expect(packet.billing.futureSetAndForgetSuccessFeeCents).toBe(FUTURE_SET_AND_FORGET_SUCCESS_FEE_CENTS);
    expect(packet.payment.providerFeeHandling).toBe("provider_direct");
    expect(packet.payment.helperPausesAtCheckout).toBe(true);
    expect(packet.readiness.score).toBe(100);
    expect(packet.setAndForgetFoundation.finalSubmitRequiresParentApproval).toBe(true);
  });

  it("scores readiness from preflight checks", () => {
    const preflight = buildPreflightState({
      providerAccountReady: true,
      childProfileReady: true,
      targetUrlConfirmed: true,
    });

    expect(calculateReadinessScore(preflight)).toBe(60);
  });
});
