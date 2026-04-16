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

  it("carries finder and reminder context into the helper packet", () => {
    const packet = buildAutopilotRunPacket({
      playbook: findPlaybookByKey("generic"),
      targetUrl: "https://ymca.example/signup",
      targetProgram: "Swim lessons at Lakeside YMCA",
      participantAgeYears: 7,
      registrationOpensAt: "2026-05-01T09:00",
      maxTotalCents: 18000,
      finder: {
        query: "swim lessons at YMCA for age 7",
        status: "guided_autopilot",
        venue: "Lakeside YMCA",
        address: "1 Pool Way, Madison, WI",
        location: "Madison, WI",
      },
      reminder: {
        minutesBefore: 10,
        channels: ["email", "sms"],
        phoneNumber: "(555) 010-1111",
      },
      child: null,
      preflight: buildPreflightState(),
    });

    expect(packet.target.participantAgeYears).toBe(7);
    expect(packet.finder?.status).toBe("guided_autopilot");
    expect(packet.reminder.channels).toEqual(["email", "sms"]);
    expect(packet.reminder.minutesBefore).toBe(10);
  });
});
