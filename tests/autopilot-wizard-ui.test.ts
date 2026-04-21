import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const autopilotPage = readFileSync("src/pages/Autopilot.tsx", "utf8");
const providerLearningHelper = readFileSync("src/lib/providerLearning.ts", "utf8");
const runPacketHelper = readFileSync("src/lib/autopilot/runPacket.ts", "utf8");

describe("Autopilot supervised wizard UI contract", () => {
  it("loads only the server-side signup intent id from route query params", () => {
    const readParams = [...autopilotPage.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );

    expect(readParams).toEqual(["intent"]);
    expect(autopilotPage).toContain("getSignupIntent(intentId)");
    expect(autopilotPage).toContain("buildAutopilotIntentPath(intentId)");
    expect(autopilotPage).not.toContain('searchParams.get("activity")');
    expect(autopilotPage).not.toContain('searchParams.get("targetUrl")');
    expect(autopilotPage).not.toContain('searchParams.get("providerName")');
    expect(autopilotPage).not.toContain('searchParams.get("providerKey")');
    expect(autopilotPage).not.toContain('searchParams.get("child")');
  });

  it("renders the first-run setup checklist and supervised setup steps", () => {
    [
      "Activity",
      "Provider",
      "Child/Profile",
      "Timing and reminder",
      "Safety limits",
      "Provider learning",
      "Review and create",
    ].forEach((label) => {
      expect(autopilotPage).toContain(label);
    });
    [
      "Provider login works",
      "Child profile is ready",
      "Provider payment is prepared",
      "Chrome helper is installed",
      "Signup URL is confirmed",
    ].forEach((label) => {
      expect(runPacketHelper).toContain(label);
    });
    expect(autopilotPage).toContain("Readiness preflight");
    expect(autopilotPage).toContain(
      "These checks build today's supervised packet and keep future automation gated until the provider is ready.",
    );
  });

  it("keeps repeat same-provider runs on the compact dashboard path", () => {
    expect(autopilotPage).toContain("createdPacket ? (");
    expect(autopilotPage).toContain("Run already created");
    expect(autopilotPage).toContain("Open the dashboard to review or resume it.");
    expect(autopilotPage).toContain("View dashboard");
    expect(autopilotPage).toContain("Scheduled runs");
  });

  it("keeps parent approval and set-and-forget future-gating visible", () => {
    expect(autopilotPage).toContain(
      "SignupAssist pauses for login, payment, waivers, medical questions, provider uncertainty, price changes, and final submit",
    );
    expect(autopilotPage).toContain("SET_AND_FORGET_LADDER");
    expect(providerLearningHelper).toContain("Today: supervised run packet");
    expect(providerLearningHelper).toContain("Next: verified provider fill/navigation");
    expect(providerLearningHelper).toContain(
      "Later: signed-mandate delegated signup for verified providers only",
    );
    expect(autopilotPage).toContain("future-gated");
    expect(autopilotPage).not.toContain("POST /api/helper/run-links");
    expect(autopilotPage).toContain("Get helper code");
  });

  it("warns on repeat different-provider runs and keeps provider switching visible", () => {
    expect(autopilotPage).toContain("Provider mismatch");
    expect(autopilotPage).toContain(
      "The URL appears to be {detectedPlaybook?.name}, but the selected playbook is {selectedPlaybook.name}.",
    );
    expect(autopilotPage).toContain(
      "Detected {detectedPlaybook.name}. Speed claims apply only when the selected provider is verified.",
    );
    expect(autopilotPage).toContain("Use Keva DaySmart starter");
    expect(autopilotPage).toContain("Detect provider");
    expect(autopilotPage).toContain("selectedPlaybook.key === \"generic\"");
  });

  it("creates a supervised run packet and links it back to the signup intent", () => {
    expect(autopilotPage).toContain("buildAutopilotRunPacket");
    expect(autopilotPage).toContain("provider_learning: providerLearning");
    expect(autopilotPage).toContain("updateSignupIntent(signupIntent.id");
    expect(autopilotPage).toContain('status: "scheduled"');
    expect(autopilotPage).toContain("autopilot_run_id: createdRun.id");
    expect(autopilotPage).toContain("View dashboard");
    expect(autopilotPage).toContain("Run already created");
    expect(autopilotPage).toContain("createdPacket ? (");
    expect(autopilotPage).toContain("Get helper code");
    expect(autopilotPage).toContain("Copy helper code");
    expect(autopilotPage).toContain("Copy packet");
  });

  it("keeps child profile creation minimal and provider learning redacted", () => {
    expect(autopilotPage).toContain("createChildProfile");
    expect(autopilotPage).toContain('.from("children")');
    expect(autopilotPage).toContain("first_name: firstName");
    expect(autopilotPage).toContain("last_name: newChildLastName.trim()");
    expect(autopilotPage).toContain("dob: newChildDob || null");
    expect(autopilotPage).not.toContain("new-child-allergy");
    expect(autopilotPage).not.toContain("new-child-insurance");
    expect(autopilotPage).toContain("no_child_pii_in_learning: true");
    expect(autopilotPage).toContain("Let this provider help future runs");
  });

  it("preserves billing return state and validates external signup links", () => {
    expect(autopilotPage).toContain("returnPath={autopilotReturnPath}");
    expect(autopilotPage).toContain("safeExternalUrl");
    expect(autopilotPage).toContain("Valid provider URL required");
    expect(autopilotPage).toContain("SMS reminder is selected by default");
    expect(autopilotPage).toContain("Enter the same phone number twice to enable SMS");
  });
});
