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

Known pre-existing blockers:

- Targeted lint including `mcp_server/index.ts` failed on existing broad `@typescript-eslint/no-explicit-any` debt in that file: `172 problems (172 errors, 0 warnings)`, for example `/Users/mattmessinger/Desktop/signupassist-mcp/mcp_server/index.ts:71:52 Unexpected any. Specify a different type`.
- Broad `npm run lint` remains classified as pre-existing from the prior phase.
- Broad `npm run test` remains classified as pre-existing from the prior phase due to `tests/telemetryDebugAccess.integration.test.ts` debug endpoint assertion.
