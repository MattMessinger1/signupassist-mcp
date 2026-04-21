import { createSecretKey } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SignJWT } from "jose";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleHelperRunApi, type HelperRunSupabaseClient } from "../lib/helperRunApi.js";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const runA = "55555555-5555-4555-8555-555555555555";
const runB = "66666666-6666-4666-8666-666666666666";
const helperSecret = "helper-run-test-secret";

type Filter = {
  column: string;
  value: string;
};

type RunRow = {
  id: string;
  user_id: string;
  provider_key: string;
  provider_name: string;
  target_url: string;
  target_program: string | null;
  child_id: string | null;
  status: string;
  confidence: string;
  caps: unknown;
  allowed_actions: unknown;
  stop_conditions: unknown;
  audit_events: unknown;
};

type ChildRow = {
  first_name: string;
  last_name: string;
};

type FakeState = {
  runs: Map<string, RunRow>;
  children: Map<string, ChildRow & { user_id: string }>;
  tokenOwners: Map<string, string>;
};

class FakeQuery<T> {
  private readonly filters: Filter[] = [];

  constructor(
    private readonly table: string,
    private readonly state: FakeState,
  ) {}

  select(): FakeQuery<T> {
    return this;
  }

  eq(column: string, value: string): FakeQuery<T> {
    this.filters.push({ column, value });
    return this;
  }

  async single(): Promise<{ data: T | null; error: { message: string } | null }> {
    if (this.table === "autopilot_runs") {
      const id = this.filterValue("id");
      const userId = this.filterValue("user_id");
      const run = id ? this.state.runs.get(id) : null;
      if (!run || (userId && run.user_id !== userId)) {
        return { data: null, error: { message: "not found" } };
      }
      return { data: run as T, error: null };
    }

    if (this.table === "children") {
      const id = this.filterValue("id");
      const userId = this.filterValue("user_id");
      const child = id ? this.state.children.get(id) : null;
      if (!child || (userId && child.user_id !== userId)) {
        return { data: null, error: { message: "not found" } };
      }
      const { user_id: _userId, ...row } = child;
      return { data: row as T, error: null };
    }

    return { data: null, error: { message: "unsupported table" } };
  }

  private filterValue(column: string) {
    return this.filters.find((filter) => filter.column === column)?.value ?? null;
  }
}

function makeSupabase(overrides?: Partial<FakeState>): HelperRunSupabaseClient & { state: FakeState } {
  const state: FakeState = {
    runs: new Map<string, RunRow>([
      [
        runA,
        {
          id: runA,
          user_id: userA,
          provider_key: "daysmart",
          provider_name: "DaySmart / Dash",
          target_url: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
          target_program: "U8 soccer",
          child_id: "child-a",
          status: "ready",
          confidence: "verified",
          caps: {
            max_total_cents: 25000,
            registration_opens_at: "2026-05-01T09:00:00.000Z",
            participant_age_years: 8,
            reminder: {
              minutesBefore: 10,
              channels: ["email", "sms"],
              phoneNumber: "(555) 010-1111",
            },
            finder: {
              query: "soccer",
              status: "guided_autopilot",
            },
            preflight: {
              providerAccountReady: true,
              childProfileReady: true,
              paymentPrepared: true,
              helperInstalled: true,
              targetUrlConfirmed: true,
            },
          },
          allowed_actions: ["Fill known family profile fields", "Click safe non-final navigation buttons"],
          stop_conditions: ["Final submit, register, checkout, or purchase button"],
          audit_events: [
            {
              type: "run_created",
              token: "secret-token",
              payment_card: "4242424242424242",
              medical_notes: "none",
              child_name: "Avery Example",
            },
          ],
        },
      ],
      [
        runB,
        {
          id: runB,
          user_id: userB,
          provider_key: "daysmart",
          provider_name: "DaySmart / Dash",
          target_url: "https://example.com",
          target_program: "Swim",
          child_id: null,
          status: "completed",
          confidence: "verified",
          caps: {},
          allowed_actions: [],
          stop_conditions: [],
          audit_events: [],
        },
      ],
      ...(overrides?.runs ? [...overrides.runs.entries()] : []),
    ]),
    children: new Map<string, ChildRow & { user_id: string }>([
      ["child-a", { user_id: userA, first_name: "Avery", last_name: "Example" }],
    ]),
    tokenOwners: new Map<string, string>([
      ["token-a", userA],
      ["token-b", userB],
    ]),
  };

  if (overrides?.children) {
    for (const [key, value] of overrides.children.entries()) {
      state.children.set(key, value);
    }
  }

  const supabase: HelperRunSupabaseClient = {
    auth: {
      async getUser(token: string) {
        const id = state.tokenOwners.get(token);
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    from<T>(table: string) {
      return new FakeQuery<T>(table, state);
    },
  };

  return Object.assign(supabase, { state });
}

function makeRequest(params: {
  method: string;
  path: string;
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
    writeHead(statusCode: number, headers: Record<string, string>) {
      response.statusCode = statusCode;
      response.headers = { ...response.headers, ...headers };
      return response;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") response.body = chunk;
      else if (chunk) response.body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return response;
    },
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };

  return response;
}

async function parseJson<T = unknown>(response: { body: string }) {
  return JSON.parse(response.body) as T;
}

function helperTokenSecretKey() {
  return createSecretKey(Buffer.from(helperSecret));
}

beforeEach(() => {
  vi.stubEnv("HELPER_LINK_SIGNING_KEY", helperSecret);
  vi.stubEnv("HELPER_LINK_TTL_MINUTES", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("helper run API", () => {
  it("issues a short-lived helper code for the owning parent and returns the supervised packet", async () => {
    const supabase = makeSupabase();
    const linkRes = makeResponse();

    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-links",
        token: "token-a",
        body: { autopilotRunId: runA },
      }),
      res: linkRes,
      url: new URL("https://signupassist.example/api/helper/run-links"),
      supabase,
    });

    expect(linkRes.statusCode).toBe(200);
    const linkPayload = await parseJson<{ helperCode: string; expiresAt: string; provider: string; program: string | null }>(linkRes);
    expect(linkPayload.provider).toBe("DaySmart / Dash");
    expect(linkPayload.program).toBe("U8 soccer");
    expect(linkPayload.helperCode).toContain(".");
    expect(new Date(linkPayload.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const packetRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-packet",
        body: { helperCode: linkPayload.helperCode },
      }),
      res: packetRes,
      url: new URL("https://signupassist.example/api/helper/run-packet"),
      supabase,
    });

    expect(packetRes.statusCode).toBe(200);
    const packet = await parseJson<{
      mode: string;
      target: {
        providerName: string;
        program: string | null;
        child: Record<string, unknown> | null;
      };
      audit_events: Array<Record<string, unknown>>;
    }>(packetRes);
    expect(packet.mode).toBe("supervised_autopilot");
    expect(packet.target.providerName).toBe("DaySmart / Dash");
    expect(packet.target.program).toBe("U8 soccer");
    expect(packet.target.child).toEqual({ name: "Avery Example" });
    expect(Object.keys(packet.target.child || {})).toEqual(["name"]);
    expect(JSON.stringify(packet)).not.toContain("child-a");
    expect(JSON.stringify(packet)).not.toContain("4242424242424242");
    expect(JSON.stringify(packet)).not.toContain("secret-token");
    expect(packet.audit_events[0].token).toBe("[redacted]");
    expect(packet.audit_events[0].payment_card).toBe("[redacted]");
    expect(packet.audit_events[0].medical_notes).toBe("[redacted]");
  });

  it("rejects helper link requests for runs the parent does not own or cannot use", async () => {
    const supabase = makeSupabase();
    const linkRes = makeResponse();

    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-links",
        token: "token-a",
        body: { autopilotRunId: runB },
      }),
      res: linkRes,
      url: new URL("https://signupassist.example/api/helper/run-links"),
      supabase,
    });

    expect(linkRes.statusCode).toBe(404);
  });

  it("rejects helper codes with the wrong scope, bad signature, or expired timestamps", async () => {
    const supabase = makeSupabase();

    const badScopeCode = await new SignJWT({
      scope: "not_helper",
      autopilot_run_id: runA,
      user_id: userA,
      provider_key: "daysmart",
      provider_name: "DaySmart / Dash",
      target_program: "U8 soccer",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("signupassist-helper")
      .setAudience("signupassist-chrome-helper")
      .setExpirationTime("1m")
      .sign(helperTokenSecretKey());

    const scopeRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-packet",
        body: { helperCode: badScopeCode },
      }),
      res: scopeRes,
      url: new URL("https://signupassist.example/api/helper/run-packet"),
      supabase,
    });
    expect(scopeRes.statusCode).toBe(403);

    const linkRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-links",
        token: "token-a",
        body: { autopilotRunId: runA },
      }),
      res: linkRes,
      url: new URL("https://signupassist.example/api/helper/run-links"),
      supabase,
    });
    const linkPayload = await parseJson<{ helperCode: string }>(linkRes);
    const [headerPart, payloadPart, signaturePart] = linkPayload.helperCode.split(".");
    const tamperedSignature = `${signaturePart.slice(0, -1)}${signaturePart.slice(-1) === "a" ? "b" : "a"}`;

    const tamperedPacketRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-packet",
        body: { helperCode: `${headerPart}.${payloadPart}.${tamperedSignature}` },
      }),
      res: tamperedPacketRes,
      url: new URL("https://signupassist.example/api/helper/run-packet"),
      supabase,
    });
    expect(tamperedPacketRes.statusCode).toBe(401);

    const expiredCode = await new SignJWT({
      scope: "helper_run_packet",
      autopilot_run_id: runA,
      user_id: userA,
      provider_key: "daysmart",
      provider_name: "DaySmart / Dash",
      target_program: "U8 soccer",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setIssuer("signupassist-helper")
      .setAudience("signupassist-chrome-helper")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(helperTokenSecretKey());

    const expiredPacketRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-packet",
        body: { helperCode: expiredCode },
      }),
      res: expiredPacketRes,
      url: new URL("https://signupassist.example/api/helper/run-packet"),
      supabase,
    });
    expect(expiredPacketRes.statusCode).toBe(401);
  });

  it("rejects helper packets when the run is no longer in an allowed status", async () => {
    const supabase = makeSupabase();
    const run = supabase.state.runs.get(runA);
    if (!run) throw new Error("Missing run");
    run.status = "completed";

    const linkRes = makeResponse();
    await handleHelperRunApi({
      req: makeRequest({
        method: "POST",
        path: "/api/helper/run-links",
        token: "token-a",
        body: { autopilotRunId: runA },
      }),
      res: linkRes,
      url: new URL("https://signupassist.example/api/helper/run-links"),
      supabase,
    });

    expect(linkRes.statusCode).toBe(409);
  });
});
