import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redactDiscoveryRunDetail } from "../src/lib/discoveryRunRedaction";
import {
  PROVIDER_REGISTRY,
  buildDiscoveryRunPayloadFromObservation,
  buildRedactedProviderObservation,
} from "../src/lib/providerLearning";

const dashboard = readFileSync("src/pages/RegistrationDashboard.tsx", "utf8");
const discoveryRuns = readFileSync("src/pages/DiscoveryRuns.tsx", "utf8");

describe("dashboard and provider readiness verification", () => {
  it("keeps parent dashboard next-action, trust, legal, and readiness surfaces visible", () => {
    [
      "Ready to prepare",
      "Registration opening soon",
      "Paused for parent approval",
      "Provider learning/readiness",
      "View readiness",
      "View audit",
      "Open provider",
      "Privacy",
      "Terms",
      "Security",
      "SignupAssist minimizes child data",
      "stores no card numbers",
      "uses only redacted provider-learning signals",
    ].forEach((copy) => {
      expect(dashboard).toContain(copy);
    });
  });

  it("documents provider readiness as fixture/admin reviewed, never model-promoted", () => {
    [
      "View provider readiness, mapped fixtures, and the last 50 redacted field discovery runs.",
      "Provider readiness",
      "Latest redacted observation",
      "Promotion requires fixtures, provider-specific tests, and admin review. Model output cannot promote readiness.",
      "View redacted JSON",
      "Redacted errors (JSON)",
      "Redacted metadata (JSON)",
    ].forEach((copy) => {
      expect(discoveryRuns).toContain(copy);
    });

    PROVIDER_REGISTRY.forEach((provider) => {
      expect(provider.promotionPolicy.automaticPromotionAllowed).toBe(false);
      expect(provider.promotionPolicy.modelOutputCanPromote).toBe(false);
      expect(provider.promotionPolicy.providerPageContentCanPromote).toBe(false);
      expect(provider.promotionPolicy.requiresAdminReview).toBe(true);
    });
  });

  it("defensively redacts provider readiness detail JSON before display", () => {
    const redacted = redactDiscoveryRunDetail({
      provider: "daysmart",
      target_url: "https://dash.example.com/register?token=secret",
      meta: {
        child_first_name: "Percy",
        child_dob: "2014-11-26",
        name: "Percy Messinger",
        label: "Percy account holder",
        parent_name: "Matt Messinger",
        guardian_name: "Matt Messinger",
        contact_name: "Matt Messinger",
        emergency_contact_name: "Matt Messinger",
        parent_email: "openai-reviewer@shipworx.ai",
        phone: "608-338-6377",
        address: "8312 Forsythia Lane",
        payment_card: "4242424242424242",
        medical_notes: "none",
        safe_signal: "registration_paused",
      },
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain("dash.example.com");
    expect(serialized).toContain("registration_paused");
    expect(serialized).not.toContain("Percy");
    expect(serialized).not.toContain("Matt Messinger");
    expect(serialized).not.toContain("2014-11-26");
    expect(serialized).not.toContain("openai-reviewer@shipworx.ai");
    expect(serialized).not.toContain("608-338-6377");
    expect(serialized).not.toContain("8312 Forsythia");
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).not.toContain("token=secret");
  });

  it("keeps supervised observations adapted to discovery runs without raw program or URL details", () => {
    const observation = buildRedactedProviderObservation({
      provider_key: "campminder",
      target_url: "https://campminder.example.com/signup?token=secret",
      target_program: "Percy summer camp",
      status: "paused_for_parent",
      audit_events: [{ type: "final_submit_review_required" }],
    });
    const payload = buildDiscoveryRunPayloadFromObservation(observation);
    const serialized = JSON.stringify(payload);

    expect(payload.p_meta.source).toBe("supervised_autopilot_redacted_observation");
    expect(payload.p_meta.hints.promotion_requires_admin_review).toBe(true);
    expect(serialized).not.toContain("Percy");
    expect(serialized).not.toContain("summer camp");
    expect(serialized).not.toContain("campminder.example.com/signup");
    expect(serialized).not.toContain("token=secret");
  });
});
