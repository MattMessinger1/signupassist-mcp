import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/MandatesAudit.tsx", "utf8");

describe("Mandates audit redaction contract", () => {
  it("does not fetch or render raw mandate tokens", () => {
    expect(page).not.toContain("jws_compact");
    expect(page).not.toContain("mandateJws");
    expect(page).not.toContain("View JWS Token");
    expect(page).not.toContain("DecodedMandateViewer");
    expect(page).toContain(
      "id, provider, program_ref, scope, max_amount_cents, valid_from, valid_until, status, created_at",
    );
  });

  it("redacts visible metadata and hides credential identifiers", () => {
    expect(page).toContain("redactAuditMetadata");
    expect(page).toContain("isSensitiveRedactionKey");
    expect(page).toContain("View redacted metadata");
    expect(page).not.toContain("Credential ID:");
    expect(page).not.toContain("credential_id");
    expect(page).not.toContain(".select('*')");
  });

  it("gates testing tools behind explicit environment configuration", () => {
    expect(page).toContain("VITE_ENABLE_AUDIT_TEST_TOOLS");
    expect(page).toContain("testToolsEnabled && <TabsTrigger value=\"testing\">");
    expect(page).toContain("Testing tools are hidden in production");
  });
});
