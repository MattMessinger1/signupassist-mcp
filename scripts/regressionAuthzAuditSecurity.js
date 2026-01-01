/**
 * Regression: cross-user isolation + audit redaction stability
 *
 * This script runs locally (no network) against the built `dist/` output to ensure:
 * - `viewAuditTrail` and `cancelRegistrationStep2` enforce `user_id` scoping
 * - audit trail rendering does not crash when args_json is redacted ("[REDACTED]")
 *
 * Run:
 *   npm run test:authz-audit
 */
import assert from "node:assert/strict";
import APIOrchestrator from "../dist/mcp_server/ai/APIOrchestrator.js";

function createSupabaseMock(fixtures) {
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = {};
      this._select = null;
      this._update = null;
    }

    select(fields) {
      this._select = fields;
      calls.push({ table: this.table, op: "select", fields });
      return this;
    }

    update(values) {
      this._update = values;
      calls.push({ table: this.table, op: "update", values });
      return this;
    }

    order(column, opts) {
      calls.push({ table: this.table, op: "order", column, opts });
      return this;
    }

    limit(n) {
      calls.push({ table: this.table, op: "limit", n });
      return this;
    }

    eq(column, value) {
      this.filters[column] = value;
      calls.push({ table: this.table, op: "eq", column, value });
      return this;
    }

    async maybeSingle() {
      const { data, error } = this._executeSingle({ maybe: true });
      return { data, error };
    }

    async single() {
      const { data, error } = this._executeSingle({ maybe: false });
      return { data, error };
    }

    // Make the query builder await-able (Supabase QueryBuilder is thenable).
    then(resolve, reject) {
      try {
        const result = this._executeList();
        return Promise.resolve(result).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    }

    _executeSingle({ maybe }) {
      const handler = fixtures?.[this.table];
      if (!handler) return { data: null, error: null };
      const out = handler({ filters: this.filters, op: this._update ? "update" : "select_one", maybe });
      if (out && typeof out === "object" && "error" in out) return out;
      return { data: out ?? null, error: null };
    }

    _executeList() {
      const handler = fixtures?.[this.table];
      if (!handler) return { data: [], error: null };
      const out = handler({ filters: this.filters, op: this._update ? "update" : "select_list" });
      if (out && typeof out === "object" && "error" in out) return out;
      return { data: out ?? [], error: null };
    }
  }

  return {
    calls,
    client: {
      from(table) {
        calls.push({ table, op: "from" });
        return new Query(table);
      },
    },
  };
}

function hasEq(calls, table, column) {
  return calls.some((c) => c.table === table && c.op === "eq" && c.column === column);
}

async function run() {
  const sessionId = "regression-session";
  const user1 = "user-11111111-1111-1111-1111-111111111111";
  const user2 = "user-22222222-2222-2222-2222-222222222222";

  // --- Case 1: viewAuditTrail enforces user_id + renders redacted args safely
  {
    const registrationId = "reg-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const mandateId = "mandate-11111111-1111-1111-1111-111111111111";

    const supa = createSupabaseMock({
      registrations: ({ filters }) => {
        // SECURITY: must scope by user_id.
        if (!filters.user_id) return { data: null, error: new Error("missing user_id filter") };
        if (filters.user_id !== user1) return null;
        if (filters.id !== registrationId) return null;
        return {
          mandate_id: mandateId,
          program_name: "Test Program",
          booking_number: "B123",
          delegate_name: "Parent",
          amount_cents: 1000,
          success_fee_cents: 2000,
          created_at: new Date().toISOString(),
        };
      },
      mandates: ({ filters }) => {
        if (filters.id !== mandateId) return null;
        return {
          id: mandateId,
          scope: ["scp:register", "platform:success_fee"],
          valid_from: new Date(Date.now() - 1000).toISOString(),
          valid_until: new Date(Date.now() + 1000).toISOString(),
          status: "active",
          provider: "bookeo",
          jws_compact: "header.payload.sig",
        };
      },
      audit_events: ({ filters }) => {
        if (filters.mandate_id !== mandateId) return [];
        return [
          {
            tool: "bookeo.confirm_booking",
            decision: "allowed",
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            event_type: "tool_call",
            // Key regression: audit args can be redacted to a string.
            args_json: { delegate_data: "[REDACTED]", participant_data: "[REDACTED]", event_id: "evt_123" },
            result_json: { success: true, data: { booking_number: "B123", program_name: "Test Program" } },
            args_hash: "aa".repeat(32),
            result_hash: "bb".repeat(32),
          },
        ];
      },
    });

    const orch = new APIOrchestrator({ tools: new Map() });
    orch.getSupabaseClient = () => supa.client;

    const resp = await orch.viewAuditTrail({ registration_id: registrationId }, sessionId, {
      user_id: user1,
      userTimezone: "UTC",
      orgRef: "aim-design",
    });

    assert.ok(hasEq(supa.calls, "registrations", "user_id"), "viewAuditTrail must query registrations scoped by user_id");
    // The detailed event info is rendered into cards (not necessarily into the top-level message).
    const cardsText = Array.isArray(resp?.cards) ? resp.cards.map((c) => String(c?.description || "")).join("\n\n") : "";
    assert.ok(
      cardsText.includes("Participants: [REDACTED]") || cardsText.includes("Participants: N/A"),
      "viewAuditTrail must render redacted participant_data without crashing"
    );

    // Cross-user attempt should not reveal data.
    const supa2 = createSupabaseMock({
      registrations: ({ filters }) => {
        if (!filters.user_id) return { data: null, error: new Error("missing user_id filter") };
        if (filters.user_id !== user2) return null;
        return null;
      },
    });
    const orch2 = new APIOrchestrator({ tools: new Map() });
    orch2.getSupabaseClient = () => supa2.client;
    const resp2 = await orch2.viewAuditTrail({ registration_id: registrationId }, sessionId, {
      user_id: user2,
      userTimezone: "UTC",
      orgRef: "aim-design",
    });
    assert.match(String(resp2?.message || ""), /not found|sign in/i, "cross-user audit should not succeed");
  }

  // --- Case 2: cancelRegistrationStep2 (scheduled) enforces user_id scoping
  {
    const scheduledId = "sch-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const supa = createSupabaseMock({
      scheduled_registrations: ({ filters, op }) => {
        if (!filters.user_id) return { data: null, error: new Error("missing user_id filter") };
        if (filters.user_id !== user1) return null;
        if (filters.id !== scheduledId) return null;
        if (op === "update") return { data: null, error: null };
        return { id: scheduledId, program_name: "Test Program", status: "pending" };
      },
    });

    const orch = new APIOrchestrator({ tools: new Map() });
    orch.getSupabaseClient = () => supa.client;
    orch.updateContextAndAwait = async () => {}; // avoid DB writes in this regression

    const resp = await orch.cancelRegistrationStep2({ scheduled_registration_id: scheduledId }, sessionId, {
      user_id: user1,
      userTimezone: "UTC",
      orgRef: "aim-design",
    });
    assert.ok(hasEq(supa.calls, "scheduled_registrations", "user_id"), "cancelRegistrationStep2 must scope scheduled_registrations by user_id");
    assert.match(String(resp?.message || ""), /cancelled/i, "scheduled cancel should succeed for owner");

    const supa2 = createSupabaseMock({
      scheduled_registrations: ({ filters }) => {
        if (!filters.user_id) return { data: null, error: new Error("missing user_id filter") };
        if (filters.user_id !== user2) return null;
        return null;
      },
    });
    const orch2 = new APIOrchestrator({ tools: new Map() });
    orch2.getSupabaseClient = () => supa2.client;
    orch2.updateContextAndAwait = async () => {};

    const resp2 = await orch2.cancelRegistrationStep2({ scheduled_registration_id: scheduledId }, sessionId, {
      user_id: user2,
      userTimezone: "UTC",
      orgRef: "aim-design",
    });
    assert.match(String(resp2?.message || ""), /not found/i, "cross-user scheduled cancel should not succeed");
  }

  // --- Case 3: resolveRegistrationRef fail-closed (no cross-user fallback when userId is provided)
  {
    const token = "deadbeef";

    const supa = createSupabaseMock({
      registrations: ({ filters }) => {
        // Simulate an error on the user-scoped query (e.g., schema mismatch / RLS error).
        if (filters.user_id) return { data: null, error: { message: "simulated error" } };
        // SECURITY: if code ever falls back to unscoped, fail the regression immediately.
        throw new Error("UNSCOPED_REGISTRATIONS_QUERY_SHOULD_NOT_RUN");
      },
    });

    const orch = new APIOrchestrator({ tools: new Map() });
    orch.getSupabaseClient = () => supa.client;

    const resolved = await orch.resolveRegistrationRef(`REG-${token}`, user1);
    assert.equal(resolved, null, "resolveRegistrationRef should fail closed (no unscoped fallback) when userId is present");
  }

  console.log("✅ PASS: authz isolation + audit redaction regression checks");
}

run().catch((err) => {
  console.error("❌ FAIL:", err?.stack || err);
  process.exit(1);
});


