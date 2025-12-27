# Scheduled Registration Worker Runbook (v1)

This worker is the **always-on** process that executes `scheduled_registrations` at (or as close as possible to) their `scheduled_time`, then:

- executes the provider booking (v1: Bookeo via API),
- charges the SignupAssist **$20 success fee** (Stripe),
- writes a unified receipt row to `registrations`,
- updates the `scheduled_registrations` row status + audit trail.

This is required for **“schedule now, execute the second the signup window opens”**.

---

## What runs where

- **MCP server (web)**: `npm start` (runs `mcp_server/index.ts` compiled to `dist/`)
- **Worker (background)**: `npm run worker:scheduled` (runs `dist/mcp_server/worker/scheduledRegistrationWorker.js`)

In production these should be deployed as **two separate processes** (recommended: two Railway services using the same repo).

---

## Start commands

### MCP server

```bash
npm start
```

### Worker

```bash
npm run worker:scheduled
```

---

## Required environment variables (worker + server)

The worker uses the same provider + DB stack as the server.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (if referenced by shared libs)
- `OPENAI_API_KEY` (if any shared initialization requires it; worker should not depend on it for v1)
- `STRIPE_SECRET_KEY` (or the specific Stripe env vars expected by your edge functions)
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- Provider credentials (v1: Bookeo API keys / org refs as used by `mcp_server/providers/bookeo.ts`)

**Important:** The worker must run with credentials that can:
- read/update `scheduled_registrations`
- insert/update `registrations`
- write audit events (mandates/audit provider)

---

## Operational expectations

- **Precision**: the worker should attempt execution at second-level precision (best-effort given hosting scheduler jitter).
- **Idempotency**: a job must not double-book if the worker restarts mid-flight. Status transitions should prevent concurrent execution.
- **Retries**: transient provider/network errors should retry with backoff; permanent validation errors should mark `failed` with a human-readable message.

---

## Recommended production deployment (Railway)

Create **two services** from the same repo:

1) **signupassist-mcp-web**
- Start command: `npm start`
- Expose port (Railway HTTP service)

2) **signupassist-mcp-worker**
- Start command: `npm run worker:scheduled`
- No public port required

Both services must share the same env var set (or worker must have the subset listed above).

---

## How to verify it’s working (smoke test)

1) Schedule a signup via chat (creates a row in `scheduled_registrations`).
2) Confirm it (status should be `pending`).
3) Set the `scheduled_time` to ~2 minutes in the future (test org/program).
4) Watch worker logs:
   - it should pick up the row near the scheduled time,
   - transition status `pending` → `executing` → `completed`,
   - create a `registrations` row with `REG-` receipt code surfaced in chat.

---

## Failure modes & what to check

- **Jobs never execute**
  - worker process not running
  - worker cannot read `scheduled_registrations` (RLS/policies)
  - bad env vars (Supabase URL/service role key)

- **Jobs execute late**
  - hosting jitter / sleep granularity
  - too many jobs per polling interval (increase throughput / reduce sleep)

- **Bookings succeed but no receipts**
  - DB insert to `registrations` failing (schema mismatch, missing columns)

- **Success fee not charged**
  - Stripe edge function env vars missing
  - mandate missing/invalid


