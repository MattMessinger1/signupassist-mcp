import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyButtonAction,
  detectProviderMismatch,
  detectSoldOutState,
  evaluatePriceCap,
  isSensitiveField,
} from "../src/lib/autopilot/classifier";
import { PROVIDER_PLAYBOOKS, findPlaybookByKey, findPlaybookForUrl } from "../src/lib/autopilot/playbooks";

describe("autopilot safety classifier", () => {
  it("treats safe navigation differently from final submit", () => {
    expect(classifyButtonAction("Continue").kind).toBe("safe_navigation");
    expect(classifyButtonAction("Save and continue").kind).toBe("safe_navigation");
    expect(classifyButtonAction("Register now").kind).toBe("forbidden_final");
    expect(classifyButtonAction("Checkout").kind).toBe("forbidden_final");
    expect(classifyButtonAction("", { type: "submit" }).kind).toBe("unknown");
  });

  it("pauses for sensitive or PHI-like fields", () => {
    expect(isSensitiveField(["Known allergies"])).toBe(true);
    expect(isSensitiveField(["Medical notes"])).toBe(true);
    expect(isSensitiveField(["Insurance policy number"])).toBe(true);
    expect(isSensitiveField(["Participant first name"])).toBe(false);
  });

  it("stops when price exceeds the parent cap", () => {
    expect(evaluatePriceCap(9000, 10000).ok).toBe(true);
    expect(evaluatePriceCap(12000, 10000).ok).toBe(false);
  });

  it("detects provider mismatches and sold-out states", () => {
    const active = findPlaybookByKey("active");
    expect(findPlaybookForUrl("https://register.active.com/soccer").key).toBe("active");
    expect(detectProviderMismatch("https://app.amilia.com/store/en/demo", active)).toBe(true);
    expect(detectSoldOutState("This session is sold out. Join the waitlist.")).toBe(true);
  });

  it("keeps top provider playbooks tied to fixture files", () => {
    const verified = PROVIDER_PLAYBOOKS.filter((playbook) => playbook.confidence === "verified");
    expect(verified).toHaveLength(5);

    verified.forEach((playbook) => {
      expect(playbook.fixturePath).toBeTruthy();
      expect(existsSync(playbook.fixturePath!)).toBe(true);
    });
  });
});
