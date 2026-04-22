import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Activity Finder UI contract", () => {
  const page = readFileSync("src/pages/ActivityFinder.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const dashboard = readFileSync("src/pages/RegistrationDashboard.tsx", "utf8");

  it("adds Activity Finder as a real route and dashboard destination", () => {
    expect(app).toContain('path="/activity-finder"');
    expect(dashboard).toContain("navigate('/activity-finder')");
  });

  it("keeps search result language focused on one clear next step", () => {
    expect(page).toContain("Best match");
    expect(page).toContain("Other possible matches");
    expect(page).toContain("More possible venues");
    expect(page).toContain("Search");
    expect(page).toContain("Use this");
    expect(page).not.toContain("Prepare guided signup");
    expect(page).toContain("Add missing details");
    expect(page).not.toMatch(/\bunsupported\b/i);
  });

  it("surfaces structured search fields without duplicating the old trust stack", () => {
    expect(page).toContain("Provider or venue");
    expect(page).toContain("City or location");
    expect(page).toContain("Age or grade");
    expect(page).toContain("Season or date");
    expect(page).toContain("Price cap");
    expect(page).toContain("Registration status");
    expect(page).toContain("Add details");
    expect(page).toContain("aria-expanded={showAdvancedDetails}");
    expect(page).not.toContain("Parent controlled");
    expect(page).not.toContain("No card numbers stored");
    expect(page).not.toContain("All actions logged");
    expect(page).not.toContain("Provider learning improves future automation");
  });

  it("documents the modern page states", () => {
    expect(page).toContain("Start with one search");
    expect(page).toContain("Loading activity results");
    expect(page).toContain("No results yet");
    expect(page).toContain("Missing detail");
    expect(page).toContain("Backend error");
    expect(page).toContain("Outside current launch scope");
    expect(page).toContain("Adult activity registration is not supported yet");
    expect(page).toContain("scrollResultsIntoViewOnMobile");
    expect(page).toContain("focusMissingDetail");
  });

  it("preserves signed-out signup context through auth before creating an intent", () => {
    expect(page).toContain("signupassist:pendingActivityFinderIntent");
    expect(page).toContain("storePendingActivityFinderIntent");
    expect(page).toContain("readPendingActivityFinderIntent");
    expect(page).toContain("expiresAt: Date.now() + PENDING_ACTIVITY_FINDER_INTENT_TTL_MS");
  });

  it("opens the shared compact prepare plan sheet instead of navigating sensitive context", () => {
    expect(page).toContain("PreparePlanSheet");
    expect(page).toContain("setPrepareIntentId(intent.id)");
    expect(page).toContain('returnPath="/activity-finder"');
    expect(page).not.toContain("buildAutopilotIntentPath");
  });
});
