# V1 Environment Variables (Web + Worker)

This is the authoritative env-var list for **v1 ChatGPT Apps via MCP**.

There are **two processes** in production:
- **Web (MCP server)**: `npm start` (serves `/sse`, `/orchestrator/chat`, OAuth proxy, manifests)
- **Worker**: `npm run worker:scheduled` (executes `scheduled_registrations` at `scheduled_time`)

---

## Required (both web + worker)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

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

You charge the **$20 success fee** via Stripe, only after booking success.

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


