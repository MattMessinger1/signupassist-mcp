# Admin Console (v1)

This repo contains a **feature-flagged** admin console UI and a small admin API surface for querying operational data.

## What it is

- **UI**: React route at `/admin` (see `src/pages/admin/AdminConsole.tsx`)
- **API**: MCP server endpoints under `/admin/api/*` (see `mcp_server/index.ts`)
- **Data source (v1)**: Supabase `audit_events` (redacted + hashed args/results) + PostHog (optional)

## Safety posture

- The admin console is **not used by ChatGPT** and does not change OAuth/SSE/tool behavior.
- The admin API is **disabled by default** and returns 404 unless `ADMIN_API_ENABLED=true`.
- All admin API requests require:
  - a **Supabase user access token** (`Authorization: Bearer <supabase_access_token>`)
  - the user email to be in `ADMIN_EMAIL_ALLOWLIST`

## Environment variables

### MCP server (Railway / Node)

- **`ADMIN_API_ENABLED`**: set to `true` to enable `/admin/api/*`
- **`ADMIN_EMAIL_ALLOWLIST`**: comma-separated emails (lower/upper case ignored)
  - Example: `ADMIN_EMAIL_ALLOWLIST=you@domain.com,ops@domain.com`
- **`ADMIN_METRICS_SAMPLE_LIMIT`** *(optional)*: how many recent `audit_events` to sample when computing top tools/providers (default `5000`)

### PostHog (server-side capture; optional)

- **`POSTHOG_API_KEY`**: PostHog project API key (enables event capture)
- **`POSTHOG_HOST`** *(optional)*: defaults to `https://app.posthog.com` (set `https://eu.posthog.com` for EU)
- **`POSTHOG_TIMEOUT_MS`** *(optional)*: network timeout (default `1200`)

Captured events (best-effort, non-blocking):
- `tool_call_started`
- `tool_call_finished` (includes `decision` + `duration_ms`)

### Frontend (Vite)

- **`VITE_ADMIN_CONSOLE_ENABLED`**: set to `true` to enable the `/admin` route (otherwise behaves like 404)
- **`VITE_ADMIN_API_BASE_URL`**: base URL of the MCP server (e.g., `https://<railway-domain>`)

Optional convenience links:
- **`VITE_POSTHOG_PROJECT_URL`**: URL to your PostHog project (UI link only)
- **`VITE_SENTRY_PROJECT_URL`**: URL to your Sentry project (UI link only)

## API endpoints

- `GET /admin/api/me`
- `GET /admin/api/metrics` (24h)
- `GET /admin/api/audit-events?limit=100&q=&decision=&provider=&tool=&offset=0`

## Notes

- The admin API validates Supabase tokens via `supabase.auth.getUser(token)` and does not trust client identity.
- For production, you can keep the UI dark with `VITE_ADMIN_CONSOLE_ENABLED=false` and only enable on demand.


