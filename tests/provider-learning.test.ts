import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROVIDER_REGISTRY,
  buildDiscoveryRunPayloadFromObservation,
  buildRedactedProviderObservation,
  getProviderReadinessSummary,
} from "../src/lib/providerLearning";

describe("provider learning foundation", () => {
  it("maps the initial provider registry from existing playbooks", () => {
    expect(PROVIDER_REGISTRY.map((provider) => provider.key)).toEqual([
      "active",
      "daysmart",
      "amilia",
      "civicrec-recdesk",
      "campminder",
      "generic",
    ]);

    const daysmart = getProviderReadinessSummary("daysmart");
    expect(daysmart.readinessLevel).toBe("navigation_verified");
    expect(daysmart.supportedActions).toContain("Fill known family profile fields");
    expect(daysmart.stopConditions).toContain("Final submit, register, checkout, or purchase button");
    expect(daysmart.promotionPolicy.modelOutputCanPromote).toBe(false);
    expect(daysmart.promotionPolicy.providerPageContentCanPromote).toBe(false);
  });

  it("keeps mapped fixture coverage tied to repository fixtures", () => {
    PROVIDER_REGISTRY.filter((provider) => provider.key !== "generic").forEach((provider) => {
      expect(provider.fixtureCoverage.hasCoverage).toBe(true);
      provider.fixtureCoverage.paths.forEach((path) => {
        expect(existsSync(path)).toBe(true);
      });
    });

    expect(getProviderReadinessSummary("generic").readinessLevel).toBe("recognized");
  });

  it("creates redacted provider observations from supervised run data", () => {
    const observation = buildRedactedProviderObservation({
      id: "run_123",
      provider_key: "daysmart",
      provider_name: "DaySmart / Dash",
      target_url: "https://pps.daysmartrecreation.com/dash/index.php?token=secret-token",
      target_program: "Ava private soccer session",
      status: "paused",
      caps: {
        max_total_cents: 25000,
        child: {
          first_name: "Ava",
          last_name: "Messinger",
          dob: "2017-04-01",
          allergies: "peanuts",
        },
        requester: {
          name: "Ava Messinger",
          label: "Ava registration",
          title: "Ava class signup",
          parent_name: "Matt Messinger",
          guardian_name: "Matt Messinger",
          contact_name: "Matt Messinger",
          emergency_contact_name: "Matt Messinger",
        },
        finder: {
          query: "soccer for Ava near home",
          address: "123 Family Lane",
          status: "guided_autopilot",
        },
        payment: {
          card_number: "4242424242424242",
          cvv: "123",
        },
        provider_learning: {
          stop_condition: "Parent must review waiver",
        },
      },
      allowed_actions: ["Fill known family profile fields"],
      stop_conditions: ["Payment screen"],
      audit_events: [
        {
          type: "run_created",
          details: {
            child_name: "Ava Messinger",
            email: "parent@example.com",
            token: "secret-token",
          },
        },
      ],
      created_at: "2026-04-17T12:00:00Z",
    });
    const serialized = JSON.stringify(observation);

    expect(observation.provider_key).toBe("daysmart");
    expect(observation.readiness_level).toBe("navigation_verified");
    expect(observation.target_domain).toBe("pps.daysmartrecreation.com");
    expect(observation.source_run_signature).toMatch(/^h[0-9a-f]{8}$/);
    expect(observation.program_signature).toMatch(/^h[0-9a-f]{8}$/);
    expect(observation.steps_attempted).toEqual(["run_created"]);
    expect(observation.stop_condition).toBe("parent_must_review_waiver");
    expect(observation.redaction.child_pii).toBe("excluded");
    expect(observation.promotion.automatic).toBe(false);

    [
      "Ava",
      "Messinger",
      "2017-04-01",
      "peanuts",
      "parent@example.com",
      "Matt Messinger",
      "secret-token",
      "4242424242424242",
      "123 Family Lane",
    ].forEach((sensitiveValue) => {
      expect(serialized).not.toContain(sensitiveValue);
    });
  });

  it("adapts redacted observations to existing discovery_runs RPC shape", () => {
    const observation = buildRedactedProviderObservation({
      provider_key: "active",
      target_url: "https://register.active.com/soccer",
      target_program: "U8 soccer",
      status: "ready",
      caps: {
        preflight: {
          targetUrlConfirmed: true,
          helperInstalled: true,
        },
      },
      audit_events: [{ type: "run_packet_created" }],
    });
    const payload = buildDiscoveryRunPayloadFromObservation(observation);

    expect(payload.p_provider).toBe("active");
    expect(payload.p_program).toMatch(/^h[0-9a-f]{8}$/);
    expect(payload.p_fingerprint).toMatch(/^h[0-9a-f]{8}$/);
    expect(payload.p_stage).toBe("program");
    expect(payload.p_meta.source).toBe("supervised_autopilot_redacted_observation");
    expect(payload.p_meta.hints.promotion_requires_admin_review).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("U8 soccer");
    expect(JSON.stringify(payload)).not.toContain("https://register.active.com/soccer");
  });
});
