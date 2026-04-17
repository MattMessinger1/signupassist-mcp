import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  handleSignupIntentApi,
  type SignupIntentSupabaseClient,
} from "../mcp_server/lib/signupIntentApi";
import type {
  SignupIntentEventInsert,
  SignupIntentInsert,
  SignupIntentRow,
  SignupIntentUpdate,
} from "../mcp_server/lib/signupIntent";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const childA = "33333333-3333-4333-8333-333333333333";
const childB = "44444444-4444-4444-8444-444444444444";
const runA = "55555555-5555-4555-8555-555555555555";
const runB = "66666666-6666-4666-8666-666666666666";

function makeIntentId(index: number) {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`;
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
    address: "8312 Forsythia St, Middleton, WI",
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

type Filter = {
  column: string;
  value: string;
};

type FakeState = {
  intents: Map<string, SignupIntentRow>;
  events: SignupIntentEventInsert[];
  childOwners: Map<string, string>;
  runOwners: Map<string, string>;
};

class FakeQuery<T> {
  private operation: "insert" | "update" | null = null;
  private values: unknown;
  private readonly filters: Filter[] = [];

  constructor(
    private readonly table: string,
    private readonly state: FakeState,
  ) {}

  select(): FakeQuery<T> {
    return this;
  }

  insert(values: unknown): FakeQuery<T> {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: unknown): FakeQuery<T> {
    this.operation = "update";
    this.values = values;
    return this;
  }

  eq(column: string, value: string): FakeQuery<T> {
    this.filters.push({ column, value });
    return this;
  }

  async single(): Promise<{ data: T | null; error: { message: string } | null }> {
    if (this.table === "signup_intents") {
      return this.singleSignupIntent();
    }

    if (this.table === "signup_intent_events") {
      this.state.events.push(this.values as SignupIntentEventInsert);
      return { data: { id: "event-1" } as T, error: null };
    }

    if (this.table === "children") {
      const id = this.filterValue("id");
      const userId = this.filterValue("user_id");
      const belongsToUser = id && userId && this.state.childOwners.get(id) === userId;
      return belongsToUser
        ? { data: { id } as T, error: null }
        : { data: null, error: { message: "not found" } };
    }

    if (this.table === "autopilot_runs") {
      const id = this.filterValue("id");
      const userId = this.filterValue("user_id");
      const belongsToUser = id && userId && this.state.runOwners.get(id) === userId;
      return belongsToUser
        ? { data: { id } as T, error: null }
        : { data: null, error: { message: "not found" } };
    }

    return { data: null, error: { message: "unsupported table" } };
  }

  private singleSignupIntent(): { data: T | null; error: { message: string } | null } {
    if (this.operation === "insert") {
      const row = this.values as SignupIntentInsert;
      const now = "2026-04-17T16:00:00.000Z";
      const intent: SignupIntentRow = {
        ...row,
        id: makeIntentId(this.state.intents.size + 1),
        selected_child_id: row.selected_child_id ?? null,
        autopilot_run_id: row.autopilot_run_id ?? null,
        created_at: now,
        updated_at: now,
      };
      this.state.intents.set(intent.id, intent);
      return { data: intent as T, error: null };
    }

    const intent = this.findIntent();
    if (!intent) return { data: null, error: { message: "not found" } };

    if (this.operation === "update") {
      const updated = {
        ...intent,
        ...(this.values as SignupIntentUpdate),
        updated_at: "2026-04-17T16:01:00.000Z",
      };
      this.state.intents.set(updated.id, updated);
      return { data: updated as T, error: null };
    }

    return { data: intent as T, error: null };
  }

  private findIntent() {
    const id = this.filterValue("id");
    const userId = this.filterValue("user_id");
    if (!id || !userId) return null;
    const intent = this.state.intents.get(id);
    return intent?.user_id === userId ? intent : null;
  }

  private filterValue(column: string) {
    return this.filters.find((filter) => filter.column === column)?.value ?? null;
  }
}

function makeSupabase() {
  const state: FakeState = {
    intents: new Map(),
    events: [],
    childOwners: new Map([
      [childA, userA],
      [childB, userB],
    ]),
    runOwners: new Map([
      [runA, userA],
      [runB, userB],
    ]),
  };
  const tokenOwners = new Map([
    ["token-a", userA],
    ["token-b", userB],
  ]);

  const supabase: SignupIntentSupabaseClient = {
    auth: {
      async getUser(token: string) {
        const id = tokenOwners.get(token);
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    from<T>(table: string) {
      return new FakeQuery<T>(table, state);
    },
  };

  return { supabase, ...state };
}

function makeRequest(params: {
  method: string;
  token?: string | null;
  body?: unknown;
}): IncomingMessage {
  const chunks =
    params.body === undefined ? [] : [Buffer.from(JSON.stringify(params.body), "utf8")];

  return {
    method: params.method,
    headers: params.token ? { authorization: `Bearer ${params.token}` } : {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as unknown as IncomingMessage;
}

function makeResponse() {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(statusCode: number, headers: Record<string, string> = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(payload?: string) {
      this.body += payload ?? "";
      return this;
    },
  };

  return response;
}

async function callApi(params: {
  supabase: SignupIntentSupabaseClient;
  method: string;
  path: string;
  token?: string | null;
  body?: unknown;
}) {
  const req = makeRequest(params);
  const res = makeResponse();
  await handleSignupIntentApi({
    req,
    res: res as unknown as ServerResponse,
    url: new URL(params.path, "https://app.signupassist.test"),
    supabase: params.supabase,
  });

  return {
    status: res.statusCode,
    headers: res.headers,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

describe("signup intent API bridge", () => {
  it("handles browser preflight without authenticating or writing data", async () => {
    const { supabase, intents } = makeSupabase();
    const response = await callApi({
      supabase,
      method: "OPTIONS",
      path: "/api/signup-intents",
    });

    expect(response.status).toBe(204);
    expect(response.headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(response.headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(intents.size).toBe(0);
  });

  it("fails unauthenticated create, read, and patch requests safely", async () => {
    const { supabase, intents } = makeSupabase();
    const intentId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

    await expect(
      callApi({ supabase, method: "POST", path: "/api/signup-intents", body: createBody }),
    ).resolves.toMatchObject({
      status: 401,
      json: { error: "authentication_required" },
    });
    await expect(
      callApi({ supabase, method: "GET", path: `/api/signup-intents/${intentId}` }),
    ).resolves.toMatchObject({
      status: 401,
      json: { error: "authentication_required" },
    });
    await expect(
      callApi({
        supabase,
        method: "PATCH",
        path: `/api/signup-intents/${intentId}`,
        body: { status: "scheduled" },
      }),
    ).resolves.toMatchObject({
      status: 401,
      json: { error: "authentication_required" },
    });

    expect(intents.size).toBe(0);
  });

  it("derives user ownership from the bearer token and ignores spoofed user IDs", async () => {
    const { supabase, intents, events } = makeSupabase();

    const response = await callApi({
      supabase,
      method: "POST",
      path: "/api/signup-intents",
      token: "token-a",
      body: {
        ...createBody,
        userId: userB,
        user_id: userB,
      },
    });

    expect(response.status).toBe(201);
    const saved = intents.get(response.json.id);
    expect(saved?.user_id).toBe(userA);
    expect(events[0].user_id).toBe(userA);
  });

  it("blocks another authenticated user from reading or patching an intent", async () => {
    const { supabase, intents } = makeSupabase();
    const created = await callApi({
      supabase,
      method: "POST",
      path: "/api/signup-intents",
      token: "token-a",
      body: createBody,
    });
    const intentId = created.json.id;

    await expect(
      callApi({
        supabase,
        method: "GET",
        path: `/api/signup-intents/${intentId}`,
        token: "token-b",
      }),
    ).resolves.toMatchObject({
      status: 404,
      json: { error: "signup_intent_not_found" },
    });

    await expect(
      callApi({
        supabase,
        method: "PATCH",
        path: `/api/signup-intents/${intentId}`,
        token: "token-b",
        body: { status: "scheduled" },
      }),
    ).resolves.toMatchObject({
      status: 404,
      json: { error: "signup_intent_not_found" },
    });

    expect(intents.get(intentId)?.status).toBe("ready_for_autopilot");
  });
});
