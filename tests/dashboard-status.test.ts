import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeRunStatus,
  redactAuditText,
  runStatusLabel,
  summarizeAuditEvent,
} from "../src/lib/dashboardStatus";

const dashboard = readFileSync("src/pages/RegistrationDashboard.tsx", "utf8");

describe("dashboard status and audit polish", () => {
  it("surfaces the required parent dashboard sections", () => {
    [
      "Ready to prepare",
      "Registration opening soon",
      "Scheduled/ready runs",
      "Paused for parent approval",
      "Provider learning/readiness",
      "Completed signups",
      "Failed/manual fallback runs",
    ].forEach((label) => {
      expect(dashboard).toContain(label);
    });
  });

  it("shows required run card fields and CTAs", () => {
    [
      "Registration opens",
      "Readiness score",
      "Price cap",
      "Last audit event",
      "Choose during run",
      "Review",
      "Resume",
      "View audit",
      "Open provider",
      "Cancel if supported",
    ].forEach((label) => {
      expect(dashboard).toContain(label);
    });
  });

  it("keeps reminder and provider-readiness copy honest", () => {
    expect(dashboard).toContain("Reminder prepared");
    expect(dashboard).toContain("Manual reminder recommended");
    expect(dashboard).toContain("SMS disabled until configured");
    expect(dashboard).toContain("Verified means fixture-tested and observed across safe flows.");
    expect(dashboard).toContain("Beta means conservative fill-only or high-pause mode.");
    expect(dashboard).toContain("Generic means SignupAssist pauses more often and makes no speed guarantees.");
    expect(dashboard).toContain("Delegated signup is future-only unless readiness and mandate checks pass.");
  });

  it("normalizes all requested status labels", () => {
    expect(normalizeRunStatus("ready_for_autopilot")).toBe("ready");
    expect(normalizeRunStatus("paused")).toBe("paused_for_parent");
    expect(runStatusLabel("payment_review_required")).toBe("Payment review required");
    expect(runStatusLabel("final_submit_review_required")).toBe("Final submit review required");
    expect(runStatusLabel("manual_fallback")).toBe("Manual fallback");
  });

  it("redacts visible audit summaries", () => {
    const unsafe = [
      "child Ava born 2017-04-01",
      "phone 608-555-1212",
      "address 123 Family Lane",
      "token=secret-token",
      "card number 4242424242424242",
      "allergies peanuts",
      "medical notes asthma",
      "parent@example.com",
    ].join(" ");
    const redacted = redactAuditText(unsafe);

    [
      "2017-04-01",
      "608-555-1212",
      "123 Family Lane",
      "secret-token",
      "4242424242424242",
      "peanuts",
      "asthma",
      "parent@example.com",
    ].forEach((value) => {
      expect(redacted).not.toContain(value);
    });

    expect(redacted).toContain("[date redacted]");
    expect(redacted).toContain("[phone redacted]");
    expect(redacted).toContain("[address redacted]");
    expect(redacted).toContain("[credential redacted]");
    expect(redacted).toContain("[payment redacted]");
    expect(redacted).toContain("[sensitive health detail redacted]");
  });

  it("does not expose audit event details in human summaries", () => {
    const summary = summarizeAuditEvent({
      type: "payment_review_required",
      details: {
        child_name: "Ava Messinger",
        token: "secret-token",
        card: "4242424242424242",
      },
    });

    expect(summary).toBe("Payment Review Required");
    expect(summary).not.toContain("Ava");
    expect(summary).not.toContain("secret-token");
    expect(summary).not.toContain("4242424242424242");
  });
});
