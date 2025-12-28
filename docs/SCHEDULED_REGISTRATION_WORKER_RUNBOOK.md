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

### Worker (required)

The scheduled worker (`npm run worker:scheduled`) requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`

Optional:

- `SCHEDULED_WORKER_MAX_ATTEMPT_MS` (default `120000`) – how long to keep retrying at “open time”

**Stripe note:** The worker triggers success-fee charging via the Supabase Edge Function `stripe-charge-success-fee`. The worker itself does **not** need Stripe secrets as long as the edge function is configured correctly in Supabase.

### MCP server (web) (required)

The MCP server (`npm start`) uses the same Supabase + provider credentials plus OAuth config. See `docs/V1_ENV_VARS.md` for the full list.

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

### Railway step-by-step

In your Railway project:

1) Create a new service from the same GitHub repo (same branch as web).
2) Name it `signupassist-mcp-worker`.
3) Set **Start Command** to:

```bash
npm run worker:scheduled
```

4) Ensure the worker service has **no public domain** (it does not need inbound traffic).
5) Health checks:
   - If you can disable HTTP health checks for the worker service, do that.
   - If Railway insists on a healthcheck, the worker supports a minimal `GET /health` responder **as long as `PORT` is set**.
   - If you see “service unavailable” healthcheck retries, add `PORT=8080` to the worker service env vars.
6) Copy env vars from the web service and keep at minimum the **Worker (required)** set above.

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


