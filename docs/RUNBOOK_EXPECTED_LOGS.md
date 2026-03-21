# Runbook: Expected Log Milestones

This document defines what "good" looks like in logs for a successful **Bookeo API** authentication and program discovery flow.

## Overview

A successful flow consists of:
1. **API connectivity** — Bookeo credentials validate (`bookeo.test_connection`)
2. **Catalog sync** — `sync-bookeo` / `bookeo.find_programs` returns programs from cache or API
3. **Orchestrator** — Cards and mandates propagate correctly

## Success Markers

### 1. Bookeo API health
```
[Bookeo Test] Testing connection: GET /settings/apikeyinfo
```
- **What it means**: Server can authenticate to the Bookeo API
- **Missing?**: Check `BOOKEO_API_KEY`, `BOOKEO_SECRET_KEY` on Railway and in Supabase secrets as applicable

### 2. Program discovery
```
[bookeo.find_programs] ...
```
- **What it means**: Program list was returned for the org (e.g. `aim-design`)
- **Why it matters**: Confirms feed/API path is working
- **Missing?**: Check `mcp_server/providers/bookeo.ts` and cached feed rows

### 3. Field discovery (optional)
```
bookeo.discover_required_fields
```
- **What it means**: Registration form schema retrieved for a product
- **Missing?**: Verify `program_ref` / `org_ref` and Bookeo product configuration

## Anti-Patterns

### Mandate / auth issues
```
[audit] ❌ Mandate verification failed
```
- **Fix**: Ensure `mandate_jws` / scopes include Bookeo actions (e.g. `bookeo:read_products`, `bookeo:create_booking`)

## Environment Variables Checklist

### Required for Bookeo & MCP
- `OPENAI_API_KEY` — Orchestrator / tools that call the model
- `BOOKEO_API_KEY` / `BOOKEO_SECRET_KEY` — Bookeo API (Railway / sync)
- `MCP_SERVER_URL` — MCP HTTP endpoint
- `MCP_ACCESS_TOKEN` — Authenticated calls to MCP where required
- `MANDATE_SIGNING_KEY` — Mandate creation/verification

### Optional
- `SESSION_CACHE_TTL_MS` — Session cache duration where applicable

### Development
- `DEV_MANDATE_JWS` — Fallback mandate for local dev
- `NODE_ENV` — `"development"` for dev-only behavior

## Debugging Workflow

1. **Identify the phase**: API ping, feed sync, or orchestrator/UI
2. **Find the last success marker** in logs
3. **Check Bookeo API responses** (status codes and error bodies)
4. **Review** `mcp_server/providers/bookeo.ts` and `supabase/functions/sync-bookeo`

## Related Documentation

- [Orchestrator Card Flow](./ORCHESTRATOR_CARD_FLOW.md)
- [Provider registry (edge)](../supabase/functions/_shared/providerRegistry.ts)
