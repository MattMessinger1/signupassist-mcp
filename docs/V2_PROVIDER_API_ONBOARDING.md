# V2: Adding new providers (API-first) — onboarding notes

These notes capture the intended “API-first, no-scraping” path to expand SignupAssist beyond the first provider.

## Design goals

- **Config-driven**: Adding a provider should be primarily configuration + a provider adapter, not changes to the core orchestrator logic.
- **API-first**: No scraping. All program discovery and registration should go through provider APIs (or provider-controlled feeds) and be cached.
- **Cache-backed discovery**: ChatGPT flows should rely on Supabase caches for fast “what’s available” lookups and for activation gating.
- **Consistent tool contract**: Providers should expose a consistent set of tools and response shapes.

## 1) Add an organization entry

File: `mcp_server/config/organizations.ts`

Add an `OrgConfig` entry with:
- `orgRef`: stable slug (used as primary key across caches)
- `displayName`: human readable name
- `provider`: provider id (e.g. `bookeo`, `…`)
- `activityTypes`: normalized activity tags (see `mcp_server/utils/activityMatcher.ts`)
- `location`: city/state (or future: multi-location/service radius)

Notes:
- Prefer **one orgRef per provider account**. If a provider has multiple locations/accounts, model them as multiple orgRefs.

## 2) Implement provider tools (adapter)

File pattern: `mcp_server/providers/<provider>.ts`

Minimum required read path:
- `<provider>.find_programs` (read-only)
  - Inputs should include at least `org_ref` and an optional `category`/`query`.
  - Output should include both:
    - `structuredContent` with a `program_list` payload, and
    - `content[]` with a concise plain-text summary (for chat-only surfaces).

Registration path (consequential, OAuth required):
- `<provider>.discover_required_fields` (read-only)
- `<provider>.prepare_registration` / `<provider>.confirm_booking` (write)

Notes:
- Keep provider-specific API quirks inside the provider adapter.
- Preserve the “Step N/5” wizard UX at the `signupassist.chat` boundary (not inside provider tools).

## 3) Cache ingestion (Supabase)

Tables (current patterns):
- `cached_provider_feed` (legacy, row-per-program)
- `cached_programs` (enhanced, grouped-by-theme + expiry metadata)

Ingestion requirements:
- Sync programs on a schedule (Supabase edge function, cron, or provider webhook).
- Store enough fields for filtering:
  - title/description
  - age range (or text to parse)
  - category/theme
  - booking status + next available
  - provider + org_ref

Operational notes:
- Use `expires_at` for cache freshness (activation gating should treat expired cache as “no match”).
- Ensure “read-only discovery” never calls provider APIs directly in hot path; it should hit caches.

## 4) Routing + provider selection (orchestrator)

Existing building blocks:
- Activity normalization/matching: `mcp_server/utils/activityMatcher.ts`
- City parsing/coverage: `mcp_server/utils/cityLookup.ts` + `mcp_server/config/serviceAreas.ts`
- Multi-backend selection logic: `mcp_server/ai/orchestratorMultiBackend.ts`

V2 behavior target:
- Given (activity, location), find candidate orgs/providers.
- If multiple orgs match, ask the user to choose (one question at a time).
- Only proceed to signup once:
  - provider/org is selected
  - program match exists in cache

## 5) Testing and rollout

- Add/extend smoke scripts to cover:
  - discovery returns at least one program for a seeded org_ref
  - required fields discovery for one representative program
  - OAuth-gated writes remain protected
- Roll out providers incrementally:
  - add org config
  - add cache ingestion
  - enable provider selection for the new org(s)
  - verify ChatGPT flow end-to-end


