import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const autopilotPage = readFileSync("src/pages/Autopilot.tsx", "utf8");
const preparePlan = readFileSync("src/components/PreparePlanSheet.tsx", "utf8");
const providerLearningHelper = readFileSync("src/lib/providerLearning.ts", "utf8");
const runPacketHelper = readFileSync("src/lib/autopilot/runPacket.ts", "utf8");

describe("Autopilot compact prepare-plan UI contract", () => {
  it("loads only the server-side signup intent id from route query params", () => {
    const readParams = [...autopilotPage.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );

    expect(readParams).toEqual(["intent"]);
    expect(preparePlan).toContain("getSignupIntent(intentId)");
    expect(autopilotPage).toContain("buildAutopilotIntentPath(intentId)");
    expect(autopilotPage).not.toContain('searchParams.get("activity")');
    expect(autopilotPage).not.toContain('searchParams.get("targetUrl")');
    expect(autopilotPage).not.toContain('searchParams.get("providerName")');
    expect(autopilotPage).not.toContain('searchParams.get("providerKey")');
    expect(autopilotPage).not.toContain('searchParams.get("child")');
  });

  it("replaces the visible wizard with one compact shared prepare-plan surface", () => {
    expect(autopilotPage).toContain("PreparePlanSheet");
    expect(autopilotPage).toContain("Prepare your signup plan");
    expect(autopilotPage).not.toContain("Supervised Autopilot setup");
    expect(autopilotPage).not.toContain("WIZARD_STEPS");
    expect(autopilotPage).not.toContain("BillingCard");
    expect(autopilotPage).not.toContain("Provider learning");
  });

  it("keeps only the alpha plan fields visible by default", () => {
    ["Child", "Reminder", "Price cap", "Provider link", "Save plan"].forEach((label) => {
      expect(preparePlan).toContain(label);
    });
    expect(preparePlan).toContain("Helper pauses for login, payment, waivers, and final submit.");
    expect(preparePlan).toContain("<details");
    expect(preparePlan).toContain("Readiness");
    expect(preparePlan).toContain("Audit");
    expect(preparePlan).toContain("Provider learning");
    expect(preparePlan).toContain("Future automation");
  });

  it("keeps parent approval and set-and-forget future-gating in details and packet policy", () => {
    [
      "Provider login works",
      "Child profile is ready",
      "Provider payment is prepared",
      "Chrome helper is installed",
      "Signup URL is confirmed",
    ].forEach((label) => {
      expect(runPacketHelper).toContain(label);
    });
    expect(preparePlan).toContain("Set-and-forget remains disabled");
    expect(preparePlan).toContain("SET_AND_FORGET_LADDER");
    expect(providerLearningHelper).toContain("Today: supervised run packet");
    expect(providerLearningHelper).toContain("Next: verified provider fill/navigation");
    expect(providerLearningHelper).toContain(
      "Later: signed-mandate delegated signup for verified providers only",
    );
  });

  it("creates a supervised run packet and links it back to the signup intent", () => {
    expect(preparePlan).toContain("buildAutopilotRunPacket");
    expect(preparePlan).toContain("provider_learning: providerLearning");
    expect(preparePlan).toContain("updateSignupIntent(intent.id");
    expect(preparePlan).toContain('status: "scheduled"');
    expect(preparePlan).toContain("autopilot_run_id: data.id");
    expect(preparePlan).toContain("run_packet: packet");
  });

  it("shows launch actions after save and preserves the single helper-code fallback", () => {
    expect(preparePlan).toContain("Launch helper");
    expect(preparePlan).toContain("Open provider");
    expect(preparePlan).toContain("View Run Center");
    expect(preparePlan).toContain("Copy helper code");
    expect(preparePlan).toContain("launchHelperOrRedirect");
    expect(preparePlan).toContain('result.reason === "bridge_failed"');
    expect(preparePlan).not.toContain("Copy packet");
    expect(preparePlan).not.toContain("POST /api/helper/run-links");
  });

  it("validates membership, child, and external signup links before saving", () => {
    expect(preparePlan).toContain("isAutopilotSubscriptionUsable(subscription)");
    expect(preparePlan).toContain("Choose a child before saving");
    expect(preparePlan).toContain("Add a public HTTPS signup page URL before saving");
    expect(preparePlan).toContain("safeExternalUrl");
    expect(preparePlan).toContain("startSubscriptionCheckout");
  });
});
