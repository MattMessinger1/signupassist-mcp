# Approval Impact Log

## 2026-04-17

Date: 2026-04-17

Summary: No production code changed yet

## 2026-04-20 - DaySmart / Keva Helper Alpha Fixture Pass

Files changed in this phase:

- `chrome-helper/fixtures/daysmart.html`
- `chrome-helper/README.md`
- `docs/PROVIDER_LEARNING_PRD.md`
- `tests/daysmart-provider-slice.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Production code changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.

Implementation summary:

- Expanded the DaySmart/Keva alpha fixture page with safe navigation and visible price-cap coverage.
- Kept the helper documentation firmly fixture-only for DaySmart and other providers.
- Added test assertions for login pause, participant fill, safe navigation, payment/waiver/final pause, sold-out, and price-cap coverage.

Verification status:

- `npx vitest run tests/daysmart-provider-slice.test.ts tests/provider-learning.test.ts tests/autopilot-classifier.test.ts --reporter=verbose`: Passed.
- `git diff --check`: Passed.
- No approval-surface changes were made.

## Known Approval-Sensitive Files

- `mcp/manifest.json`
- `mcp/openapi.json`
- `public/.well-known/*`
- `public/logo-512.*`
- `mcp_server/index.ts`
- `mcp_server/middleware/auth0.ts`
- `mcp_server/config/protectedActions.ts`
- `mcp_server/providers/*`
- `mcp_server/ai/APIOrchestrator.ts`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/SAFETY_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- MCP smoke scripts

## Known Public MCP Tool Surface

The public ChatGPT MCP surface is intentionally small:

- `search_activities`
- `register_for_activity`

## Known Hidden/Private/Internal Tool Posture

Lower-level provider, payment, mandate, scheduler, user/profile, registration management, registry, and diagnostic tools are registered internally but hidden/private by default. They must not be exposed in public ChatGPT `ListTools` responses, public descriptors, manifests, reviewer prompts, or production approval flows without explicit approval.

## Ongoing Rules

- Every later phase must append whether approval-sensitive files changed.
- Every later phase must state whether public MCP tool names, schemas, or descriptors changed.
- Every later phase must state whether hidden/private tools were exposed.
- Every later phase must state whether MCP manifest, OpenAPI, `.well-known`, OAuth/auth, CSP, protected actions, or review docs changed.
- Every later phase must include compatibility test results or a clear blocker.

## Current Phase Entry

- Phase: Docs-only MVP readiness pass.
- Approval-sensitive files changed: No.
- Production code changed: No.
- Public MCP tool names/schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest/OpenAPI/`.well-known`/OAuth/CSP/protected actions changed: No.
- Tests run: Not applicable for docs-only pass; verify with `git status` and `git diff --name-only`.

## 2026-04-17 - ChatGPT App Compatibility Guardrails And Snapshots

Files changed in this phase:

- `package.json`
- `scripts/chatgptAppGuardrails.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Approval guardrail docs/scripts/snapshots added: Yes.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Production behavior changed: No.

Compatibility checks added:

- `npm run test:chatgpt-app`
- `npm run test:mcp-manifest`
- `npm run test:mcp-descriptors`
- `npm run test:approval-snapshots`

Snapshot coverage:

- MCP manifest required fields, production URLs, and manifest-referenced resources/routes.
- OpenAPI public route contract and public operation IDs.
- Public MCP tool descriptors, input schema hashes, annotation posture, safety metadata, and structured content indicators.
- Approval-sensitive file inventory and SHA-256 hashes.
- Auth/protected-action compatibility markers for auth-required and destructive/write paths.

Verification results:

- `npm run test:chatgpt-app`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run typecheck`: Passed.
- `npx eslint scripts/chatgptAppGuardrails.ts --max-warnings=0`: Passed.
- `npm run lint`: Failed on pre-existing unrelated repo lint issues outside this phase's files.
- `npm run test`: Failed on `tests/telemetryDebugAccess.integration.test.ts`; no files touched by this phase affect telemetry debug endpoint behavior.

## 2026-04-17 - Read-Only Implementation Audit With Subagents

Files changed in this phase:

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Production code changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.

Read-only audit coverage:

- Subagent A: ChatGPT app approval surface.
- Subagent B: web app Activity Finder -> Autopilot flow.
- Subagent C: backend/API/auth and activity finder route.
- Subagent D: Supabase data/RLS.
- Subagent E: provider learning.
- Subagent F: security/payment/sensitive actions.
- Subagent G: production/release.

Consolidated blockers and risks:

- No hard public MCP approval blocker found; public tools remain `search_activities` and `register_for_activity`.
- Reviewer-facing docs have drift: `docs/CHATGPT_SUBMISSION_CHECKLIST.md` labels `register_for_activity` as read-only/open-world while live descriptors treat it as consequential/write.
- `/orchestrator/chat` in `mcp/openapi.json` is still marked `x-openai-isConsequential: false`; changing it would require explicit approval, snapshot updates, and reviewer-doc updates.
- Backend execution/payment paths need server-verified parent confirmation before unsafe actions: `run-plan`, `mcp-executor`, Stripe charge functions, and schedule-from-readiness are the key surfaces.
- Activity Finder -> Autopilot handoff has query-param/return-url risks and should preserve provider context.
- Discovery/admin surfaces need auth/ownership cues before exposing user-linked runs.
- Provider learning foundation exists, but provider registries are fragmented and confidence/merge logic is still stubbed.
- Railway web health is ready; worker health depends on `PORT`; deployment docs need root `package.json` vs `package.production.json` clarification.

Read-only verification:

- Subagent G reported `npm run test:chatgpt-app` passed during production/release audit.
- No production tests were run by the main agent in this phase because the requested work was read-only audit plus docs consolidation.

## 2026-04-17 - Web Signup Intent Bridge

Files changed in this phase:

- `mcp_server/index.ts`
- `mcp_server/lib/signupIntent.ts`
- `mcp_server/lib/signupIntentApi.ts`
- `src/lib/signupIntent.ts`
- `src/lib/activityFinder.ts`
- `src/lib/subscription.ts`
- `src/pages/ActivityFinder.tsx`
- `src/pages/Autopilot.tsx`
- `src/integrations/supabase/types.ts`
- `supabase/migrations/20260417110000_add_signup_intents.sql`
- `tests/signup-intent-frontend.test.ts`
- `tests/signup-intent-service.test.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Approval-sensitive runtime files changed: Yes, `mcp_server/index.ts` only, to route web-only `/api/signup-intents` requests through the existing server.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Approval snapshot updated: Yes, to capture the reviewed `mcp_server/index.ts` hash after the web-only route addition.

Implementation summary:

- Added server-owned `signup_intents` and `signup_intent_events` tables with RLS and owner-scoped policies.
- Added authenticated web API routes for `POST /api/signup-intents`, `GET /api/signup-intents/:id`, and `PATCH /api/signup-intents/:id`.
- Backend derives `user_id` from the Supabase JWT and strips/ignores client-sent `userId`.
- Activity Finder now creates a server-side signup intent and navigates only to `/autopilot?intent=<id>`.
- Autopilot now loads the intent by ID, preserves manual setup fallback, and links created runs back to the intent when practical.
- Audit events redact unsafe URL/query detail and summarize selected result metadata.

Verification results:

- `npm run lint`: Failed on pre-existing unrelated repo lint issues; targeted lint on files changed in this phase passed.
- `npx eslint mcp_server/lib/signupIntent.ts mcp_server/lib/signupIntentApi.ts src/lib/activityFinder.ts src/lib/signupIntent.ts src/lib/subscription.ts src/pages/ActivityFinder.tsx src/pages/Autopilot.tsx tests/signup-intent-service.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `npm run test`: Failed on pre-existing `tests/telemetryDebugAccess.integration.test.ts` debug endpoint assertion; signup intent tests passed.
- `npx vitest run tests/signup-intent-service.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx vitest run tests/subscription-status.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:authz-audit`: Passed.

## 2026-04-17 - Signup Intent Bridge Review And Hardening

Files changed in this phase:

- `mcp_server/lib/signupIntentApi.ts`
- `tests/signup-intent-api.test.ts`
- `tests/signup-intent-frontend.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- `/api/signup-intents` remains a web-only HTTP bridge and is not listed in MCP manifest/OpenAPI public operations.

Review/hardening summary:

- Added explicit CORS preflight handling for `/api/signup-intents` so browser `OPTIONS` requests do not require auth or write data.
- Added API boundary tests for unauthenticated create/read/patch, spoofed `userId`, cross-user read/patch isolation, and preflight behavior.
- Added frontend/approval-surface coverage confirming Autopilot navigation carries only `intent=<id>` and the bridge is absent from MCP public surfaces.

Verification results:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:authz-audit`: Passed.
- `npx vitest run tests/signup-intent-api.test.ts tests/signup-intent-service.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint mcp_server/lib/signupIntent.ts mcp_server/lib/signupIntentApi.ts src/lib/activityFinder.ts src/lib/signupIntent.ts src/lib/subscription.ts src/pages/ActivityFinder.tsx src/pages/Autopilot.tsx tests/signup-intent-api.test.ts tests/signup-intent-service.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - ChatGPT Stripe Checkout Setup Reviewer Flow Fix

Files changed in this phase:

- `mcp_server/lib/stripeCheckout.ts`
- `mcp_server/providers/stripe.ts`
- `mcp_server/index.ts`
- `tests/stripe-checkout-url.test.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/index.ts` and `mcp_server/providers/stripe.ts` changed to fix the existing Stripe-hosted payment setup/return path for the current `register_for_activity` reviewer flow.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Reviewer-flow remediation:

- Replaced the Stripe setup and return finalization dependency on Supabase Edge Function calls from the MCP server with server-side Stripe SDK calls in the existing MCP server process.
- Preserved Stripe-hosted Checkout for card entry; SignupAssist still does not collect or store raw card numbers.
- Preserved the ChatGPT flow: generate Stripe Checkout link, user completes setup on Stripe, `/stripe_return` finalizes `user_billing`, then user returns to ChatGPT and types `done`.
- Added a short first-party `/stripe_checkout?session_id=...` redirect so ChatGPT reviewers see a clean SignupAssist link in chat while the actual card-entry page remains Stripe-hosted.
- Added redirect URL validation coverage for Stripe return URLs, including rejection of unsafe protocols.

Verification results for this phase:

- `npx vitest run tests/stripe-checkout-url.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional approval snapshot updates for `mcp_server/index.ts` and `mcp_server/providers/stripe.ts`.
- `npm run test:chatgpt-app`: Passed.
- `npx eslint tests/stripe-checkout-url.test.ts mcp_server/lib/stripeCheckout.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - ChatGPT Reviewer Payment Retry Polish

Files changed in this phase:

- `mcp_server/ai/APIOrchestrator.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/ai/APIOrchestrator.ts` changed to prevent stale Stripe Checkout links from being re-sent during reviewer/payment retry flows.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Reviewer-flow remediation:

- `change card` now creates a fresh Stripe Checkout setup session instead of re-sending an expired, declined, or environment-stale link.
- `clear_context`/start-over behavior now clears payment state and saved Stripe Checkout link/session metadata.
- Railway `STRIPE_SECRET_KEY` was updated outside git to test mode for reviewer-safe Stripe-hosted setup with test card `4242`; no secret value was committed or printed intentionally.

Verification results for this phase:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx vitest run tests/register-activity-step2-parser.test.ts tests/stripe-checkout-url.test.ts --reporter=verbose`: Passed.
- `npx eslint tests/register-activity-step2-parser.test.ts tests/stripe-checkout-url.test.ts mcp_server/lib/stripeCheckout.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional approval snapshot update for `mcp_server/ai/APIOrchestrator.ts`.
- `npm run test:chatgpt-app`: Passed.

Known pre-existing blockers:

- Targeted lint including `mcp_server/index.ts` failed on existing broad `@typescript-eslint/no-explicit-any` debt in that file: `172 problems (172 errors, 0 warnings)`, for example `/Users/mattmessinger/Desktop/signupassist-mcp/mcp_server/index.ts:71:52 Unexpected any. Specify a different type`.
- Broad `npm run lint` remains classified as pre-existing from the prior phase.
- Broad `npm run test` remains classified as pre-existing from the prior phase due to `tests/telemetryDebugAccess.integration.test.ts` debug endpoint assertion.

## 2026-04-17 - Modern Activity Finder UX

Files changed in this phase:

- `src/pages/ActivityFinder.tsx`
- `tests/activity-finder-ui.test.ts`
- `tests/signup-intent-frontend.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Signup intent backend/API bridge changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.

UX summary:

- Reworked `/activity-finder` into a responsive web-app page with page header, hero search card, example chips, structured fields, results area, trust strip, and desktop readiness side panel.
- Structured fields compose the existing natural-language query, so the existing Activity Finder endpoint contract remains unchanged.
- Result cards now show richer match metadata, status-specific CTAs, missing-detail guidance, and signup-link confirmation for `needs_signup_link`.
- Continue still creates a server-side signup intent and navigates only through `/autopilot?intent=<id>`.
- Copy remains future-gated: full set-and-forget is not represented as live.

Verification results:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npx vitest run tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint src/pages/ActivityFinder.tsx tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-17 - Supervised Autopilot Wizard And Set-And-Forget Foundation

Files changed in this phase:

- `src/pages/Autopilot.tsx`
- `tests/autopilot-wizard-ui.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Signup intent backend/API bridge changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.

Wizard summary:

- Refactored `/autopilot` into a seven-step supervised setup wizard: Activity, Provider, Child/Profile, Timing and reminder, Safety limits, Provider learning, and Review and create.
- `/autopilot?intent=<id>` continues to load the server-side signup intent from the web API and keeps original finder detail in page state/body, not route query params.
- Manual `/autopilot` setup remains available with the existing Keva DaySmart starter.
- Creating a supervised run packet continues to enforce membership checks, writes finder/provider metadata into `autopilot_runs.caps`, updates the linked signup intent to `scheduled`, and stores `autopilot_run_id` when practical.
- Parent approval gates are visible and state that SignupAssist pauses for login, payment, waivers, medical questions, provider uncertainty, price changes, and final submit.

Provider learning hooks:

- Provider readiness is surfaced as `verified`, `beta`, or `generic`.
- Run metadata records redacted provider learning posture, signup intent linkage, and the set-and-forget ladder.
- Parent opt-in to redacted learning signals is available.
- Child PII, credentials, tokens, payment data, and medical/allergy details are explicitly excluded from learning by default.
- Full set-and-forget remains represented as a future verified-provider and signed-mandate mode, not live today.

Verification results:

- `npx eslint src/pages/Autopilot.tsx tests/autopilot-wizard-ui.test.ts --max-warnings=0`: Passed.
- `npx vitest run tests/autopilot-wizard-ui.test.ts tests/autopilot-run-packet.test.ts --reporter=verbose`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run typecheck`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npx vitest run tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint src/pages/ActivityFinder.tsx src/pages/Autopilot.tsx tests/activity-finder-ui.test.ts tests/autopilot-wizard-ui.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.
- Local Vite route smoke at `http://127.0.0.1:8082/autopilot?intent=<id>`: Passed with HTTP 200.

## 2026-04-17 - Provider Learning Foundation

Files changed in this phase:

- `src/lib/providerLearning.ts`
- `src/pages/Autopilot.tsx`
- `src/pages/DiscoveryRuns.tsx`
- `tests/provider-learning.test.ts`
- `tests/autopilot-wizard-ui.test.ts`
- `docs/PROVIDER_LEARNING_PRD.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Provider learning remains web/backend/admin only.

Existing infrastructure reused:

- Existing provider playbooks are the application-level provider registry source.
- Existing `chrome-helper/fixtures/*` paths provide fixture coverage mapping.
- Existing `autopilot_runs.caps.provider_learning` carries supervised-run learning posture.
- Existing `discovery_runs`, `discovery_hints`, `program_fingerprints`, and `upsert_discovery_run` remain the persistence path for redacted observations once wiring is approved.
- Existing `/discovery-runs` admin surface displays provider readiness and latest redacted discovery observations.

New infrastructure added:

- No new database tables or migrations.
- Added `src/lib/providerLearning.ts` for provider registry mapping, readiness summaries, fixture coverage, redacted observation creation, and discovery-run payload adaptation.
- Added targeted provider readiness and redaction tests.

Seeded/mapped providers:

- `active`
- `daysmart`
- `amilia`
- `civicrec-recdesk`
- `campminder`
- `generic`

Security and promotion posture:

- Provider readiness is conservative: verified playbooks with fixtures map to `navigation_verified`; generic maps to `recognized`; unknown providers map to `unknown`.
- Readiness promotion is not automatic.
- Model output and provider page content cannot promote readiness.
- Promotion requires fixtures, provider-specific tests, and admin review.
- Redacted observations exclude child PII, credentials, tokens, payment data, raw provider page content, and medical/allergy notes.

Verification results:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npx vitest run tests/provider-learning.test.ts tests/autopilot-wizard-ui.test.ts tests/autopilot-run-packet.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint src/lib/providerLearning.ts src/pages/DiscoveryRuns.tsx src/pages/Autopilot.tsx tests/provider-learning.test.ts tests/autopilot-wizard-ui.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-17 - Dashboard Status Audit Reminder And Readiness Polish

Files changed in this phase:

- `src/pages/RegistrationDashboard.tsx`
- `src/lib/dashboardStatus.ts`
- `tests/dashboard-status.test.ts`
- `docs/SHIP_CHECKLIST.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive runtime files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.

Dashboard/status summary:

- `/dashboard` now groups supervised runs into Ready to prepare, Registration opening soon, Scheduled/ready runs, Paused for parent approval, Provider learning/readiness, Completed signups, and Failed/manual fallback runs.
- Run cards show activity/program, provider, provider readiness level, child or choose-during-run, registration opening time, status, readiness score, price cap, last redacted audit event, reminder state, and parent CTAs.
- Reminder copy is honest: reminders are prepared, manual reminders are recommended where automation is not fully implemented, and SMS remains disabled unless configured.
- Provider readiness copy clarifies verified, beta/fill-safe, generic, and future delegated signup posture.
- Dashboard footer links privacy, terms, and safety/security endpoints and repeats parent-controlled privacy copy.

Audit/redaction summary:

- Visible audit summaries are human-readable event labels only; raw event details are not displayed.
- Audit helper redacts child DOB/date strings, phone numbers, addresses, medical/allergy notes, credentials, tokens, and payment data.

Verification results:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npx vitest run tests/dashboard-status.test.ts tests/activity-finder-ui.test.ts tests/autopilot-wizard-ui.test.ts tests/provider-learning.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint src/pages/RegistrationDashboard.tsx src/pages/DiscoveryRuns.tsx src/pages/Autopilot.tsx src/lib/dashboardStatus.ts src/lib/providerLearning.ts tests/dashboard-status.test.ts tests/provider-learning.test.ts tests/autopilot-wizard-ui.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-17 - Sensitive Action Gates And Delegation Mandate Foundation

Files changed in this phase:

- `src/lib/sensitiveActionGates.ts`
- `src/lib/registrationFlow.ts`
- `src/integrations/supabase/types.ts`
- `supabase/migrations/20260417140000_add_sensitive_action_gates.sql`
- `supabase/functions/run-plan/index.ts`
- `supabase/functions/mcp-executor/index.ts`
- `supabase/functions/stripe-charge-success/index.ts`
- `supabase/functions/stripe-charge-success-fee/index.ts`
- `mcp_server/worker/scheduledRegistrationWorker.ts`
- `tests/sensitive-action-gates.test.ts`
- `tests/sensitive-action-contract.test.ts`
- `docs/SHIP_PRD.md`
- `docs/PROVIDER_LEARNING_PRD.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Security behavior changes:

- Added `parent_action_confirmations` for one-time parent confirmation of registration, payment, provider login, waiver acceptance, final submit, and future delegation.
- Added `agent_delegation_mandates` as a future-only signed mandate foundation for exact provider/program/child/price/action constraints.
- Added deterministic gate helper for sensitive actions, provider readiness, exact match, price cap, idempotency, and audit redaction checks.
- Refactored client registration flow so payment no longer follows registration automatically.
- `run-plan` now requires authenticated user context plus parent confirmation or valid future mandate before sensitive actions, and it pauses instead of executing unsupported unsafe writes.
- Stripe success-fee edge functions now fail closed with `payment_review_required`; automated payment is disabled until verified payment gates are proven safe.
- Scheduled registration worker now pauses before provider submit/payment rather than calling provider submit or charging fees.
- Model output and provider page content are explicitly rejected as authorization sources.

Verification status for this phase:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:authz-audit`: Passed.
- `npx vitest run tests/sensitive-action-gates.test.ts tests/sensitive-action-contract.test.ts --reporter=verbose`: Passed.
- `npx eslint src/lib/registrationFlow.ts src/lib/sensitiveActionGates.ts src/integrations/supabase/types.ts tests/sensitive-action-gates.test.ts tests/sensitive-action-contract.test.ts supabase/functions/run-plan/index.ts supabase/functions/mcp-executor/index.ts supabase/functions/stripe-charge-success/index.ts supabase/functions/stripe-charge-success-fee/index.ts --max-warnings=0`: Passed.
- `npx eslint mcp_server/worker/scheduledRegistrationWorker.ts --max-warnings=0`: Failed on pre-existing `no-explicit-any` issues and stale `eslint-disable` comments in the worker file; not introduced by this phase.
- `git diff --check`: Passed.

## 2026-04-17 - Security Privacy Regression Suite And URL Safety

Files changed in this phase:

- `mcp_server/lib/targetUrlSafety.ts`
- `mcp_server/lib/httpSecurity.ts`
- `mcp_server/lib/signupIntent.ts`
- `mcp_server/lib/signupIntentApi.ts`
- `tests/security-mvp.test.ts`
- `tests/signup-intent-service.test.ts`
- `tests/fixtures/security/provider-prompt-injection.html`
- `package.json`
- `docs/SHIP_CHECKLIST.md`
- `docs/CHATGPT_APP_APPROVAL_GUARDRAILS.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Security/privacy additions:

- Added shared server-side target URL validator for web/server code.
- URL validator rejects missing/invalid URLs, non-HTTP(S) protocols, userinfo URLs, localhost, private IPv4 ranges, IPv6 loopback/link-local/ULA ranges, metadata IPs, internal hostnames, and unsafe redirect chains.
- Added resolved-IP validation helper for any future server-side fetch path.
- Signup intent create/patch validation now uses the shared target URL validator.
- Signup intent audit events continue to store only target URL host, not query strings.
- Added web-only API CORS/security header helper and signup-intent API rate limiting when rate limiting is enabled.
- Added prompt-injection fixture covering "ignore previous instructions", fake payment approval, final submit, waiver acceptance, child-data exfiltration, price-cap changes, hidden URL usage, and provider readiness promotion.
- Added `test:security-mvp` script for URL safety, IDOR/BOLA, PII redaction, prompt-injection, route-query, provider-learning, sensitive-action, and ChatGPT public-surface regression checks.

Remaining limitations:

- Activity Finder route still lives inline in `mcp_server/index.ts`; this phase verified the existing global security headers and kept the approval-sensitive server entrypoint unchanged.
- The resolved-IP validator is available for future server-side fetches, but the MVP does not fetch unknown provider target URLs server-side.
- Broad lint still has known pre-existing failures outside this phase.

Verification results:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:authz-audit`: Passed.
- `npm run test:security-mvp`: Passed.
- `npx eslint mcp_server/lib/targetUrlSafety.ts mcp_server/lib/httpSecurity.ts mcp_server/lib/signupIntent.ts mcp_server/lib/signupIntentApi.ts tests/security-mvp.test.ts tests/signup-intent-service.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-17 - ChatGPT Submission Completeness Remediation

Files changed in this phase:

- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, review/submission docs only.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Submission remediation:

- Removed placeholder submission wording from the review package.
- Replaced stale Railway submission URLs with the valid public Shipworx URLs:
  - Website: `https://shipworx.ai`
  - Privacy: `https://signupassist.shipworx.ai/privacy`
  - Terms: `https://signupassist.shipworx.ai/terms`
  - MCP server: `https://signupassist.shipworx.ai/sse`
  - Safety/security: `https://signupassist.shipworx.ai/safety`
- Clarified that the live ChatGPT app can complete the connected AIM Design / Bookeo signup flow after OAuth, Stripe-hosted payment method setup when required, final review, and explicit `book now` confirmation.
- Clarified that unattended set-and-forget delegation across arbitrary providers is not live.
- Clarified that reviewer credentials belong in the OpenAI Platform submission form and must not be committed to git.

Verification results for this phase:

- `npm run test:chatgpt-app`: Failed because `approval-snapshots` detected intentional review/submission doc changes.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Failed because approval-sensitive review/submission docs changed and the snapshot was not updated in this docs-only remediation.
- `git diff --check`: Passed.
- Review package URL cleanup check: Passed after removing stale Railway URLs and placeholder wording from the submission docs.

## 2026-04-18 - Final ChatGPT Review Package And Legal Policy Remediation

Files changed in this phase:

- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/PRIVACY_POLICY.md`
- `docs/TERMS_OF_USE.md`
- `docs/SAFETY_POLICY.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, review/submission docs and policy docs only.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Submission remediation:

- Canonical OpenAI submission URLs now use the SignupAssist-hosted legal pages:
  - Website: `https://shipworx.ai`
  - Privacy: `https://signupassist.shipworx.ai/privacy`
  - Terms: `https://signupassist.shipworx.ai/terms`
  - MCP server: `https://signupassist.shipworx.ai/sse`
  - Safety/security: `https://signupassist.shipworx.ai/safety`
- Reviewer test cases now match the live app posture:
  - AIM Design browsing uses `search_activities`.
  - Age-filtered AIM Design robotics browsing uses `search_activities`.
  - Signup and connected Bookeo booking use `register_for_activity`.
  - Adult-only wine tasting is an explicit app-safety test, not a negative no-trigger test.
  - Negative no-trigger tests are unrelated recipe, laptop shopping, and Agile/Scrum prompts.
- Legal policy docs now disclose ChatGPT/OpenAI processing, Auth0, Bookeo/API-connected providers, Stripe-hosted payment setup, Supabase, Railway, audit logs, confirmations, deletion/support requests, no raw card storage, no PHI/medical/allergy fields, no provider passwords, and that unattended delegation is not live.
- Reviewer data guidance now asks for synthetic data, preferably a synthetic participant age 13 or older when the selected program supports it.

Verification results for this phase:

- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional approval snapshot update for review/policy doc hashes.
- `npm run test:chatgpt-app`: Passed.
- `npx vitest run tests/orchestratorBoundaryOutOfScope.test.ts tests/orchestratorChat.outOfScope.integration.test.ts tests/publicSpecSafety.test.ts tests/childScopeGuardrail.test.ts --reporter=verbose`: Passed.
- `MCP_SERVER_URL=https://signupassist.shipworx.ai MCP_ALLOW_UNAUTH_READONLY_TOOLS=true npx tsx scripts/smokeMcpSse.ts`: Passed unauthenticated OAuth metadata, `/sse` auth gate, unauthenticated `search_activities`, and unauthenticated `register_for_activity` OAuth-required checks. Authenticated POST `/sse` and SSE connect checks were skipped because no `MCP_ACCESS_TOKEN` was available in the local environment.
- Production raw prompt smoke:
  - `search_activities` for "Use SignupAssist to show me programs at AIM Design.": Passed; returned AIM Design Bookeo catalog programs and no write action.
  - `search_activities` for "Use SignupAssist to find robotics classes for my 9 year old at AIM Design.": Passed; returned the robotics match for age 9 and no write action.
  - Unauthenticated `register_for_activity` for "Use SignupAssist to sign my child up for a class at AIM Design.": Passed OAuth gate; returned 401 with `WWW-Authenticate`.
- Production URL checks:
  - `https://shipworx.ai`: 200.
  - `https://signupassist.shipworx.ai/privacy`: 200.
  - `https://signupassist.shipworx.ai/terms`: 200.
  - `https://signupassist.shipworx.ai/safety`: 200.
  - `https://signupassist.shipworx.ai/mcp/manifest.json`: 200.
  - `https://signupassist.shipworx.ai/.well-known/chatgpt-apps-manifest.json`: 200.
- `git diff --check`: Passed.

Reviewer-readiness caveats:

- Deployed `https://signupassist.shipworx.ai/privacy`, `/terms`, and `/safety` are reachable but still serve the older deployed policy text until the current docs are deployed.
- `https://shipworx.ai/privacy` and `https://shipworx.ai/terms` should not be used for the OpenAI resubmission because the Shipworx SPA shell still contains stale "set it and forget it" marketing metadata.
- Full signed-in ChatGPT web/mobile wizard testing, Stripe-hosted setup, and final Bookeo booking confirmation still require the reviewer/test account credentials and a valid MCP access token or an interactive ChatGPT login session.

## 2026-04-18 - ChatGPT Step 2 Reviewer Flow Parser Fix

Files changed in this phase:

- `mcp_server/ai/APIOrchestrator.ts`
- `tests/register-activity-step2-parser.test.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/ai/APIOrchestrator.ts` changed to fix Step 2 account-holder/participant free-text parsing for the existing `register_for_activity` flow.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Reviewer-flow remediation:

- Step 2 now accepts reviewer-style labels such as `Account holder First name: OpenAI`, `Account holder Last name: Reviewer`, `Participant: Review Child`, and `Participant DOB: 11/26/2014`.
- Step 2 now maps bare follow-ups like `First name: OpenAI` / `Last name: Reviewer` to the account holder when those account-holder fields are the missing fields.
- Step 2 now accepts natural-language follow-ups like `My first name is OpenAI and my last name is Reviewer`.
- Added regression coverage for the exact account-holder parsing shapes seen during the live ChatGPT reviewer test.
- Updated the approval snapshot only after confirming the diff was limited to the `mcp_server/ai/APIOrchestrator.ts` hash.

Verification results for this phase:

- `npx vitest run tests/register-activity-step2-parser.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npx eslint tests/register-activity-step2-parser.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - Stripe Setup Customer Recovery Fix

Files changed in this phase:

- `mcp_server/lib/stripeCheckout.ts`
- `mcp_server/providers/stripe.ts`
- `tests/stripe-checkout-customer.test.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/lib/stripeCheckout.ts` changed to fix Stripe-hosted payment setup for the existing `register_for_activity` reviewer flow.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Reviewer-flow remediation:

- Production reviewer testing found Step 3 failing with `Failed to start payment setup` because the reviewer user's stored `user_billing.stripe_customer_id` pointed to a customer that does not exist in the active Stripe account/mode.
- Stripe setup now validates the stored customer before creating Checkout. If Stripe returns `resource_missing` for the stored customer, SignupAssist creates or reuses a valid customer in the active Stripe account and clears stale saved-card metadata.
- Added regression coverage for stale customer recovery before creating a Stripe Checkout setup session, including Stripe's `param: id` missing-customer response shape.
- Production reviewer testing then confirmed Stripe-hosted setup, final review, and Bookeo booking succeeded. Logs also showed the old success-fee Edge Function path still failed with `UNAUTHORIZED_INVALID_JWT_FORMAT`, so `stripe.charge_success_fee` now charges the saved Stripe payment method directly from the MCP server using Stripe idempotency and records the result in `charges`.

Verification results for this phase:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx vitest run tests/stripe-checkout-url.test.ts tests/stripe-checkout-customer.test.ts --reporter=verbose`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Failed as expected after changing `mcp_server/providers/stripe.ts`; snapshot was updated intentionally.
- `npm run test:approval-snapshots`: Passed after intentional snapshot update.
- `npm run test:chatgpt-app`: Failed as expected for the same snapshot mismatch before snapshot update.
- `npm run test:chatgpt-app`: Passed after intentional snapshot update.
- `npx eslint mcp_server/providers/stripe.ts --max-warnings=0`: Failed on pre-existing `no-explicit-any` violations in this file.

Production reviewer verification:

- Deployed commit: `08ea4c6535b41465380ae43bdc5c115c3dec1dc0`.
- ChatGPT signed-in reviewer flow reached Step 3 and produced a test-mode Stripe Checkout link after stale-customer recovery: `cs_test_...`.
- Stripe-hosted Checkout accepted the 4242 test card and returned to `/stripe_return?payment_setup=success`.
- ChatGPT Step 4 showed the saved payment method and required explicit `book now` final confirmation.
- ChatGPT Step 5 created a Bookeo booking: `1567604181385814`.
- After the direct success-fee charge fix deployed, a fresh signed-in ChatGPT flow created another Bookeo booking: `1567604186680818`.
- Production logs confirmed the success-fee charge succeeded through `stripe.charge_success_fee` and recorded charge id `9c1c467b-7c2d-42ee-9dbc-ad4d9f1af8b3`.

Remaining non-blocking observations:

- `user.list_children` still logs a missing `children.first_name_encrypted` column and falls back to manual detail collection.
- `registrations.create` still logs a missing `provider_amount_due_cents` column and retries without provider-specific fields; the registration record is created successfully.

## 2026-04-18 - SignupAssist Website URL Readiness Polish

Files changed in this phase:

- `index.html`
- `mcp_server/index.ts`
- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/index.ts` changed only to make static frontend and SPA fallback routes return `200` to `HEAD` probes without serving a response body.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Submission metadata impact:

- Submission docs now use `https://signupassist.shipworx.ai/` as the Website URL so reviewers see SignupAssist-specific supervised-signup copy instead of broader Shipworx marketing metadata.
- The approval snapshot was updated after review; the only approval-sensitive hash changes are `mcp_server/index.ts` and `docs/CHATGPT_SUBMISSION_CHECKLIST.md`.
- Homepage metadata now states that supported signups happen only after review and explicit confirmation.

## 2026-04-18 - Parent/Guardian Child-Safe Language Hardening

Files changed in this phase:

- `index.html`
- `mcp/manifest.json`
- `public/.well-known/ai-plugin.json`
- `public/.well-known/chatgpt-apps-manifest.json`
- `mcp_server/index.ts`
- `mcp_server/ai/APIOrchestrator.ts`
- `mcp_server/ai/apiMessageTemplates.ts`
- `mcp_server/lib/childScopeGuardrail.ts`
- `src/components/MCPChat.tsx`
- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/PRIVACY_POLICY.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/SAFETY_POLICY.md`
- `docs/TERMS_OF_USE.md`
- `docs/USAGE_EXAMPLES.md`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, language-only changes in manifest files, tool descriptions, ChatGPT review docs, `mcp_server/index.ts`, and `mcp_server/ai/APIOrchestrator.ts`.
- Public MCP tool names changed: No.
- Public MCP schemas changed: No.
- Public MCP descriptors/annotations changed: Yes, descriptor descriptions changed to make the parent/guardian, child-safe youth activity, adult-only exclusion, and COPPA/privacy boundaries explicit.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: Yes, language-only clarification.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: Yes, language-only manifest clarification.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Submission metadata impact:

- Copy now consistently says SignupAssist is for adult parents/guardians managing child-safe youth activity signups.
- Copy now consistently says SignupAssist is not child-directed, not for adult-only services, and not for adult-only activity registration.
- COPPA posture is explicit: general age/grade can be used for search, but personal information about children under 13 must not be submitted in ChatGPT.
- Scheduled-registration copy now says supervised registration attempt instead of implying unattended set-and-forget autonomy.

## 2026-04-18 - Production Web App Runbook

Files changed in this phase:

- `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`
- `docs/MVP_TRYABLE_RUNBOOK.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No runtime approval-sensitive files changed; docs only.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Runbook impact:

- Added `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md` as the canonical production readiness and web golden-path runbook.
- Marked `docs/MVP_TRYABLE_RUNBOOK.md` as superseded because it referenced the old Railway URL and predated the Activity Finder -> Signup Intent -> Autopilot -> Dashboard flow.
- Captured the remaining work as prompt-sized implementation chunks: browser golden-path foundation, authenticated web golden path, redacted evidence helper, dashboard/provider-readiness verification, production readiness evidence, and final stabilization.
- Added production gates for env checks, Railway health, Supabase/Stripe smokes, ChatGPT compatibility checks, legal page verification, evidence capture, rollback, and launch blockers.

Verification results for this docs-only phase:

- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-21 - Supervised Autopilot Setup Simplification

Scope:

- Simplified the web Autopilot setup into first-run, repeat same-provider, and repeat different-provider modes.
- Updated the Chrome helper popup to support local multi-child profiles, provider-switch awareness, and helper-code URL normalization.
- Tightened helper content-script readiness so fill/safe-continue require a supported matching provider host.
- Extended Chrome helper evals to separate first-run and repeat-run measurements.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Helper codes are not persisted after successful packet redemption, and provider mismatch blocks fill/continue before Assist Mode can act.

Verification:

- Targeted tests, typecheck, app TypeScript, and security MVP checks run during this pass. Final full matrix recorded in the PR summary.

## 2026-04-19 - Web Ship UX And Audit Redaction Polish

Files changed in this phase:

- `mcp_server/lib/activityFinder.ts`
- `src/lib/activityFinder.ts`
- `src/lib/signupIntent.ts`
- `src/pages/Autopilot.tsx`
- `src/pages/MandatesAudit.tsx`
- `tests/autopilot-wizard-ui.test.ts`
- `tests/signup-intent-frontend.test.ts`
- `tests/mandates-audit-redaction.test.ts`
- `mcp_server/lib/activityFinder.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added confidence, freshness, age-fit, provider-readiness, and missing-detail metadata to Activity Finder results and preserved confidence/freshness into the server-side signup intent payload.
- Prevented duplicate supervised-run creation after Autopilot has already created a run packet; both the review card and sticky footer now send parents to the dashboard after success.
- Stopped Mandates Audit from fetching or rendering raw mandate JWS tokens.
- Removed visible credential identifiers and raw metadata from Mandates Audit; visible metadata now runs through recursive redaction before display.
- Hid Mandates Audit testing tools in production unless `VITE_ENABLE_AUDIT_TEST_TOOLS=true`.
- Left direct provider-learning persistence unwired because the existing `upsert_discovery_run` RPC is `SECURITY DEFINER`; client-side wiring would widen write risk. Redacted observations remain stored inside the supervised run packet for server-mediated ingestion later.

Verification results for this phase:

- `npx vitest run tests/mandates-audit-redaction.test.ts tests/autopilot-wizard-ui.test.ts tests/signup-intent-frontend.test.ts mcp_server/lib/activityFinder.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:chatgpt-app`: Passed.

## 2026-04-18 - Production Readiness Evidence Sweep

Files changed in this phase:

- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Verification results for this phase:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:authz-audit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npx vitest run tests/web-golden-path-foundation.test.ts tests/web-authenticated-golden-path.test.ts tests/release-evidence.test.ts tests/dashboard-provider-readiness.test.ts tests/activity-finder-ui.test.ts tests/autopilot-wizard-ui.test.ts tests/autopilot-run-packet.test.ts tests/dashboard-status.test.ts tests/provider-learning.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npm run infra:check`: Passed with warnings for missing local shell env values in Railway web, scheduled worker, and Supabase Edge Function groups.
- `npm run env:check`: Passed in advisory mode with local warnings for recommended env values. Local `.env` currently reports `VITE_MCP_BASE_URL` as the old Railway hostname; do not treat that as proof of production app submission metadata.
- `RAILWAY_MCP_URL=https://signupassist.shipworx.ai npm run infra:smoke:railway`: Passed for `/health` and OAuth metadata. Worker health was skipped because no worker health URL was provided.
- Public GET checks returned 200 for `https://signupassist.shipworx.ai/`, `/health`, `/status`, `/identity`, `/privacy`, `/terms`, `/safety`, `/activity-finder`, `/autopilot`, `/dashboard`, `/discovery-runs`, and `/mandates`.
- Public HEAD checks returned 200 for `/`, `/privacy`, `/terms`, and `/safety`.
- `MCP_SERVER_URL=https://signupassist.shipworx.ai npm run test:sse`: Passed. OAuth metadata responded, unauthenticated `/sse` requires auth, unauthenticated `register_for_activity` remains OAuth-gated, and unauthenticated `search_activities` returned 200 as expected for browse-friendly read-only discovery.
- `git diff --check`: Passed.

Residual risks/blockers:

- Full browser human proof with OAuth sign-in, Stripe-hosted setup, final review, and explicit `book now` still requires an interactive ChatGPT reviewer session.
- Supabase and Stripe production smokes were not run in this sweep because they require live service credentials and should be run deliberately against the intended production project/account.
- Local `.env` warnings should be reconciled before using local env output as deployment evidence.
- No broad tests were run because this phase only created and redirected documentation.

## 2026-04-18 - Browser Golden Path Foundation

Files changed in this phase:

- `tests/web-golden-path-foundation.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Verification added:

- Added a lightweight Vitest browser-foundation test instead of adding Playwright in this pass.
- The test verifies Activity Finder POSTs only the natural-language query with optional bearer auth and never sends client `userId`.
- The test verifies backend errors surface as errors, all Activity Finder result states are recognized, `need_more_detail` cannot create an intent, confirmed signup links can create a server-side intent payload, and `/autopilot` navigation contains only `intent=<id>`.
- The test verifies the Activity Finder component still redirects signed-out users to auth and uses `createSignupIntent` plus `buildAutopilotIntentPath`.

Verification results for this phase:

- `npx vitest run tests/web-golden-path-foundation.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts --reporter=verbose`: Passed.
- `npx eslint tests/web-golden-path-foundation.test.ts --max-warnings=0`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - Authenticated Web Golden Path Contract

Files changed in this phase:

- `tests/web-authenticated-golden-path.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Verification added:

- Added a deterministic authenticated web golden-path contract without requiring live secrets.
- The test links the Activity Finder signup intent, opaque `/autopilot?intent=<id>` path, Autopilot run packet, active subscription gate, provider readiness, redacted provider learning observation, signup intent update, and dashboard audit summary.
- The test confirms cross-user reads and patches remain blocked.

Verification results for this phase:

- `npx vitest run tests/web-authenticated-golden-path.test.ts tests/autopilot-run-packet.test.ts tests/dashboard-status.test.ts tests/provider-learning.test.ts tests/signup-intent-service.test.ts --reporter=verbose`: Passed.
- `npx eslint tests/web-authenticated-golden-path.test.ts --max-warnings=0`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - Redacted Release Evidence Helper

Files changed in this phase:

- `scripts/releaseEvidence.ts`
- `tests/release-evidence.test.ts`
- `package.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Verification added:

- Added `npm run evidence:release` for server-side, service-role-only release evidence capture by `signup_intent_id` and/or `autopilot_run_id`.
- Evidence output omits user ids and child ids, reduces target URLs to hostnames, summarizes signup intent/run/audit/provider readiness, and redacts child PII, credentials, tokens, payment data, and medical/allergy details.
- Added unit coverage for recursive redaction, target URL host-only output, provider promotion safety, and independent signup intent/run summaries.

Verification results for this phase:

- `npx vitest run tests/release-evidence.test.ts --reporter=verbose`: Passed.
- `npx eslint scripts/releaseEvidence.ts tests/release-evidence.test.ts --max-warnings=0`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - Dashboard And Provider Readiness Verification

Files changed in this phase:

- `src/pages/DiscoveryRuns.tsx`
- `src/lib/discoveryRunRedaction.ts`
- `tests/dashboard-provider-readiness.test.ts`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Verification added:

- Added dashboard/provider readiness verification for parent next-action sections, audit links, legal links, privacy/trust copy, provider readiness copy, and promotion guardrails.
- Added defensive redaction before rendering provider discovery run detail JSON in `/discovery-runs`.
- Verified supervised run observations adapt to existing `discovery_runs` RPC payloads without raw program names or target URL details.

Verification results for this phase:

- `npx vitest run tests/dashboard-provider-readiness.test.ts tests/dashboard-status.test.ts tests/provider-learning.test.ts --reporter=verbose`: Passed.
- `npx eslint src/pages/DiscoveryRuns.tsx src/lib/discoveryRunRedaction.ts tests/dashboard-provider-readiness.test.ts --max-warnings=0`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-18 - Web Ship Readiness Hardening

Files changed in this phase:

- `src/lib/redactionKeys.ts`
- `src/lib/discoveryRunRedaction.ts`
- `src/lib/providerLearning.ts`
- `src/lib/sensitiveActionGates.ts`
- `src/pages/Autopilot.tsx`
- `src/pages/RegistrationDashboard.tsx`
- `scripts/releaseEvidence.ts`
- `scripts/smokeRailway.ts`
- `scripts/smokeStripe.ts`
- `package.json`
- `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`
- `docs/APPROVAL_IMPACT_LOG.md`
- targeted tests for redaction, dashboard/provider readiness, release evidence, sensitive action gates, and Autopilot wizard copy

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added shared redaction-key handling so generic `name`, `label`, `title`, `parent_name`, `guardian_name`, `contact_name`, and `emergency_contact_name` fields are treated as sensitive unless they are known public provider/activity/venue/program labels.
- Tightened discovery-run UI redaction, provider-learning field signatures, sensitive-action audit redaction, and release evidence redaction against generic name/contact leakage.
- Reduced dashboard action ambiguity by making the always-available action `Review setup` and only showing `Resume` for states where resume/review work is actually plausible.
- Changed Autopilot post-create primary action to `View dashboard` so parents get a clear next step and cannot accidentally create duplicate run packets by pressing the same primary button again.
- Expanded Railway smoke to verify `/status` and `/identity` in addition to `/health` and OAuth metadata.
- Added `STRIPE_SMOKE_REQUIRE_WEBHOOK=1` support so Stripe smoke can fail closed when webhook proof is required.
- Added `npm run predeploy:release` as the explicit release gate and clarified the production runbook commands.

Verification results for this phase:

- `npx vitest run tests/dashboard-provider-readiness.test.ts tests/release-evidence.test.ts tests/provider-learning.test.ts tests/sensitive-action-gates.test.ts tests/security-mvp.test.ts tests/autopilot-wizard-ui.test.ts tests/dashboard-status.test.ts --reporter=verbose`: Passed.
- `npx eslint src/lib/redactionKeys.ts src/lib/discoveryRunRedaction.ts src/lib/providerLearning.ts src/lib/sensitiveActionGates.ts src/pages/Autopilot.tsx src/pages/RegistrationDashboard.tsx scripts/releaseEvidence.ts scripts/smokeRailway.ts scripts/smokeStripe.ts tests/dashboard-provider-readiness.test.ts tests/release-evidence.test.ts tests/provider-learning.test.ts tests/sensitive-action-gates.test.ts tests/autopilot-wizard-ui.test.ts --max-warnings=0`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `RAILWAY_MCP_URL=https://signupassist.shipworx.ai npm run infra:smoke:railway`: Passed for `/health`, `/status`, `/identity`, and OAuth metadata. Worker health was skipped because no worker health URL was provided.
- `MCP_SERVER_URL=https://signupassist.shipworx.ai MCP_ALLOW_UNAUTH_READONLY_TOOLS=true npm run test:sse`: Passed unauthenticated OAuth posture, unauthenticated `search_activities`, and unauthenticated `register_for_activity` auth-gating. Authenticated MCP tool calls were skipped because `MCP_ACCESS_TOKEN` was not provided in this command.
- `npm run infra:smoke:stripe`: Passed credential, webhook-secret-present, and `$9/month` Autopilot price checks.
- `npm run infra:smoke:supabase`: Passed table/queryability checks and invoked `get-user-location`.
- `npm run predeploy:release`: Passed. `infra:check` still reported non-blocking local-shell env warnings for Railway web, scheduled worker, and Supabase Edge Function groups.
- `git diff --check`: Passed.

## 2026-04-19 - CampMinder Automation Safety Policy

Files changed in this phase:

- `src/lib/autopilot/playbooks.ts`
- `src/lib/providerLearning.ts`
- `src/lib/sensitiveActionGates.ts`
- `src/pages/Autopilot.tsx`
- `src/pages/DiscoveryRuns.tsx`
- `src/pages/RegistrationDashboard.tsx`
- `tests/provider-learning.test.ts`
- `tests/sensitive-action-gates.test.ts`
- `tests/dashboard-provider-readiness.test.ts`
- `tests/dashboard-status.test.ts`
- `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`
- `docs/PROVIDER_LEARNING_PRD.md`
- `docs/SHIP_CHECKLIST.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added provider automation policy statuses separate from provider readiness.
- CampMinder is now explicitly `written_permission_required`: fixture testing, provider recognition, readiness display, redacted learning, supervised run packets, and parent-supervised assist are allowed, while unattended live browser automation remains blocked until written provider/camp permission or approved API access exists.
- Other large providers default to legal review before live delegated browser automation.
- Generic providers remain fixture-only.
- Added a stop condition for unclear provider terms, automation permission, or official API authorization.
- Threaded automation policy through Autopilot run metadata, redacted provider observations, Discovery Runs, Dashboard, and docs.
- Sensitive-action mandate checks now block delegated signup, final submit, and payment when live provider automation is not authorized by provider policy.

Verification added:

- Provider learning tests now prove CampMinder fixture readiness does not imply live delegated automation permission.
- Sensitive-action tests now prove future delegated signup requires both readiness and provider automation authorization.
- Dashboard/provider readiness tests now require provider automation policy copy to remain visible.

Verification results for this phase:

- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx vitest run tests/provider-learning.test.ts tests/sensitive-action-gates.test.ts tests/dashboard-provider-readiness.test.ts tests/dashboard-status.test.ts tests/autopilot-wizard-ui.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npx eslint src/lib/autopilot/playbooks.ts src/lib/providerLearning.ts src/lib/sensitiveActionGates.ts src/pages/Autopilot.tsx src/pages/DiscoveryRuns.tsx src/pages/RegistrationDashboard.tsx tests/provider-learning.test.ts tests/sensitive-action-gates.test.ts tests/dashboard-provider-readiness.test.ts tests/dashboard-status.test.ts --max-warnings=0`: Passed.
- `git diff --check`: Passed.

## 2026-04-19 - Policy Surface CI Fix For PR 103

Files changed in this phase:

- `docs/SAFETY_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `docs/TERMS_OF_USE.md`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, policy/submission docs only.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added the exact safety classification marker for `sexual content` expected by policy-surface CI.
- Restated the no-booking/no-payment confirmation rule with the exact `until explicit user confirmation` language expected by CI.
- Added adult account-holder `responsible delegate` framing to the privacy policy.
- Added explicit acceptable-use-policy language to the terms.

Verification results for this phase:

- `npx vitest run tests/policySurface.test.ts --reporter=verbose`: Passed.
- `npx tsx scripts/chatgptAppGuardrails.ts write-snapshot`: Updated only approval-sensitive policy doc hashes for `docs/PRIVACY_POLICY.md` and `docs/SAFETY_POLICY.md`.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.
- `npm run test -- --reporter=verbose`: Policy-surface tests passed; local run then failed on `tests/telemetryDebugAccess.integration.test.ts` because local debug telemetry returned 200 while disabled. This is outside the policy-surface fix and was not the PR 103 CI failure.

## 2026-04-19 - Web Ship P0 Approval And Production Surface Hardening

Files changed in this phase:

- `mcp_server/index.ts`
- `package.production.json`
- `scripts/chatgptAppGuardrails.ts`
- `scripts/infraCheck.ts`
- `tests/publicSpecSafety.test.ts`
- `tests/infra-platform.test.ts`
- `docs/SCHEDULED_REGISTRATION_WORKER_RUNBOOK.md`
- `docs/INFRA_RUNBOOK.md`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/index.ts` and approval snapshots changed intentionally to remove a legacy public `/tools` leak and fail closed for disabled debug telemetry.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No. The legacy HTTP `GET /tools` helper now returns only public tool summaries.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Reused a single visible-tool descriptor helper for MCP discovery paths and the legacy HTTP `GET /tools` route.
- Filtered the legacy `GET /tools` route to public tool summaries only, preventing private/internal provider tools from being listed.
- Made disabled `/debug/telemetry` routes return explicit JSON 404 instead of falling through to the SPA shell.
- Added production `start` and `worker:scheduled` scripts to `package.production.json`.
- Updated Railway/worker docs to state current supervised MVP behavior: scheduled work pauses before provider submit, payment, waivers, provider login, and final submit.
- Extended infra and public-surface tests to catch production script drift, `/tools` leaks, and telemetry fallback regressions.

Verification results for this phase:

- `npm run mcp:build`: Passed.
- `npx vitest run tests/publicSpecSafety.test.ts tests/infra-platform.test.ts tests/telemetryDebugAccess.integration.test.ts --reporter=verbose`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional snapshot update for `mcp_server/index.ts`.
- `npm run test:chatgpt-app`: Passed.
- `npm run infra:check`: Passed with local env warnings only.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `git diff --check`: Passed.

## 2026-04-19 - Web Ship P0 Sensitive Action Gate Lockdown

Files changed in this phase:

- `supabase/migrations/20260419170000_lock_sensitive_action_gates.sql`
- `supabase/functions/mcp-executor/index.ts`
- `supabase/functions/mandate-issue-v2/index.ts`
- `mcp_server/providers/stripe.ts`
- `mcp_server/ai/APIOrchestrator.ts`
- `tests/sensitive-action-contract.test.ts`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/ai/APIOrchestrator.ts`, `mcp_server/providers/stripe.ts`, and the approval snapshot changed intentionally.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added a follow-on Supabase migration that removes authenticated client create/update/delete policies for `parent_action_confirmations` and `agent_delegation_mandates`; trusted server/service-role code remains the write path.
- Blocked direct `mcp-executor` calls to Bookeo write tools (`create_hold`, `confirm_booking`, and `cancel_booking`) with a `paused_for_parent` response unless a future server-gated executor path is added.
- Redacted direct executor request/tool logs before logging sensitive fields such as credentials, payment data, phone/email, delegate, participant, and date-of-birth data.
- Tightened `mandate-issue-v2` credential lookup to the exact credential/user/provider tuple, stopped logging raw credential query results, and ignored client-supplied mandate JWS values.
- Paused MCP-server success-fee charging by default behind `ENABLE_MCP_SUCCESS_FEE_CHARGE=true` and updated final receipt copy/registration metadata so it does not claim SignupAssist charged a success fee when the charge was intentionally paused.
- Expanded sensitive-action contract tests for RLS lock-down, direct executor bypass prevention, mandate credential trust boundaries, paused success-fee payment, and honest receipt copy.

Verification results for this phase:

- `npx vitest run tests/sensitive-action-contract.test.ts tests/sensitive-action-gates.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed after intentional approval snapshot update.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:authz-audit`: Passed.
- `git diff --check`: Passed.

## 2026-04-19 - Web Ship Security Tightening

Files changed in this phase:

- `mcp_server/lib/targetUrlSafety.ts`
- `mcp_server/index.ts`
- `tests/security-mvp.test.ts`
- `tests/fixtures/security/provider-prompt-injection.html`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp_server/index.ts` and the approval snapshot changed intentionally for Activity Finder CORS/rate-limit handling.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Tightened shared target URL validation so production HTTP target URLs fail with `url_https_required`, while explicit non-production options can allow HTTP/local development targets.
- Added optional provider-domain allowlist validation to the shared target URL validator.
- Added Activity Finder search to the shared endpoint-specific rate-limit block.
- Routed Activity Finder search responses and preflight through shared CORS/security header helpers.
- Expanded provider prompt-injection coverage to include provider-login/credential instructions.

Verification results for this phase:

- `npm run test:security-mvp`: Passed.
- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run test:chatgpt-app`: Passed after intentional approval snapshot update.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-19 - Web Ship Golden Path And Release Evidence

Files changed in this phase:

- `package.json`
- `tests/web-authenticated-golden-path.test.ts`
- `docs/SHIP_CHECKLIST.md`
- `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`
- `docs/RELEASE_NOTES_MVP.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: No.
- Public MCP tool names changed: No.
- Public MCP schemas/descriptors/annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `mcp/openapi.json` changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Added `npm run test:golden-path` for the web Activity Finder to Autopilot to Dashboard contract tests.
- Added `npm run test:chatgpt-golden-path` as a named wrapper around the existing ChatGPT app guardrail matrix.
- Extended the authenticated web golden-path contract to assert Activity Finder confidence and source-freshness metadata survives the secure signup-intent handoff.
- Added release checklist evidence requirements for desktop/mobile browser proof, intent-only URLs, redacted audit/mandate views, and redacted DB evidence.
- Added MVP release notes covering shipped surfaces, intentionally paused automation, required environment, migration steps, smoke tests, rollback, and known limitations.

Verification results for this phase:

- `npm run test:golden-path`: Passed.
- `npm run test:chatgpt-golden-path`: Passed.
- `npm run test:security-mvp`: Passed.

## 2026-04-19 - Final Web Ship Hardening Blocker Fixes

Files changed in this phase:

- `.env.example`
- `RAILWAY_DEPLOY.md`
- `docs/CHAT_TEST_HARNESS_USER_GUIDE.md`
- `docs/INFRA_RUNBOOK.md`
- `docs/RELEASE_NOTES_MVP.md`
- `docs/SHIP_CHECKLIST.md`
- `docs/SIGNUPASSIST_PRODUCTION_RUNBOOK.md`
- `docs/V1_ENV_VARS.md`
- `docs/approval-snapshots/chatgpt-app-approval.snapshot.json`
- `mcp/openapi.json`
- `mcp_server/index.ts`
- `mcp_server/lib/activityFinder.ts`
- `package.json`
- `scripts/envRegistry.ts`
- `src/App.tsx`
- `src/components/Header.tsx`
- `src/lib/chatMcpClient.ts`
- `src/lib/featureFlags.ts`
- `src/lib/prompts.ts`
- `src/pages/Autopilot.tsx`
- `src/pages/ChatTestHarness.README.md`
- `src/pages/DiscoveryRuns.tsx`
- `src/pages/MandatesAudit.tsx`
- `src/pages/PlanBuilder.tsx`
- `src/pages/RegistrationDashboard.tsx`
- `supabase/config.toml`
- `supabase/functions/create-system-mandate/index.ts`
- `supabase/functions/mcp-executor/index.ts`
- `supabase/functions/run-plan/index.ts`
- `supabase/functions/stripe-refund-success-fee/index.ts`
- `supabase/migrations/20260417110000_add_signup_intents.sql`
- `supabase/migrations/20260417140000_add_sensitive_action_gates.sql`
- `supabase/migrations/20260419183000_lock_provider_learning_and_audit_events.sql`
- `tests/mandates-audit-redaction.test.ts`
- `tests/publicSpecSafety.test.ts`
- `tests/security-mvp.test.ts`

Approval impact:

- Existing approval-sensitive ChatGPT public surface files changed: Yes, `mcp/openapi.json`, `mcp_server/index.ts`, and the approval snapshot changed intentionally.
- Public MCP tool names changed: No.
- Public MCP schemas changed: No.
- Public MCP descriptors changed: Yes, public descriptors now include per-tool `securitySchemes` to make unauthenticated search vs OAuth-gated registration explicit.
- Public MCP annotations changed: No.
- Hidden/private/internal tools exposed: No.
- MCP manifest changed: No.
- `public/.well-known/*` changed: No.
- OAuth/Auth0/auth behavior changed: No.
- CSP/resource metadata changed: No.
- Protected actions changed: No.
- Public MCP tool surface remains `search_activities` and `register_for_activity`.

Changes:

- Marked `/orchestrator/chat` / `register_for_activity` as consequential in the public OpenAPI contract, matching live booking/payment-review posture.
- Added per-tool descriptor security schemes: `search_activities` is no-auth read-only; `register_for_activity` is OAuth-gated.
- Prevented production `/orchestrator/chat` from accepting caller-supplied `user_id` fallback unless explicit local harness mode is enabled.
- Hid legacy web test harness routes and chat navigation unless test routes are explicitly enabled.
- Removed frontend `VITE_MCP_ACCESS_TOKEN` usage and documented that MCP bearer tokens must not live in production `VITE_*` variables.
- Tightened Autopilot external provider URLs to public HTTPS in production and blocked private/local/credentialed hosts.
- Locked raw provider-learning discovery tables/RPCs and signup-intent event inserts behind service/admin mediation.
- Made `create-system-mandate` JWT-verified, disabled by default, user-bound, scope-limited, and short-lived.
- Added user ownership checks to success-fee refunds, run-plan legacy paths, and MCP executor plan execution.
- Added confirmation consumption verification so already-consumed/raced confirmations fail closed.
- Softened web copy around supervised runs and future delegation.

Verification results for this phase:

- `npm run typecheck`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run build`: Passed with existing Vite chunk-size/dynamic-import warnings.
- `npm run test:security-mvp`: Passed.
- `npm run test:authz-audit`: Passed.
- `npm run test:golden-path`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional snapshot update for `mcp_server/index.ts`.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- Targeted lint on changed helper/UI/test files: Passed. Broad `mcp_server/index.ts` and scheduled worker lint debt remains pre-existing and was not cleaned in this feature pass.
- `git diff --check`: Passed.
- `npm run test:chatgpt-golden-path`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional snapshot update.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run env:check`: Passed in advisory mode with 0 required missing and 12 recommended local env warnings.
- `npm run infra:check`: Passed with 31 ok, 3 local env warnings, and 0 failures.
- `npm run predeploy:release`: Passed.
- `npm run test -- --reporter=verbose`: Passed; 42 files passed, 4 skipped, 241 tests passed, 20 skipped.
- Targeted lint over newly hardened web/security files: Passed.
- `npm run lint`: Failed on broad pre-existing lint debt (`no-explicit-any`, parser error in `evals/index.ts`, hook warnings, and related repo-wide issues); not classified as a launch blocker for this phase because typecheck/build/tests/predeploy passed and the failures are outside the newly hardened subset.
- `git diff --check`: Passed.

## 2026-04-19 - Fresh Supabase Production Foundation

Scope:

- Created fresh Supabase project `signupassist-prod-v2` (`jdwuxllyvbrjedqiipbi`) because the previous production project had no real data, drifted migration history, and missing April web-app tables.
- Applied the complete 66-migration chain through `20260419183000_lock_provider_learning_and_audit_events.sql`, then added/applied `20260419200000_unschedule_legacy_old_project_cron_jobs.sql`.
- Updated Railway web and worker Supabase env vars to the fresh project.
- Deployed existing Supabase Edge Functions to the fresh project.
- Updated `supabase/config.toml` to the new project ref and removed stale function config entries for missing local functions.
- Removed stale `pg_cron` jobs in the fresh project that were recreated from legacy migrations with hardcoded old Supabase project URLs.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Production data impact: No real user data was present per operator confirmation; this was a foundation cutover to a clean Supabase project.
- Safety impact: Positive. Fresh schema now includes signup intents, signup intent events, parent confirmations, delegation mandates, RLS locks, and service-role-only provider-learning RPCs.

Verification:

- `supabase db push --linked --include-all --dry-run`: Passed for fresh project.
- `supabase db push --linked --include-all`: Passed; latest migration `20260419183000`, migration count 66.
- `supabase db push --linked`: Passed for `20260419200000_unschedule_legacy_old_project_cron_jobs.sql`.
- Final migration verification: latest migration `20260419200000`, migration count 67.
- Direct verification confirmed expected April tables exist, RLS is enabled on sensitive/provider-learning tables, and provider-learning RPCs are not executable by `anon` or `authenticated`.
- `cron.job` verification confirmed no remaining jobs reference the old Supabase project ref.

## 2026-04-19 - Stripe Test Webhook Supabase URL Cutover

Scope:

- Checked Stripe account `Shipworx, LLC` test-mode webhook endpoints through the configured Stripe secret key.
- Found one enabled test webhook endpoint (`we_1TMrN7EsXkVhy9qgEFuVACAm`) pointing at the old Supabase project URL.
- Updated that endpoint to `https://jdwuxllyvbrjedqiipbi.supabase.co/functions/v1/stripe-subscription-webhook`.
- Added `STRIPE_WEBHOOK_SECRET` to Railway web/worker env and the fresh Supabase project secrets.
- Added ship checklist coverage for Stripe webhook URL/signing-secret readiness.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Payment posture changed: No autonomous payment enabled; webhook change only keeps subscription status sync pointed at the current Supabase project.

Verification:

- Stripe webhook endpoint list now shows zero endpoints referencing old Supabase project `jpcrphdevmvzcfgokgym` and one enabled endpoint referencing `jdwuxllyvbrjedqiipbi`.
- `STRIPE_SMOKE_REQUIRE_WEBHOOK=1 npm run infra:smoke:stripe`: Passed.

## 2026-04-19 - Launch Env Completion

Scope:

- Added `PUBLIC_SITE_URL` and `SITE_URL` as `https://signupassist.shipworx.ai` in Railway web/worker env and Supabase Edge Function secrets.
- Generated and configured `PII_ENCRYPTION_KEY` and `PII_ENCRYPTION_KEY_ID` in Railway web/worker env and Supabase Edge Function secrets.
- Updated local ignored `.env` values for smoke/development parity.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Stripe redirects now have an explicit production site URL, and encrypted PII envelope support has a configured production key.

Verification:

- Railway web env confirms `PUBLIC_SITE_URL`, `SITE_URL`, `PII_ENCRYPTION_KEY`, `PII_ENCRYPTION_KEY_ID`, and `STRIPE_WEBHOOK_SECRET` are present.
- Supabase secrets confirm `PUBLIC_SITE_URL`, `SITE_URL`, `PII_ENCRYPTION_KEY`, `PII_ENCRYPTION_KEY_ID`, and `STRIPE_WEBHOOK_SECRET` are present.
- `npm run env:check`: Passed in advisory mode with 0 required missing.
- `npm run infra:smoke:stripe`: Passed.

## 2026-04-19 - Overnight Web Launch Surface Hardening

Scope:

- Disabled production admin UI/API flags in Railway and configured a production CORS allowlist for web-only APIs.
- Removed `VITE_MCP_ACCESS_TOKEN` exposure remained confirmed absent and test routes remained disabled.
- Deleted public Supabase helper/test Edge Functions from the fresh production project: `setup-system-user`, `testHarness`, `debug-env`, `orchestrator-test`, and `test-provider-search`.
- Hardened `/bookeo-debug` so it returns 404 in production unless an explicit non-production debug flag is set.
- Replaced hardcoded browser Stripe publishable keys with `VITE_STRIPE_PUBLISHABLE_KEY` configuration.
- Updated Supabase function config so test/debug helper functions require JWT if redeployed later.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Public debug/test surfaces were closed and provider credential diagnostics no longer expose Bookeo account metadata in production.

Verification:

- `npm run test:security-mvp`: Passed.
- `npm run test:approval-snapshots`: Passed after intentional approval snapshot update for the reviewed `mcp_server/index.ts` production debug-route hardening.
- `npm run test:chatgpt-app`: Passed.
- Railway env confirms `ADMIN_API_ENABLED=false`, `VITE_ADMIN_CONSOLE_ENABLED=false`, `VITE_MCP_ACCESS_TOKEN` missing, `VITE_ENABLE_TEST_ROUTES` missing, and `CORS_ALLOW_ORIGINS` configured.
- Supabase function list no longer includes the deleted public helper/test functions.

## 2026-04-19 - Production Web Golden Path and Subscription Function Auth

Scope:

- Verified the production web golden path in Stripe test mode using a synthetic test user: `/activity-finder` to `/autopilot?intent=<uuid>` to supervised run creation to `/dashboard`.
- Confirmed the Activity Finder handoff URL contained only the server-side `intent` id.
- Confirmed the run appeared on the dashboard with provider readiness, price cap, reminder state, and redacted audit summaries.
- Confirmed Stripe test webhook delivery updates `user_subscriptions` in the fresh Supabase production project.
- Redeployed Stripe subscription checkout/success/cancel Edge Functions with gateway JWT verification disabled and in-function `auth.getUser(token)` verification retained. This is required for the fresh ES256 Supabase project because the Edge Function gateway rejects ES256 JWTs before function code runs.
- Added regression checks that subscription functions keep in-function user-token verification when gateway JWT verification is disabled.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Payment posture changed: No live Stripe switch; proof remains Stripe test mode. Subscription setup is still parent-initiated and authenticated in-function.
- Safety impact: Positive. The production web path is verified without exposing child data, raw card data, provider credentials, or unattended provider automation.

Verification:

- Production `/tools` returns only `search_activities` and `register_for_activity`.
- Production `/bookeo-debug` returns 404.
- Production helper/test routes render the 404 page when test routes are disabled.
- Production legal pages include parent/guardian, child-safe, no-card-number, redaction, and no-unattended-delegation language.
- Production evidence screenshots are stored locally under `evidence/overnight-web-launch-20260419/`.

## 2026-04-20 - Activity Finder Youth-Scope and CTA Hardening

Scope:

- Added web-only Activity Finder guardrails that block explicit adult-participant searches before provider lookup, including adult-only activities, adult sports leagues, `18+` / `21+`, and "register me" style prompts when no child/youth cue is present.
- Treated age `0` as missing and adult participant ages as out of scope for launch.
- Tightened result eligibility so missing-detail results and generic/incomplete provider matches do not expose enabled "prepare" CTAs.
- Downgraded generic venue homepages to `needs_signup_link` unless the URL looks like a registration/program/signup path or a known tested fast path.
- Required clearer location/provider context before surfacing intent-ready live venue matches and filtered remote live venue candidates when explicit city/state is provided.
- Simplified Activity Finder UI by making natural-language search primary, collapsing structured fields behind "Add details", removing duplicate trust cards, and adding an out-of-scope state.
- Preserved signed-out Activity Finder handoffs by storing a short-lived selected-result payload in `sessionStorage`, then creating the server-side signup intent after sign-in.
- Minimized Activity Finder search logs by storing redacted/truncated query summaries, redacted parsed fields, coarse location hints without lat/lng, and target URL hostnames instead of raw provider URLs.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Activity Finder now matches the parent-controlled youth-activity launch scope more tightly and avoids misleading adult/out-of-scope or incomplete provider handoffs.

Verification:

- `npx vitest run mcp_server/lib/activityFinder.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts tests/web-golden-path-foundation.test.ts`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run typecheck`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:golden-path`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test:authz-audit`: Passed.
- `npx eslint mcp_server/lib/activityFinder.ts mcp_server/lib/activityFinder.test.ts src/lib/activityFinder.ts src/lib/signupIntent.ts src/pages/ActivityFinder.tsx tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts --max-warnings=0`: Passed.

## 2026-04-20 - Activity Finder Signed-Out Return Fix

Scope:

- Browser proof found that signed-out Activity Finder handoff stored the pending signup selection but the web auth page redirected to `/` after sign-in instead of returning to `/activity-finder`.
- Updated the web auth page to honor a local-only `returnTo` path, falling back to the existing `signupassist:returnTo` session value and then `/`.
- Added a contract check that Activity Finder's pending signup-intent handoff remains wired through auth return before intent creation.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Signed-out parents can resume the selected Activity Finder result after web sign-in without rerunning the search or placing search details in route query params.

Verification:

- `npx vitest run tests/web-golden-path-foundation.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx eslint src/pages/auth.tsx src/pages/ActivityFinder.tsx tests/web-golden-path-foundation.test.ts --max-warnings=0`: Passed.

## 2026-04-20 - Activity Finder Venue-Only Fast-Path Guardrail

Scope:

- Production browser testing found that a venue-only query such as "Keva in Madison for my 9 year old" could be upgraded into a soccer tested fast path because the AI parser inferred an activity from the venue.
- Tightened Activity Finder parsing so AI-provided activity labels are accepted only when the parent query itself supports the activity; venue-only searches now remain missing-detail until the parent names the activity.
- Added regression coverage for venue-only tested fast path prevention.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Web Activity Finder no longer prepares a signup path for a guessed activity when the parent only named a venue.

Verification:

- `npx vitest run mcp_server/lib/activityFinder.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx eslint mcp_server/lib/activityFinder.ts mcp_server/lib/activityFinder.test.ts --max-warnings=0`: Passed.
- `npm run typecheck`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `git diff --check`: Passed.

## 2026-04-20 - Activity Finder Missing-Detail And Generic CTA Polish

Scope:

- Prevented city/state-only parser output from being displayed as the provider or venue, fixing the "basketball camps in Madison" case that showed "Venue: Madison".
- Collapsed duplicate generic "Paste signup link" CTAs in secondary matches into a compact "More possible venues" list.
- Added mobile auto-scroll toward results after a search completes.
- Made "Add missing details" expand the structured details panel and focus the relevant field instead of acting like a disabled handoff CTA.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Web Activity Finder now avoids misleading venue labels, reduces duplicated handoff controls, and keeps incomplete results in an explicit missing-detail correction flow.

Verification:

- `npx vitest run mcp_server/lib/activityFinder.test.ts tests/activity-finder-ui.test.ts tests/signup-intent-frontend.test.ts`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx eslint mcp_server/lib/activityFinder.ts mcp_server/lib/activityFinder.test.ts src/pages/ActivityFinder.tsx tests/activity-finder-ui.test.ts --max-warnings=0`: Passed.
- `npm run typecheck`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:golden-path`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-20 - Supervised Chrome Helper Alpha And SMS Reminder Foundation

Scope:

- Added web-only helper endpoints for short-lived Chrome helper codes and sanitized supervised run packets.
- Added the Autopilot "Connect Chrome Helper" post-run step while keeping manual packet copy as fallback.
- Added parent-confirmed SMS reminder setup and Twilio-backed scheduled worker support.
- Narrowed Chrome helper permissions for the alpha provider set and added Assist Mode pause/fill/safe-navigation controls.
- Expanded DaySmart/Keva fixtures and tests for supervised fill, safe navigation, login/payment/waiver/final-submit pauses, sold-out, and price-cap states.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Existing approval-sensitive file changed: Yes, `mcp_server/index.ts` was updated only to mount web-only `/api/helper/run-links` and `/api/helper/run-packet`.
- Additional safety hardening: `MCP_LISTTOOLS_INCLUDE_PRIVATE` is now ignored in production so private/internal tools cannot be exposed by accidentally setting that diagnostic flag on the public server.
- Approval snapshot updated: Yes, after confirming the only approval-sensitive hash change was `mcp_server/index.ts`.
- Safety impact: Positive. Supervised helper packets are signed, short-lived, ownership-checked, and sanitized; SMS reminders exclude sensitive child/payment data; the helper pauses before login, MFA, CAPTCHA, waivers, payment, price mismatch, and final submit.

Verification:

- `npm run mcp:build`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npx vitest run mcp_server/tests/helperRunApi.test.ts mcp_server/tests/reminders.test.ts tests/chrome-helper-alpha.test.ts tests/daysmart-provider-slice.test.ts tests/autopilot-wizard-ui.test.ts tests/autopilot-run-packet.test.ts tests/dashboard-status.test.ts --reporter=verbose`: Passed.
- `npm run typecheck`: Passed.
- `npm run build`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:authz-audit`: Passed.
- `npm run test:golden-path`: Passed.

## 2026-04-21 - Chrome Helper Alpha Evaluation Framework

Scope:

- Added a redacted Chrome helper alpha eval scorecard and report runbook.
- Added `npm run eval:chrome-helper` to score untracked agent-wave JSON reports for speed, accuracy, safety, parent effort, and flow clarity.
- Added regression tests for scoring thresholds, automatic blockers, and eval-record redaction.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. Eval reports are explicitly redacted and block alpha readiness when unsafe clicks, wrong fields, sensitive actions, unknown required field fills, or sensitive content appear.

Verification:

- `npm run test:chrome-helper-evals`: Passed.
- `npx tsx scripts/chromeHelperEval.ts --help`: Passed.
- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run typecheck`: Passed.
- `npm run test --if-present`: Passed.
- `npx eslint scripts/chromeHelperEval.ts tests/chrome-helper-eval.test.ts --max-warnings=0`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `git diff --check`: Passed.

## 2026-04-21 - Simplest Good Alpha Parent Flow

Scope:

- Reframed the web alpha around `Find Activity -> choose child -> save plan -> launch helper`.
- Added shared compact `PreparePlanSheet` for Activity Finder and `/autopilot?intent=<id>`.
- Added `/run-center` as the parent operational home with Ready, Opening soon, Needs you, and Done tabs.
- Added `/chrome-helper/setup` with a five-step unpacked helper install flow and a downloadable alpha helper zip.
- Added the SignupAssist-domain Chrome extension bridge for helper detection and sanitized packet storage.

Approval impact:

- ChatGPT MCP public tool names changed: No.
- MCP manifest/OpenAPI/.well-known/OAuth/CSP/protected-action behavior changed: No.
- Public MCP schemas/descriptors changed: No.
- Hidden/private/internal tools exposed: No.
- Safety impact: Positive. The parent path is shorter while retaining public HTTPS URL validation, opaque signup intents, helper packet sanitization, helper setup fallback, and pauses before login, payment, waivers, and final submit.

Verification:

- `npx tsc -p tsconfig.app.json --noEmit`: Passed.
- `npm run typecheck`: Passed.
- `npm run build`: Passed with existing non-blocking Vite chunk warnings.
- `npx vitest run tests/activity-finder-ui.test.ts tests/autopilot-wizard-ui.test.ts tests/run-center-alpha.test.ts tests/chrome-helper-alpha.test.ts --reporter=verbose`: Passed.
- `npm run test:golden-path`: Passed.
- `npm run test:chrome-helper-evals`: Passed.
- `npm run test:security-mvp`: Passed.
- `npm run test:authz-audit`: Passed.
- `npm run test:chatgpt-app`: Passed.
- `npm run test:approval-snapshots`: Passed.
- `npm run test:mcp-manifest`: Passed.
- `npm run test:mcp-descriptors`: Passed.
- `npm run test --if-present`: Passed.
- Targeted ESLint on changed files: Passed.
- `git diff --check`: Passed.
