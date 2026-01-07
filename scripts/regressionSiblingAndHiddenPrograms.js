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

async function testSavedChildSelectionByNumber() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-saved-child-selection";

  // Simulate saved children already loaded
  const savedChildren = [
    { id: "child-1", first_name: "Percy", last_name: "Messinger", dob: "2014-11-26", display: "Percy Messinger" },
    { id: "child-2", first_name: "Mina", last_name: "Messinger", dob: "2018-03-15", display: "Mina Messinger" },
  ];

  orch.sessions.set(sessionId, {
    step: "FORM_FILL",
    selectedProgram: { title: "CLASS 3: Ocean Explorers", available_slots: 10 },
    participants: [{ firstName: "Simon", lastName: "Messinger", dob: "2012-01-01" }], // First child already added
    awaitingAdditionalChild: true,
    remainingSavedChildrenForSelection: savedChildren,
    user_id: "test-user-123",
    savedChildren,
  });

  // User selects "2" to pick Mina from saved children list
  const resp = await orch.handleMessage(
    "2",
    sessionId,
    orch.getContext(sessionId)
  );

  const ctx = orch.getContext(sessionId);
  assert.equal(ctx.participants.length, 2, "Second child should be added to context.participants");
  assert.ok(
    ctx.participants.some((p) => p.firstName === "Mina"),
    "Mina should be added from saved children"
  );
  assert.ok(
    /2 children|children added|Mina/i.test(String(resp?.message || "")),
    "Response should reflect Mina was added"
  );
}

async function testSavedChildSelectionByName() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-saved-child-by-name";

  // Simulate saved children already loaded
  const savedChildren = [
    { id: "child-1", first_name: "Percy", last_name: "Messinger", dob: "2014-11-26", display: "Percy Messinger" },
    { id: "child-2", first_name: "Mina", last_name: "Messinger", dob: "2018-03-15", display: "Mina Messinger" },
  ];

  orch.sessions.set(sessionId, {
    step: "FORM_FILL",
    selectedProgram: { title: "CLASS 3: Ocean Explorers", available_slots: 10 },
    participants: [{ firstName: "Simon", lastName: "Messinger", dob: "2012-01-01" }],
    awaitingAdditionalChild: true,
    remainingSavedChildrenForSelection: savedChildren,
    user_id: "test-user-123",
    savedChildren,
  });

  // User types "Percy" to select by name
  const resp = await orch.handleMessage(
    "Percy",
    sessionId,
    orch.getContext(sessionId)
  );

  const ctx = orch.getContext(sessionId);
  assert.equal(ctx.participants.length, 2, "Second child should be added");
  assert.ok(
    ctx.participants.some((p) => p.firstName === "Percy"),
    "Percy should be added from saved children"
  );
}

async function testDifferentChildOption() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-different-child";

  const savedChildren = [
    { id: "child-1", first_name: "Percy", last_name: "Messinger", dob: "2014-11-26", display: "Percy Messinger" },
  ];

  orch.sessions.set(sessionId, {
    step: "FORM_FILL",
    selectedProgram: { title: "CLASS 3: Ocean Explorers", available_slots: 10 },
    participants: [{ firstName: "Simon", lastName: "Messinger", dob: "2012-01-01" }],
    awaitingAdditionalChild: true,
    remainingSavedChildrenForSelection: savedChildren,
    user_id: "test-user-123",
    savedChildren,
  });

  // User selects "2" which is "Different child" when there's 1 saved child
  const resp = await orch.handleMessage(
    "2",
    sessionId,
    orch.getContext(sessionId)
  );

  const ctx = orch.getContext(sessionId);
  // Should NOT have added a child - should be asking for name+age
  assert.equal(ctx.participants.length, 1, "No child should be added yet when selecting 'different child'");
  assert.ok(ctx.awaitingAdditionalChildInfo === true, "Should now be awaiting child info input");
  assert.ok(
    /name.*age|what's the child/i.test(String(resp?.message || "")),
    "Should ask for name and age of new child"
  );
}

async function testSecondaryActionDoesNotHijackWizardTranscript() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-secondary-action-hijack";

  // Ensure we don't hit any DB persistence paths in this regression.
  orch.updateContextAndAwait = async (sid, patch) => {
    orch.updateContext(sid, patch);
  };

  // If secondary-action parsing fires incorrectly, it will call handleAction('cancel_registration', ...)
  orch.handleAction = async (action) => {
    assert.notEqual(action, "cancel_registration", "Wizard transcript should not be mis-parsed as cancel_registration");
    return { message: "ok" };
  };

  orch.sessions.set(sessionId, {
    step: "REVIEW",
    // Not important for this regression; we only care about the early secondary-action routing.
    selectedProgram: { title: "CLASS X", available_slots: 10 },
  });

  const pastedReviewTranscript =
    `Step 4/5 — Review & consent\n\n` +
    `Program Fee: $40.00 (paid to provider only if booking succeeds)\n` +
    `SignupAssist Fee: $20.00 (charged only upon successful registration)\n\n` +
    `If everything is correct, type book now to continue or cancel to abort.`;

  const resp = await orch.handleMessage(pastedReviewTranscript, sessionId, orch.getContext(sessionId));
  assert.ok(resp && typeof resp.message === "string", "Should return a response");
}

async function testBookeoMaxParticipantsPreventsSiblingPrompt() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-max-participants";

  // Prevent any DB persistence paths in this regression.
  orch.updateContextAndAwait = async (sid, patch) => {
    orch.updateContext(sid, patch);
  };

  // Avoid any downstream Supabase/payment calls; we only care that we DON'T show the sibling prompt.
  orch.submitForm = async () => ({ message: "PAYMENT_OK" });

  orch.sessions.set(sessionId, {
    step: "FORM_FILL",
    selectedProgram: { title: "CLASS Y", available_slots: 10 },
    requiredFields: { delegate: [], participant: [] },
    maxParticipantsPerBooking: 1,
    childInfo: { firstName: "Simon", lastName: "Messinger", dob: "2016-03-19", name: "Simon Messinger" },
  });

  const resp = await orch.handleAction(
    "submit_form",
    {
      // Provide already-two-tier data so the submit_form normalizer doesn't wipe it out
      // (and so COPPA checks can pass without DB calls).
      formData: {
        delegate: {
          delegate_email: "matt@example.com",
          delegate_firstName: "Matt",
          delegate_lastName: "Messinger",
          delegate_relationship: "Parent",
          delegate_dob: "05/13/1976",
        },
        participants: [{ firstName: "Simon", lastName: "Messinger", dob: "2016-03-19" }],
        numParticipants: 1,
      },
    },
    sessionId,
    orch.getContext(sessionId),
    "Simon Messinger, 9"
  );

  assert.ok(!/register another child/i.test(String(resp?.message || "")), "Should not ask to add another child when maxParticipantsPerBooking=1");
  assert.ok(/PAYMENT_OK/.test(String(resp?.message || "")), "Should proceed to payment/next step when maxParticipantsPerBooking=1");
}

async function run() {
  await testHiddenProgramFiltering();
  await testSiblingChildCaptureAndReviewFallback();
  await testSavedChildSelectionByNumber();
  await testSavedChildSelectionByName();
  await testDifferentChildOption();
  await testSecondaryActionDoesNotHijackWizardTranscript();
  await testBookeoMaxParticipantsPreventsSiblingPrompt();
  console.log("✅ PASS: sibling add-child + hidden closed program + saved child selection + secondary-action + max participants regressions");
}

run().catch((err) => {
  console.error("❌ FAIL:", err?.stack || err);
  process.exit(1);
});


