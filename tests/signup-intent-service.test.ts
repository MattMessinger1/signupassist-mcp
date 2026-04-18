import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
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

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const childA = "33333333-3333-4333-8333-333333333333";
const childB = "44444444-4444-4444-8444-444444444444";
const runA = "55555555-5555-4555-8555-555555555555";
const runB = "66666666-6666-4666-8666-666666666666";

function makeIntentId(index: number) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
}

function makeStorage() {
  const intents = new Map<string, SignupIntentRow>();
  const events: SignupIntentEventInsert[] = [];
  const childOwners = new Map<string, string>([
    [childA, userA],
    [childB, userB],
  ]);
  const runOwners = new Map<string, string>([
    [runA, userA],
    [runB, userB],
  ]);

  const storage: SignupIntentStorage = {
    async insertIntent(row: SignupIntentInsert) {
      const id = makeIntentId(intents.size + 1);
      const now = "2026-04-17T16:00:00.000Z";
      const intent: SignupIntentRow = {
        ...row,
        id,
        selected_child_id: null,
        autopilot_run_id: null,
        created_at: now,
        updated_at: now,
      };
      intents.set(id, intent);
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
        updated_at: "2026-04-17T16:01:00.000Z",
      };
      intents.set(id, updated);
      return updated;
    },
    async insertIntentEvent(event: SignupIntentEventInsert) {
      events.push(event);
    },
    async childBelongsToUser(childId: string, userId: string) {
      return childOwners.get(childId) === userId;
    },
    async autopilotRunBelongsToUser(runId: string, userId: string) {
      return runOwners.get(runId) === userId;
    },
  };

  return { storage, intents, events };
}

const createBody = {
  source: "activity_finder",
  originalQuery: "soccer at Keva for age 9",
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
    activityLabel: "Soccer",
    targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
    providerKey: "daysmart",
    providerName: "DaySmart / Dash",
  },
  targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
  providerKey: "daysmart",
  providerName: "DaySmart / Dash",
  finderStatus: "tested_fast_path",
};

describe("signup intent service", () => {
  it("creates a signup intent for the authenticated user", async () => {
    const { storage, intents } = makeStorage();
    const result = await createSignupIntent(storage, userA, createBody);
    const saved = intents.get(result.id);

    expect(result.status).toBe("ready_for_autopilot");
    expect(saved?.user_id).toBe(userA);
    expect(saved?.original_query).toBe("soccer at Keva for age 9");
    expect(saved?.provider_key).toBe("daysmart");
  });

  it("ignores spoofed client-sent userId values", async () => {
    const { storage, intents } = makeStorage();
    const result = await createSignupIntent(storage, userA, {
      ...createBody,
      userId: userB,
      user_id: userB,
    });

    expect(intents.get(result.id)?.user_id).toBe(userA);
  });

  it("blocks another user from reading or patching an intent", async () => {
    const { storage } = makeStorage();
    const result = await createSignupIntent(storage, userA, createBody);

    await expect(getSignupIntent(storage, userB, result.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "signup_intent_not_found",
    });
    await expect(
      patchSignupIntent(storage, userB, result.id, { status: "scheduled" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "signup_intent_not_found",
    });
  });

  it("validates related child and run ownership on safe patches", async () => {
    const { storage } = makeStorage();
    const result = await createSignupIntent(storage, userA, createBody);

    await expect(
      patchSignupIntent(storage, userA, result.id, {
        selected_child_id: childB,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "child_not_found",
    });

    await expect(
      patchSignupIntent(storage, userA, result.id, {
        autopilot_run_id: runB,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "autopilot_run_not_found",
    });

    const updated = await patchSignupIntent(storage, userA, result.id, {
      selected_child_id: childA,
      autopilot_run_id: runA,
      status: "scheduled",
    });

    expect(updated.selectedChildId).toBe(childA);
    expect(updated.autopilotRunId).toBe(runA);
    expect(updated.status).toBe("scheduled");
  });

  it("redacts unsafe URL detail from audit events", async () => {
    const { storage, events } = makeStorage();
    await createSignupIntent(storage, userA, createBody);

    expect(events).toHaveLength(1);
    expect(events[0].event.targetUrlHost).toBe("pps.daysmartrecreation.com");
    expect(JSON.stringify(events[0].event)).not.toContain("company=keva");
  });

  it("surfaces validation errors for invalid or unsafe target URLs", async () => {
    const { storage } = makeStorage();

    await expect(
      createSignupIntent(storage, userA, {
        ...createBody,
        targetUrl: "file:///etc/passwd",
      }),
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      createSignupIntent(storage, userA, {
        ...createBody,
        targetUrl: "https://127.0.0.1/signup",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
