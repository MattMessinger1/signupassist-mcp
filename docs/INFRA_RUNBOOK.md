# SignupAssist Infra Runbook

## Platform Decision

SignupAssist V1 stays on **Supabase + Railway**.

- Supabase is the source of truth for auth, Postgres, RLS, realtime, Edge Functions, migrations, generated types, and billing state.
- Railway is the production runtime for the MCP web service and the always-on scheduled registration worker.
- Do not migrate to Vercel, Neon, Clerk, Convex, or another DB/auth/runtime stack unless the product direction is explicitly reopened.
- Keep any historical Vercel project disconnected from GitHub auto-deploys; Vercel is not a SignupAssist deploy target.

This runbook exists so Codex and humans have a fast path for safe changes inside the current stack.

## One-Command Local Check

Use this before handing work back:

```bash
npm run predeploy:check
```

That runs:

- `npm run infra:check`
- `npm run mcp:build`
- `npm run build`
- `npm run test`

`infra:check` is non-destructive. Missing production env vars are warnings by default so local and Codex runs do not need secrets. Use strict mode before deploy:

```bash
INFRA_CHECK_STRICT=1 npm run infra:check
```

## Environment Management Workflow

Use `docs/ENVIRONMENT.md` and `scripts/envRegistry.ts` as the source of truth for env vars. The fast path is:

```bash
npm run env:check -- --target=local
npm run env:list -- --target=railway-web
npm run env:write -- --target=railway-web --out=.env.railway-web.generated
npm run env:write -- --target=railway-worker --out=.env.railway-worker.generated
npm run env:write -- --target=supabase-functions --out=.env.supabase.generated
```

Generated `.env.*` files are ignored by git. Use them to apply variables to Railway or Supabase in one pass instead of copying values from scattered docs.

## Required Environment Checklist

Railway web service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`
- `MCP_ACCESS_TOKEN`
- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_AUDIENCE`
- `OPENAI_API_KEY`

Railway scheduled worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`
- `SCHEDULED_WORKER_MAX_ATTEMPT_MS` optional, default `120000`

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MCP_BASE_URL`
- `VITE_MCP_ACCESS_TOKEN`

Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_AUTOPILOT_PRICE_ID` optional; checkout can create inline $9/month price data

## Production Process Model

Run two Railway services from the same repo:

1. `signupassist-mcp-web`
   - Start command: `npm start`
   - Public HTTP service
   - Health check: `GET /health`

2. `signupassist-mcp-worker`
   - Start command: `npm run worker:scheduled`
   - Always-on background process
   - No public domain required
   - If Railway requires HTTP health checks, set `PORT=8080`; the worker exposes `GET /health`

Do not replace the scheduled worker with cron-only infrastructure. The worker is the competitive registration path and should keep second-level timing as a business requirement.

## Smoke Commands

Railway web and worker health:

```bash
RAILWAY_MCP_URL=https://your-web.up.railway.app \
RAILWAY_WORKER_URL=https://your-worker.up.railway.app \
npm run infra:smoke:railway
```

If the worker has no public URL, run the health check from an environment that can reach the worker, or leave `RAILWAY_WORKER_HEALTH_REQUIRED` unset so the smoke marks it as skipped instead of failed.

Supabase DB and optional public Edge Function smoke:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
SUPABASE_ANON_KEY=... \
npm run infra:smoke:supabase
```

Stripe credential and autopilot price smoke:

```bash
STRIPE_SECRET_KEY=... \
STRIPE_WEBHOOK_SECRET=... \
STRIPE_AUTOPILOT_PRICE_ID=... \
npm run infra:smoke:stripe
```

Safe scheduled registration smoke, which schedules and cancels without executing:

```bash
MCP_SERVER_URL=... MCP_ACCESS_TOKEN=... E2E_USER_ID=... npm run test:e2e
```

Real worker execution smoke, which can book and charge, requires explicit confirmation:

```bash
MCP_SERVER_URL=... MCP_ACCESS_TOKEN=... E2E_USER_ID=... E2E_EXECUTE=1 npm run test:worker
```

## Supabase Operating Rules

- Migrations are the only schema-change path.
- Regenerate `src/integrations/supabase/types.ts` after schema changes.
- Keep RLS policies explicit for parent-owned records, subscriptions, and autopilot runs.
- Keep realtime subscriptions in the plan execution UI working; do not replace them with polling unless there is a specific reliability reason.
- Edge Functions should authenticate users with JWTs unless they are explicitly public health/test endpoints.
- Service-role keys belong only in backend/worker/function environments.

## Billing Operating Rules

- Preserve the existing `$20 success fee` path for the future fully automated Set and Forget product. V1 supervised autopilot does not charge a success fee.
- Keep the `$9/month` SignupAssist Autopilot subscription path separate.
- Stripe webhooks must update Supabase subscription state.
- Cancel-renewal must stay visible from dashboard, autopilot, and post-run screens.

## Deployment And Rollback

Before deploy:

```bash
npm run predeploy:check
```

Deploy:

- Push to the Railway-connected branch, or redeploy from the Railway dashboard.
- Confirm the web service deploy logs include MCP build output and server startup.
- Confirm the worker service deploy logs include scheduled worker startup.

Rollback:

- Prefer Railway dashboard rollback to the last healthy deploy for urgent incidents.
- For code rollback, revert the offending commit and push.
- For schema issues, write a forward migration unless a destructive rollback is explicitly reviewed.

## Codex Workflow

When Codex changes infra-sensitive code:

- Read this file first.
- Run `npm run predeploy:check` when feasible.
- Use the targeted smoke scripts when secrets/URLs are available.
- Do not introduce new hosting, auth, or database providers without an explicit product decision.
- Keep Chrome helper code isolated from MCP and frontend builds until its release process is finalized.
