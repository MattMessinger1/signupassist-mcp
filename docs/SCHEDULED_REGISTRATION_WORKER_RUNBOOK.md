# Scheduled Registration Worker Runbook (v1)

This worker is the **always-on** process that watches `scheduled_registrations` at (or as close as possible to) their `scheduled_time`.

For the current supervised MVP, the worker **does not submit provider bookings, charge Stripe, accept waivers, log in to providers, or final-submit registrations automatically**. It pauses the run for parent review until the sensitive-action confirmation and future verified delegation mandate gates are complete.

The worker is still useful now because it keeps the timing path warm and records safe next-step status. Future delegated execution requires provider readiness, exact program match, price cap, audit logs, deterministic policy checks, and a valid signed mandate.

Platform decision: keep this as an **always-on Railway worker** for V1. Do not
move scheduled registration execution to cron-only infrastructure unless the
product explicitly drops second-level competitive timing as a requirement.

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

Note: in local development, the root package may run a prebuild before `worker:scheduled`. In the production Docker image, `package.production.json` expects `dist/` to already exist from the Docker build and runs the compiled worker directly.

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

**Stripe note:** The worker does not charge success fees in the supervised MVP. Payment and success-fee automation remain paused until the sensitive-action gates and future delegation mandate path are verified.

### MCP server (web) (required)

The MCP server (`npm start`) uses the same Supabase + provider credentials plus OAuth config. See `docs/V1_ENV_VARS.md` for the full list.

**Important:** The worker must run with credentials that can:
- read/update `scheduled_registrations`
- insert/update `registrations`
- write audit events (mandates/audit provider)

---

## Operational expectations

- **Precision**: the worker should wake near scheduled time and move the run into a parent-review state.
- **Idempotency**: a job must not double-book or double-charge if the worker restarts mid-flight. Current V1 behavior is fail-closed/pause-first.
- **Retries**: transient database/network errors should retry with backoff; unsafe external actions should remain paused with a human-readable message.

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

Non-destructive repo and health checks:

```bash
npm run infra:check
RAILWAY_MCP_URL=https://your-web.up.railway.app \
RAILWAY_WORKER_URL=https://your-worker.up.railway.app \
npm run infra:smoke:railway
```

1) Schedule a supervised signup run that creates a row in `scheduled_registrations`.
2) Confirm the row is `pending`.
3) Set the `scheduled_time` to ~2 minutes in the future in a test environment.
4) Watch worker logs:
   - it should pick up the row near the scheduled time,
   - avoid provider submit/payment/waiver/final-submit calls,
   - mark the run as paused or failed with parent-review copy until the future sensitive-action/delegation gate is available.

---

## Failure modes & what to check

- **Jobs never execute**
  - worker process not running
  - worker cannot read `scheduled_registrations` (RLS/policies)
  - bad env vars (Supabase URL/service role key)

- **Jobs execute late**
  - hosting jitter / sleep granularity
  - too many jobs per polling interval (increase throughput / reduce sleep)

- **Worker attempts provider booking or payment**
  - treat as a release blocker
  - verify the current fail-closed sensitive-action gate is deployed
  - confirm no provider/Stripe execution path bypasses parent confirmation
