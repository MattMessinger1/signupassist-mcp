import { assertEquals, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateFormFingerprint } from "../supabase/functions/_shared/fingerprint.ts";

Deno.test("generateFormFingerprint - identical inputs produce identical fingerprints", async () => {
  const input = "program_123|credential_456";
  
  const fingerprint1 = await generateFormFingerprint(input);
  const fingerprint2 = await generateFormFingerprint(input);
  
  assertEquals(fingerprint1, fingerprint2, "Identical inputs must produce identical fingerprints");
  console.log("✅ Fingerprint example:", fingerprint1);
});

Deno.test("generateFormFingerprint - different inputs produce different fingerprints", async () => {
  const input1 = "program_123|credential_456";
  const input2 = "program_999|credential_789";
  
  const fingerprint1 = await generateFormFingerprint(input1);
  const fingerprint2 = await generateFormFingerprint(input2);
  
  assertNotEquals(fingerprint1, fingerprint2, "Different inputs must produce different fingerprints");
  console.log("✅ Distinct fingerprints verified");
  console.log("  Input 1:", input1, "→", fingerprint1);
  console.log("  Input 2:", input2, "→", fingerprint2);
});

Deno.test("generateFormFingerprint - returns valid hex string (64 chars)", async () => {
  const input = "test_program|test_credential";
  
  const fingerprint = await generateFormFingerprint(input);
  
  // SHA-256 produces 64 hex characters
  assertEquals(fingerprint.length, 64, "SHA-256 fingerprint must be 64 characters");
  
  // Verify it's a valid hex string
  const hexRegex = /^[0-9a-f]{64}$/;
  assertEquals(hexRegex.test(fingerprint), true, "Fingerprint must be lowercase hex");
  
  console.log("✅ Valid hex fingerprint:", fingerprint);
});

Deno.test("generateFormFingerprint - performance check (<1ms)", async () => {
  const input = "program_ref|credential_id";
  
  const start = performance.now();
  await generateFormFingerprint(input);
  const elapsed = performance.now() - start;
  
  console.log(`✅ Fingerprint generated in ${elapsed.toFixed(3)}ms`);
  assertEquals(elapsed < 1, true, "Fingerprint generation should take <1ms for short inputs");
});

Deno.test("generateFormFingerprint - deterministic across multiple runs", async () => {
  const input = "deterministic_test|check_123";
  const iterations = 10;
  const fingerprints = new Set<string>();
  
  for (let i = 0; i < iterations; i++) {
    const fp = await generateFormFingerprint(input);
    fingerprints.add(fp);
  }
  
  assertEquals(fingerprints.size, 1, "All iterations must produce the same fingerprint");
  console.log("✅ Deterministic fingerprint verified over", iterations, "iterations");
});
