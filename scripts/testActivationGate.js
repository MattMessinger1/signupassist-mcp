/**
 * Minimal regression checks for the Activation Gate helpers inside APIOrchestrator.
 *
 * This script intentionally imports from `dist/` so it can run with plain `node`
 * (no tsx IPC / loader requirements).
 *
 * Run:
 *   npm run mcp:build
 *   node scripts/testActivationGate.js
 */

import assert from "node:assert/strict";
import APIOrchestrator from "../dist/mcp_server/ai/APIOrchestrator.js";

function main() {
  const orch = new APIOrchestrator({ tools: new Map() });

  // Private methods are runtime-callable; we use them for lightweight checks.
  const anyOrch = orch;

  // Age extraction
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("for my 8-year-old in Madison"), 8);
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("my 10 year old wants robotics"), 10);
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("age 7 coding"), 7);
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("8yo robotics"), 8);
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("2"), null); // below supported range
  assert.equal(anyOrch.extractChildAgeFromSearchQuery("19"), null); // above supported range

  // Age range parsing
  assert.deepEqual(anyOrch.parseAgeRangeText("Ages 7-10"), { min: 7, max: 10 });
  assert.deepEqual(anyOrch.parseAgeRangeText("7–10 years"), { min: 7, max: 10 });
  assert.deepEqual(anyOrch.parseAgeRangeText("13+"), { plus: 13 });
  assert.deepEqual(anyOrch.parseAgeRangeText("Age 8"), { min: 8, max: 8 });

  // Within-range checks
  assert.equal(anyOrch.isAgeWithinRange(8, "Ages 7-10"), true);
  assert.equal(anyOrch.isAgeWithinRange(6, "Ages 7-10"), false);
  assert.equal(anyOrch.isAgeWithinRange(13, "13+"), true);
  assert.equal(anyOrch.isAgeWithinRange(12, "13+"), false);
  assert.equal(anyOrch.isAgeWithinRange(8, ""), true); // unknown → don't exclude

  console.log("✅ Activation gate helper checks passed");
}

main();


