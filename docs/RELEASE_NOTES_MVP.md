# SignupAssist MVP Release Notes

## What Shipped

- Parent-controlled web Activity Finder for child-safe youth activities.
- Secure Activity Finder to Autopilot handoff through server-side `signup_intent_id`.
- Supervised Autopilot setup wizard for activity, provider, child/profile, timing, safety limits, provider learning, and review/create.
- Dashboard/status/audit surfaces with provider readiness, reminder honesty, and redacted audit summaries.
- Provider learning foundation using existing playbooks, fixture posture, redacted observations, and readiness policy.
- Sensitive-action gate foundation for registration, payment, provider login, waivers, final submit, and future delegated signup.
- Security regression suite for URL safety, IDOR/BOLA, prompt injection, PII redaction, route-query hygiene, and ChatGPT approval surface pinning.
- Production web hardening that hides legacy test harness routes by default and keeps MCP bearer tokens out of the frontend bundle.
- ChatGPT app approval package hardened with parent/guardian, child-safe, OAuth, Stripe-hosted setup, final confirmation, and Bookeo/API-connected flow positioning.

## Intentionally Paused

- Unattended set-and-forget signup across arbitrary providers.
- Live third-party provider browser automation without official API access or written provider/camp permission.
- Automated payment, waiver acceptance, provider login, and final submit unless deterministic confirmation/mandate gates cover the exact action.
- Client-side direct creation or consumption of sensitive action confirmations and trusted delegated mandates.
- Provider-learning persistence from the browser into `discovery_runs`; redacted observations are available on supervised run packets for future server-mediated ingestion.
- Legacy chat/test harness routes unless `VITE_ENABLE_TEST_ROUTES=true` is explicitly enabled for dev/test.

## Web App Only

- `/activity-finder`
- `/autopilot`
- `/dashboard`
- `/discovery-runs`
- `/mandates`
- `/privacy`
- `/terms`
- `/safety`

These web/admin routes are not exposed as public ChatGPT MCP tools.

## ChatGPT App Approval Flow

- Public MCP tools remain exactly `search_activities` and `register_for_activity`.
- `search_activities` is read-only browsing for configured youth activity catalogs.
- `register_for_activity` is OAuth-gated and can guide a connected Bookeo/API signup flow.
- Supported Bookeo booking occurs only after required details, Stripe-hosted payment setup when needed, final review, explicit `book now`, and ChatGPT's confirmation card.
- Full unattended delegation is future-only and must not be described as live.

## Required Environment

Use `scripts/envRegistry.ts` and `npm run env:list` as the detailed source of truth.

Critical production categories:

- Supabase URL, anon/publishable key, and service role key.
- Auth0 domain, client ID, client secret, and audience.
- Bookeo API credentials for connected provider flow.
- Stripe secret/webhook/price configuration where billing or hosted setup is enabled.
- MCP/public site URLs and production CORS allowlist.
- Mandate signing and PII encryption keys where mandate/audit flows are enabled.
- MCP access tokens only in backend/server/worker/smoke-test environments, never as production `VITE_*` frontend variables.

## Migration Steps

Apply Supabase migrations through the latest sensitive-action lockdown migration:

- `20260417140000_add_sensitive_action_gates.sql`
- `20260419170000_lock_sensitive_action_gates.sql`
- `20260419183000_lock_provider_learning_and_audit_events.sql`

Verify RLS and service-role write paths before enabling production web flows.

## Smoke Tests

Run before release:

```bash
npm run typecheck
npx tsc -p tsconfig.app.json --noEmit
npm run build
npm run test:security-mvp
npm run test:golden-path
npm run test:authz-audit
npm run test:chatgpt-app
npm run test:approval-snapshots
npm run test:mcp-manifest
npm run test:mcp-descriptors
npm run infra:check
git diff --check
```

When production credentials are available, also run Railway, Supabase, Stripe, and SSE smokes from `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`.

## Rollback

1. Roll back the Railway web service to the last healthy deployment.
2. Pause the scheduled worker if any worker behavior could affect real registrations.
3. Verify `/health`, `/status`, and `/identity`.
4. Re-run ChatGPT guardrails and the web golden-path contract tests.
5. If schema behavior is the issue, prefer a forward migration; do not run destructive rollback without review.

## Known Limitations

- Browser screenshot evidence is still a release evidence task after deploy.
- Broad lint may expose older unrelated debt.
- Broad test should be attempted and classified honestly if it fails.
- Provider readiness is not provider permission; live delegated automation requires API or written permission plus future mandate checks.
