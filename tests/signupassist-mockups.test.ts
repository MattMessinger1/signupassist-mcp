import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const mockupSource = readFileSync("src/pages/SignupAssistMockups.tsx", "utf8");
const cssSource = readFileSync("src/index.css", "utf8");
const logoSource = readFileSync("src/components/BrandLogo.tsx", "utf8");

describe("SignupAssist mockup route and brand system", () => {
  it("exposes the dedicated SignupAssist mockups route", () => {
    expect(appSource).toContain('/mockups/signupassist');
    expect(mockupSource).toContain("signupassist-dashboard");
    expect(mockupSource).toContain("signupassist-helper-popup");
    expect(mockupSource).toContain("signupassist-supervised-overlay");
  });

  it("uses the uploaded logo palette and subtle logo widening", () => {
    expect(cssSource).toContain("--brand-primary: 201 59% 30%");
    expect(cssSource).toContain("--brand-primary-dark: 205 72% 16%");
    expect(cssSource).toContain("--brand-accent-warm: 34 100% 66%");
    expect(logoSource).toContain("widen = 1.08");
  });

  it("keeps supervised safety and parent-control copy visible", () => {
    expect(mockupSource).toContain("Only fills low-risk info");
    expect(mockupSource).toContain("Paused for your review");
    expect(mockupSource).toContain("Approve and continue");
    expect(mockupSource).toContain("Cancel monthly renewal");
  });
});
