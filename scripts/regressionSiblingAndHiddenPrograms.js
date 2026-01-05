/**
 * Regression: sibling add-child input + hide known-unavailable programs in browse lists
 *
 * This script is intentionally network-free. It runs against the built `dist/` output.
 *
 * Run:
 *   npm run mcp:build && node scripts/regressionSiblingAndHiddenPrograms.js
 */
import assert from "node:assert/strict";
import APIOrchestrator from "../dist/mcp_server/ai/APIOrchestrator.js";

async function testHiddenProgramFiltering() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-hidden-programs";

  // Seed minimal context
  orch.sessions.set(sessionId, {
    step: "BROWSE",
    orgRef: "aim-design",
    hiddenProgramRefs: ["REF_CLOSED"],
  });

  // Prevent any DB persistence paths in this regression.
  orch.updateContextAndAwait = async (sid, patch) => {
    orch.updateContext(sid, patch);
  };

  // Mock provider tool response
  orch.invokeMCPTool = async (toolName, args) => {
    assert.equal(toolName, "bookeo.find_programs");
    assert.equal(args?.org_ref, "aim-design");
    return {
      data: {
        programs_by_theme: {
          Default: [
            {
              title: "CLASS 1: Open Class",
              program_ref: "REF_OPEN",
              org_ref: "aim-design",
              description: "Open program",
              price: "$10.00",
              schedule: "Jan 10, 2026 at 9:00 AM CST",
              booking_status: "open_now",
              earliest_slot_time: new Date(Date.now() + 60_000).toISOString(),
            },
            {
              title: "CLASS 2: Closed Class",
              program_ref: "REF_CLOSED",
              org_ref: "aim-design",
              description: "Closed program",
              price: "$10.00",
              schedule: "Jan 1, 2026 at 9:00 AM CST",
              booking_status: "closed",
              earliest_slot_time: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        },
      },
    };
  };

  const resp = await orch.searchPrograms("aim-design", sessionId);
  assert.ok(typeof resp?.message === "string" && resp.message.length > 0, "searchPrograms should return a message");
  assert.ok(!resp.message.includes("CLASS 2: Closed Class"), "hidden closed program should not appear in browse message");
}

async function testSiblingChildCaptureAndReviewFallback() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-sibling-flow";

  orch.sessions.set(sessionId, {
    step: "FORM_FILL",
    selectedProgram: { title: "CLASS 3: Ocean Explorers", available_slots: 10 },
    participants: [{ firstName: "Percy", lastName: "Messinger", dob: "2014-11-26" }],
    awaitingAdditionalChildInfo: true,
  });

  const resp = await orch.handleMessage(
    "Mina Messinger, 7",
    sessionId,
    orch.getContext(sessionId)
  );

  const ctx = orch.getContext(sessionId);
  assert.equal(ctx.participants.length, 2, "Second child should be appended to context.participants");
  assert.ok(
    ctx.participants.some((p) => p.firstName === "Mina"),
    "New child should be Mina"
  );
  assert.ok(
    /2 children|children added/i.test(String(resp?.message || "")),
    "Response should reflect multi-child state"
  );

  // Review fallback should include both children even before submitForm normalizes formData.
  const summary = orch.buildReviewSummaryFromContext(ctx);
  assert.ok(summary.includes("Percy"), "Review summary should include first child");
  assert.ok(summary.includes("Mina"), "Review summary should include second child");
}

async function run() {
  await testHiddenProgramFiltering();
  await testSiblingChildCaptureAndReviewFallback();
  console.log("✅ PASS: sibling add-child + hidden closed program regressions");
}

run().catch((err) => {
  console.error("❌ FAIL:", err?.stack || err);
  process.exit(1);
});


