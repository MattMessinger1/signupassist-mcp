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
    expect(page).toContain("Find signup");
    expect(page).toContain("Prepare signup");
    expect(page).toContain("Prepare guided signup");
    expect(page).not.toMatch(/\bunsupported\b/i);
  });

  it("surfaces structured search fields and readiness trust copy", () => {
    expect(page).toContain("Provider or venue");
    expect(page).toContain("City or location");
    expect(page).toContain("Age or grade");
    expect(page).toContain("Season or date");
    expect(page).toContain("Price cap");
    expect(page).toContain("Registration status");
    expect(page).toContain("Parent controlled");
    expect(page).toContain("Sensitive steps pause");
    expect(page).toContain("No card numbers stored");
    expect(page).toContain("All actions logged");
    expect(page).toContain("Provider learning improves future automation");
  });

  it("documents the modern page states", () => {
    expect(page).toContain("Start with one search");
    expect(page).toContain("Loading activity results");
    expect(page).toContain("No results yet");
    expect(page).toContain("Missing detail");
    expect(page).toContain("Sign in to prepare a signup");
    expect(page).toContain("Backend error");
  });
});
