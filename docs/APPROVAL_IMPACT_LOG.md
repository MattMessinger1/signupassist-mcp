# Approval Impact Log

## 2026-04-17

Date: 2026-04-17

Summary: No production code changed yet

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
