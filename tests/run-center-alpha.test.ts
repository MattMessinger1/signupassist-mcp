import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const runCenter = readFileSync("src/pages/RunCenter.tsx", "utf8");
const header = readFileSync("src/components/Header.tsx", "utf8");

describe("simplest good alpha routes", () => {
  it("adds Run Center and Chrome Helper setup routes without removing the autopilot compatibility route", () => {
    expect(app).toContain('path="/run-center"');
    expect(app).toContain('path="/chrome-helper/setup"');
    expect(app).toContain('path="/autopilot"');
  });

  it("keeps primary navigation focused on the parent alpha path", () => {
    ["Dashboard", "Find Activity", "Run Center", "Receipts"].forEach((label) => {
      expect(header).toContain(label);
    });
    ["Chrome Helper", "Children", "Billing", "Settings"].forEach((label) => {
      expect(header).toContain(label);
    });
    expect(header).not.toContain(">Autopilot<");
  });

  it("groups prepared runs into simple parent-facing tabs", () => {
    ["Ready", "Opening soon", "Needs you", "Done"].forEach((label) => {
      expect(runCenter).toContain(label);
    });
    expect(runCenter).toContain("Launch helper");
    expect(runCenter).toContain("Review");
    expect(runCenter).toContain("Receipt / history");
    expect(runCenter).toContain("launchHelperOrRedirect");
  });

  it("keeps legacy registration-plan and analytics blocks out of the alpha Run Center", () => {
    expect(runCenter).not.toContain("Registration Plans");
    expect(runCenter).not.toContain("Total Plans");
    expect(runCenter).not.toContain("Success Rate");
  });
});
