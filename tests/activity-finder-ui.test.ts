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
    expect(page).not.toMatch(/\bunsupported\b/i);
  });

  it("surfaces reminder, reuse, and parent-control aha copy", () => {
    expect(page).toContain("We won’t let you forget");
    expect(page).toContain("Reuse family info");
    expect(page).toContain("Parent-controlled");
  });
});
