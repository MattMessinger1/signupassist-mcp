import { describe, expect, it } from "vitest";
import {
  createSignupIntent,
  getSignupIntent,
  patchSignupIntent,
  type SignupIntentEventInsert,
  type SignupIntentInsert,
  type SignupIntentRow,
  type SignupIntentStorage,
  type SignupIntentUpdate,
} from "../mcp_server/lib/signupIntent";
import { findPlaybookByKey } from "../src/lib/autopilot/playbooks";
import { buildAutopilotRunPacket, buildPreflightState } from "../src/lib/autopilot/runPacket";
import { normalizeRunStatus, summarizeAuditEvents } from "../src/lib/dashboardStatus";
import { buildRedactedProviderObservation, getProviderReadinessSummary } from "../src/lib/providerLearning";
import { buildAutopilotIntentPath } from "../src/lib/signupIntent";
import { isAutopilotSubscriptionUsable } from "../src/lib/subscription";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const childA = "33333333-3333-4333-8333-333333333333";
const runA = "55555555-5555-4555-8555-555555555555";

function makeIntentId(index: number) {
  return `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`;
}

function makeStorage() {
  const intents = new Map<string, SignupIntentRow>();
  const events: SignupIntentEventInsert[] = [];
  const runOwners = new Map([[runA, userA]]);

  const storage: SignupIntentStorage = {
    async insertIntent(row: SignupIntentInsert) {
      const now = "2026-04-18T17:00:00.000Z";
      const intent: SignupIntentRow = {
        ...row,
        id: makeIntentId(intents.size + 1),
        selected_child_id: null,
        autopilot_run_id: null,
        created_at: now,
        updated_at: now,
      };
      intents.set(intent.id, intent);
      return intent;
    },
    async getIntent(id: string, userId: string) {
      const intent = intents.get(id);
      return intent?.user_id === userId ? intent : null;
    },
    async updateIntent(id: string, userId: string, patch: SignupIntentUpdate) {
      const intent = intents.get(id);
      if (!intent || intent.user_id !== userId) return null;
      const updated = {
        ...intent,
        ...patch,
        updated_at: "2026-04-18T17:05:00.000Z",
      };
      intents.set(id, updated);
      return updated;
    },
    async insertIntentEvent(event: SignupIntentEventInsert) {
      events.push(event);
    },
    async childBelongsToUser(childId: string, userId: string) {
      return childId === childA && userId === userA;
    },
    async autopilotRunBelongsToUser(runId: string, userId: string) {
      return runOwners.get(runId) === userId;
    },
  };

  return { storage, events };
}

const createBody = {
  source: "activity_finder",
  originalQuery: "soccer at Keva in Madison for age 9",
  parsed: {
    activity: "soccer",
    venue: "Keva",
    city: "Madison",
    state: "WI",
    ageYears: 9,
    grade: null,
  },
  selectedResult: {
    status: "tested_fast_path",
    venueName: "Keva Sports Center",
    address: "8312 Forsythia St, Middleton, WI",
    activityLabel: "Soccer",
    targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
    providerKey: "daysmart",
    providerName: "DaySmart / Dash",
    confidence: 0.92,
    sourceFreshness: "Configured provider path",
  },
  targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
  providerKey: "daysmart",
  providerName: "DaySmart / Dash",
  finderStatus: "tested_fast_path",
  confidence: 0.92,
  sourceFreshness: "Configured provider path",
};

describe("authenticated web golden path contract", () => {
  it("links Activity Finder intent, Autopilot run packet, redacted learning, and dashboard status", async () => {
    const { storage, events } = makeStorage();
    const createdIntent = await createSignupIntent(storage, userA, createBody);
    const autopilotPath = buildAutopilotIntentPath(createdIntent.id);
    const loadedIntent = await getSignupIntent(storage, userA, createdIntent.id);
    const playbook = findPlaybookByKey("daysmart");
    const activeSubscription = {
      status: "active",
      cancel_at_period_end: false,
      current_period_end: null,
    };

    expect(isAutopilotSubscriptionUsable(activeSubscription)).toBe(true);
    expect(autopilotPath).toBe(`/autopilot?intent=${createdIntent.id}`);
    expect(loadedIntent.providerKey).toBe("daysmart");
    expect(loadedIntent.parsed.ageYears).toBe(9);
    expect(loadedIntent.confidence).toBe(0.92);
    expect(loadedIntent.sourceFreshness).toBe("Configured provider path");

    const packet = buildAutopilotRunPacket({
      playbook,
      targetUrl: loadedIntent.targetUrl || "",
      targetProgram: loadedIntent.selectedResult.activityLabel as string,
      registrationOpensAt: "2026-05-01T14:00:00.000Z",
      maxTotalCents: 25000,
      participantAgeYears: loadedIntent.parsed.ageYears,
      finder: {
        query: loadedIntent.originalQuery,
        status: loadedIntent.finderStatus,
        venue: loadedIntent.parsed.venue,
        address: loadedIntent.selectedResult.address as string,
        location: "Madison, WI",
      },
      reminder: {
        minutesBefore: 30,
        channels: ["email"],
        phoneNumber: null,
      },
      child: {
        id: childA,
        name: "Synthetic Reviewer",
      },
      preflight: buildPreflightState({
        providerAccountReady: true,
        childProfileReady: true,
        paymentPrepared: true,
        helperInstalled: true,
        targetUrlConfirmed: true,
      }),
    });
    const readiness = getProviderReadinessSummary(playbook.key);
    const providerLearning = {
      provider_readiness: readiness.readinessLevel,
      confidence: readiness.confidenceScore,
      active_playbook_version: readiness.activePlaybookVersion,
      fixture_coverage: readiness.fixtureCoverage,
      no_child_pii_in_learning: true,
      signup_intent_id: createdIntent.id,
    };
    const runInsert = {
      id: runA,
      provider_key: playbook.key,
      provider_name: playbook.name,
      target_url: loadedIntent.targetUrl,
      target_program: packet.target.program,
      status: "ready",
      confidence: playbook.confidence,
      caps: {
        max_total_cents: 25000,
        readiness_score: packet.readiness.score,
        finder: packet.finder,
        provider_learning: providerLearning,
      },
      allowed_actions: packet.safety.allowedActions,
      stop_conditions: packet.safety.stopConditions,
      audit_events: [
        { type: "run_created", provider_key: playbook.key },
        { type: "run_packet_created", readiness_score: packet.readiness.score },
      ],
      created_at: "2026-04-18T17:06:00.000Z",
    };
    const observation = buildRedactedProviderObservation(runInsert);
    const updatedIntent = await patchSignupIntent(storage, userA, createdIntent.id, {
      status: "scheduled",
      autopilot_run_id: runA,
      selected_child_id: childA,
    });
    const dashboardAudit = summarizeAuditEvents(runInsert.audit_events);

    expect(packet.mode).toBe("supervised_autopilot");
    expect(packet.readiness.score).toBe(100);
    expect(packet.payment.helperPausesAtCheckout).toBe(true);
    expect(packet.setAndForgetFoundation.finalSubmitRequiresParentApproval).toBe(true);
    expect(observation.provider_key).toBe("daysmart");
    expect(observation.redaction.child_pii).toBe("excluded");
    expect(JSON.stringify(observation)).not.toContain("Synthetic Reviewer");
    expect(JSON.stringify(observation)).not.toContain("8312 Forsythia");
    expect(updatedIntent.status).toBe("scheduled");
    expect(updatedIntent.autopilotRunId).toBe(runA);
    expect(updatedIntent.selectedChildId).toBe(childA);
    expect(normalizeRunStatus(runInsert.status)).toBe("ready");
    expect(dashboardAudit).toEqual(["Run Packet Created", "Run Created"]);
    expect(events.map((event) => event.event_type)).toEqual(["created", "read", "updated"]);
  });

  it("keeps the authenticated golden path owned by one user", async () => {
    const { storage } = makeStorage();
    const createdIntent = await createSignupIntent(storage, userA, createBody);

    await expect(getSignupIntent(storage, userB, createdIntent.id)).rejects.toMatchObject({
      code: "signup_intent_not_found",
    });
    await expect(
      patchSignupIntent(storage, userB, createdIntent.id, {
        status: "scheduled",
        autopilot_run_id: runA,
      }),
    ).rejects.toMatchObject({
      code: "signup_intent_not_found",
    });
  });
});
