import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KEVA_DAYSMART_LOGIN_URL,
  findPlaybookByKey,
  findPlaybookForUrl,
} from "../src/lib/autopilot/playbooks";

describe("DaySmart / Keva MVP provider slice", () => {
  it("detects the Keva DaySmart login URL as DaySmart", () => {
    expect(findPlaybookForUrl(KEVA_DAYSMART_LOGIN_URL).key).toBe("daysmart");
    expect(findPlaybookForUrl("https://pps.daysmartrecreation.com/dash/index.php?action=Class/index").key).toBe("daysmart");
  });

  it("keeps DaySmart fixture coverage for login, participant, payment, and sold-out states", () => {
    const daysmart = findPlaybookByKey("daysmart");
    expect(daysmart.fixturePaths).toEqual([
      "chrome-helper/fixtures/daysmart-login.html",
      "chrome-helper/fixtures/daysmart-participant.html",
      "chrome-helper/fixtures/daysmart-waiver-payment.html",
      "chrome-helper/fixtures/daysmart-soldout.html",
    ]);

    daysmart.fixturePaths?.forEach((fixturePath) => {
      expect(existsSync(fixturePath), `${fixturePath} should exist`).toBe(true);
    });
  });

  it("anchors helper safety behavior around login, legal, payment, final submit, and unknown required pauses", () => {
    const helperSource = readFileSync("chrome-helper/content.js", "utf8");
    expect(helperSource).toContain("Login or account step detected");
    expect(helperSource).toContain("CAPTCHA or human verification detected");
    expect(helperSource).toContain("Waiver, release, or legal acceptance detected");
    expect(helperSource).toContain("Unknown required field");
    expect(helperSource).toContain("Provider mismatch");
    expect(helperSource).toContain("Price above cap");

    const loginFixture = readFileSync("chrome-helper/fixtures/daysmart-login.html", "utf8");
    const paymentFixture = readFileSync("chrome-helper/fixtures/daysmart-waiver-payment.html", "utf8");
    const participantFixture = readFileSync("chrome-helper/fixtures/daysmart-participant.html", "utf8");

    expect(loginFixture).toContain('type="password"');
    expect(paymentFixture).toContain("Confirm Registration");
    expect(paymentFixture).toContain("Card number");
    expect(participantFixture).toContain("T-shirt size");
  });
});
