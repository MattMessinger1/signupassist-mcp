# V1 Environment Variables (Web + Worker)

The machine-readable source of truth is `scripts/envRegistry.ts`.
Use `docs/ENVIRONMENT.md` for the workflow and `npm run env:list -- --target=<target>` for the current target-specific list.

This page summarizes the v1 ChatGPT Apps via MCP env surface.

Platform decision: V1 stays on **Supabase + Railway**. Do not add Vercel, Neon,
Clerk, Convex, or another DB/auth/runtime stack unless that decision is
explicitly reopened.

There are **two processes** in production:
- **Web (MCP server)**: `npm start` (serves `/sse`, `/orchestrator/chat`, OAuth proxy, manifests)
- **Worker**: `npm run worker:scheduled` (executes `scheduled_registrations` at `scheduled_time`)

---

## Required (both web + worker)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Required for frontend builds

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MCP_BASE_URL`

Do not set bearer tokens with a `VITE_` prefix in production. Vite exposes `VITE_*`
values to the browser bundle. The legacy chat/test harness now reads any MCP test
token from browser `localStorage` and is hidden unless test routes are explicitly
enabled.

---

## Required for ChatGPT OAuth (web)

- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_AUDIENCE`

Optional but recommended:
- `RAILWAY_PUBLIC_DOMAIN` (used to compute correct base URL in OAuth metadata rewriting)

---

## Required for Bookeo (v1 provider, web + worker)

- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`

---

## Required for Stripe success fee (web + worker)

The **$20 success fee** path remains paused unless the sensitive-action payment
gates are explicitly enabled and verified. Stripe setup/payment metadata must stay
server-side.

The exact Stripe env vars depend on your edge function configuration, but typically:
- `STRIPE_SECRET_KEY` (or equivalent used by your Supabase edge functions)

If you use per-function secrets in Supabase, ensure those are set in Supabase (not Railway).

---

## Optional / recommended (production hygiene)

- `OPENAI_API_KEY` (required for full orchestration; server boots without it only if you avoid OpenAI calls)
- `RUN_OPENAI_SMOKE_TESTS` (default: false) — set to `true` to run OpenAI startup smoke tests
- `OPENAI_VERIFICATION_TOKEN` (served at `/.well-known/openai-verification.txt` if required for submission UI)

---

## Security hardening (recommended)

### Rate limiting (web)

Implemented in `mcp_server/index.ts` (in-memory; per token hash when available, else per IP).

- `RATE_LIMIT_ENABLED` (default: enabled in `NODE_ENV=production`)
- `RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `RATE_LIMIT_TOOLS_MAX` (default: `240`)
- `RATE_LIMIT_MESSAGES_MAX` (default: `600`)
- `RATE_LIMIT_SSE_MAX` (default: `240`)
- `RATE_LIMIT_OAUTH_TOKEN_MAX` (default: `2000`)
- `SSE_MAX_ACTIVE` (default: `5`) — concurrent SSE streams per token/IP

### Request size caps (web)

These return **413** when exceeded (prevents unbounded buffering).

- `MAX_TOOLS_CALL_BODY_BYTES` (default: `262144`)
- `MAX_MESSAGES_BODY_BYTES` (default: `262144`)
- `MAX_OAUTH_TOKEN_BODY_BYTES` (default: `65536`)

---

## Worker-specific tuning (optional)

- `SCHEDULED_WORKER_MAX_ATTEMPT_MS` (default: 120000) — how long to rapid-retry “book at the second”

## Smoke-test helpers (optional)

- `RAILWAY_MCP_URL` or `MCP_SERVER_URL` for `npm run infra:smoke:railway`
- `RAILWAY_WORKER_URL` or `WORKER_HEALTH_URL` for worker health smoke
- `RAILWAY_WORKER_HEALTH_REQUIRED=1` to fail when worker health URL is absent
- `SUPABASE_SMOKE_FUNCTIONS` comma-separated public function names for `npm run infra:smoke:supabase`
- `STRIPE_AUTOPILOT_PRICE_ID` for `npm run infra:smoke:stripe`
