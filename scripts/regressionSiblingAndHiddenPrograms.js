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

async function testBookingIdempotencyAndNormalization() {
  const orch = new APIOrchestrator({ tools: new Map() });
  const sessionId = "regression-booking-idempotency";

  // Disable DB persistence paths in this regression (keep it network-free and quiet).
  orch.enqueuePersist = () => Promise.resolve();
  orch.persistSessionToDB = async () => {};
  orch.updateContextAndAwait = async (sid, patch) => {
    orch.updateContext(sid, patch);
  };

  let confirmBookingCalls = 0;
  let lastConfirmArgs = null;

  // Mock provider + platform tools. Make booking intentionally slow to simulate an in-flight retry.
  orch.invokeMCPTool = async (toolName, args) => {
    if (toolName === "mandates.create") {
      return { success: true, data: { mandate_id: "mandate-123" } };
    }
    if (toolName === "bookeo.confirm_booking") {
      confirmBookingCalls += 1;
      lastConfirmArgs = args;
      return await new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: true,
              data: {
                booking_number: "B123",
                start_time: new Date().toISOString(),
                provider_payment_required: true,
              },
            }),
          100
        )
      );
    }
    if (toolName === "stripe.charge_success_fee") {
      return { success: true, data: { charge_id: "ch_123" } };
    }
    if (toolName === "registrations.create") {
      return { success: true, data: { id: "reg-123" } };
    }
    throw new Error(`Unexpected tool call in regression: ${toolName}`);
  };

  orch.sessions.set(sessionId, {
    step: "PAYMENT",
    user_id: "user-123",
    hasPaymentMethod: true,
    cardBrand: "visa",
    cardLast4: "4242",
    selectedProgram: {
      title: "CLASS 3: Ocean Explorers",
      program_ref: "PROG_REF",
      org_ref: "aim-design",
      earliest_slot_time: new Date(Date.now() + 60_000).toISOString(),
      price: "$50.00",
    },
    formData: {
      delegate_data: {
        delegate_firstName: "Matt",
        delegate_lastName: "Messinger",
        delegate_email: "matt@example.com",
        delegate_relationship: "Parent",
        delegate_dob: "06/15/1984",
      },
      event_id: "EVT_123",
      participant_data: [
        { firstName: "Percy", lastName: "Messinger", dob: "2014-11-26" },
        { firstName: "Mina", lastName: "Messinger", dob: "2018-03-15" },
      ],
      num_participants: 2,
      program_fee_cents: 5000,
    },
  });

  const ctx0 = orch.getContext(sessionId);
  const p1 = orch.confirmPayment({ formData: ctx0.formData }, sessionId, ctx0);

  // Allow the first call to mark bookingAttempt before the slow provider call resolves.
  await new Promise((r) => setTimeout(r, 10));

  const resp2 = await orch.confirmPayment({ formData: ctx0.formData }, sessionId, orch.getContext(sessionId));
  assert.ok(
    /already working/i.test(String(resp2?.message || "")),
    "Second confirm should be deduped while in-flight"
  );
  assert.equal(confirmBookingCalls, 1, "bookeo.confirm_booking should only be called once while in-flight");

  const resp1 = await p1;
  assert.ok(
    /booking/i.test(String(resp1?.message || "")),
    "First confirm should return a booking confirmation message"
  );

  // After completion, a duplicate confirm should replay lastCompletion, not re-book.
  const resp3 = await orch.confirmPayment({ formData: ctx0.formData }, sessionId, orch.getContext(sessionId));
  assert.equal(confirmBookingCalls, 1, "bookeo.confirm_booking should not be called again after completion");
  assert.ok(
    /browse classes|booking/i.test(String(resp3?.message || "")),
    "Replay should return the last confirmation message"
  );

  // Normalization checks on args passed to provider
  assert.ok(lastConfirmArgs, "Should have captured bookeo.confirm_booking args");
  assert.equal(lastConfirmArgs.num_participants, 2, "num_participants should match participant count");
  assert.ok(Array.isArray(lastConfirmArgs.participant_data), "participant_data should be an array");
  assert.equal(lastConfirmArgs.participant_data.length, 2, "participant_data length should match");
  assert.equal(typeof lastConfirmArgs.delegate_data.firstName, "string", "delegate firstName should be a string");
  assert.equal(typeof lastConfirmArgs.delegate_data.lastName, "string", "delegate lastName should be a string");
  assert.equal(typeof lastConfirmArgs.delegate_data.email, "string", "delegate email should be a string");
}

async function run() {
  await testHiddenProgramFiltering();
  await testSiblingChildCaptureAndReviewFallback();
  await testSavedChildSelectionByNumber();
  await testSavedChildSelectionByName();
  await testDifferentChildOption();
  await testBookingIdempotencyAndNormalization();
  console.log("✅ PASS: sibling add-child + hidden closed program + saved child selection + idempotency regressions");
}

run().catch((err) => {
  console.error("❌ FAIL:", err?.stack || err);
  process.exit(1);
});


