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

  it("keeps DaySmart fixture coverage for login, participant, payment, sold-out, and price-cap states", () => {
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

  it("anchors helper safety behavior around login, legal, payment, final submit, safe navigation, and price cap pauses", () => {
    const helperSource = readFileSync("chrome-helper/content.js", "utf8");
    const manifest = readFileSync("chrome-helper/manifest.json", "utf8");
    expect(helperSource).toContain("Login or account step detected");
    expect(helperSource).toContain("MFA or verification-code step detected");
    expect(helperSource).toContain("Payment screen or card field detected");
    expect(helperSource).toContain("CAPTCHA or human verification detected");
    expect(helperSource).toContain("Waiver, release, or legal acceptance detected");
    expect(helperSource).toContain("Medical or allergy information detected");
    expect(helperSource).toContain("Prompt injection or instruction override detected");
    expect(helperSource).toContain("Unknown required field");
    expect(helperSource).toContain("Provider mismatch");
    expect(helperSource).toContain("Price above cap");
    expect(helperSource).toContain("save and continue");
    expect(helperSource).toContain("select participant");
    expect(helperSource).toContain("Final action requires parent approval");
    expect(helperSource).toContain("Assist Mode is off");
    expect(manifest).toContain("signupassist.shipworx.ai");
    expect(manifest).toContain("daysmartrecreation.com");
    expect(manifest).toContain("localhost");
    expect(manifest).not.toContain("<all_urls>");

    const loginFixture = readFileSync("chrome-helper/fixtures/daysmart-login.html", "utf8");
    const registrationFixture = readFileSync("chrome-helper/fixtures/daysmart.html", "utf8");
    const paymentFixture = readFileSync("chrome-helper/fixtures/daysmart-waiver-payment.html", "utf8");
    const participantFixture = readFileSync("chrome-helper/fixtures/daysmart-participant.html", "utf8");
    const soldOutFixture = readFileSync("chrome-helper/fixtures/daysmart-soldout.html", "utf8");

    expect(loginFixture).toContain('type="password"');
    expect(loginFixture).toContain("Login");
    expect(registrationFixture).toContain("Next");
    expect(registrationFixture).toContain("Save and Continue");
    expect(registrationFixture).toContain("Checkout");
    expect(registrationFixture).toContain("$220.00");
    expect(paymentFixture).toContain("Confirm Registration");
    expect(paymentFixture).toContain("Card number");
    expect(paymentFixture).toContain("waiver and release");
    expect(participantFixture).toContain("T-shirt size");
    expect(participantFixture).toContain("Participant first name");
    expect(participantFixture).toContain("Save and Continue");
    expect(soldOutFixture).toContain("sold out");
    expect(soldOutFixture).toContain("Join Waitlist");
  });

  it("keeps the popup on helper-code fetch, run summary, and Assist Mode controls", () => {
    const popupSource = readFileSync("chrome-helper/popup.js", "utf8");
    const popupHtml = readFileSync("chrome-helper/popup.html", "utf8");

    expect(popupSource).toContain("fetchHelperCode");
    expect(popupSource).toContain("buildHelperCodeUrl");
    expect(popupSource).toContain("Assist Mode enabled.");
    expect(popupSource).toContain("Safe continue clicked");
    expect(popupHtml).toContain("Helper code");
    expect(popupHtml).toContain("Assist Mode");
    expect(popupHtml).toContain("Safe continue");
    expect(popupHtml).toContain("helperCodeSummary");
    expect(popupHtml).toContain("assistModeSummary");
  });
});
