# SignupAssist Implementation Plan

## Phase Order

### Phase 0: Docs-Only MVP Readiness Pass

Goal:

- Create ship docs, guardrails, provider learning PRD, implementation plan, checklist, and approval impact log.

Files changed:

- `AGENTS.md`
- `docs/SHIP_PRD.md`
- `docs/CHATGPT_APP_APPROVAL_GUARDRAILS.md`
- `docs/PROVIDER_LEARNING_PRD.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/SHIP_CHECKLIST.md`
- `docs/APPROVAL_IMPACT_LOG.md`

No production code changes.

Status: complete.

### Phase 1: ChatGPT App Compatibility Guardrails And Snapshots

Goal:

- Freeze the current public MCP approval posture before web app work.

Likely files:

- MCP smoke scripts under `scripts/*`
- approval docs under `docs/CHATGPT_SUBMISSION_CHECKLIST.md`, `docs/OPENAI_REVIEWER_TEST_CASES.md`, and `docs/REVIEW_TEST_ACCOUNT.md`
- snapshot fixtures if an existing snapshot location is present, otherwise a new docs/test artifact location approved in that phase
- `docs/APPROVAL_IMPACT_LOG.md`

Expected outputs:

- Public `ListTools` snapshot showing only `search_activities` and `register_for_activity`.
- Public descriptor/schema/annotation snapshot.
- Manifest and `.well-known` checksum or diff baseline.
- OAuth discovery route smoke notes.
- SSE smoke results.

This phase must happen before web app production changes.

Status: complete. Current guardrails include `test:chatgpt-app`, `test:mcp-manifest`, `test:mcp-descriptors`, `test:approval-snapshots`, and a checked-in approval snapshot.

### Phase 2: Read-Only Implementation Audit

Goal:

- Use parallel read-only audits to set the final implementation order without changing production code.

Files changed:

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/APPROVAL_IMPACT_LOG.md`

Audit findings to carry forward:

- ChatGPT public MCP surface remains `search_activities` and `register_for_activity`; hidden/private/internal tools remain hidden by default.
- `/api/activity-finder/search` derives identity from the Supabase bearer token and ignores client-sent `userId`, but the client helper still sends `userId` and should be cleaned up during web polish.
- Activity Finder -> Autopilot handoff exists but has query-param and return-url risks.
- Backend execution/payment paths are the highest safety risk: `run-plan`, `mcp-executor`, and Stripe charge functions need server-verified parent confirmation before any unsafe action.
- Existing RLS patterns are strong enough to model `signup_intents`, `signup_intent_events`, and `parent_action_confirmations`.
- Provider learning foundation exists; adapt discovery/cache/fingerprint/autopilot tables before adding new provider-learning tables.
- Production web health is solid; worker health depends on `PORT`; app-store docs/evidence still need cleanup.

Status: complete.

### Phase 3: ChatGPT Approval Docs And Evidence Cleanup

Goal:

- Remove reviewer-facing drift before web or safety code changes.

Likely files:

- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/APPROVAL_IMPACT_LOG.md`
- screenshot/evidence artifacts if approved

Required decisions:

- Fix docs that label `register_for_activity` as read-only/open-world; live descriptors treat it as consequential/write.
- Decide whether `mcp/openapi.json` `x-openai-isConsequential` posture is intentional before changing it. Any OpenAPI change requires explicit approval and snapshot updates.
- Pick one canonical production URL story across `signupassist.shipworx.ai` and Railway subdomain docs.
- Complete screenshot and reviewer prompt evidence.

Constraints:

- Docs/evidence only unless explicit approval is given for OpenAPI or manifest changes.
- Preserve public tool names, schemas, descriptors, manifest, `.well-known`, OAuth/Auth0, CSP, and protected actions unless explicitly approved.

### Phase 4: Backend Safety Gates Before Any Web Polish

Goal:

- Make unsafe execution impossible without server-verified parent confirmation or a future valid signed mandate.

Likely files:

- `supabase/functions/mcp-executor/index.ts`
- `supabase/functions/run-plan/index.ts`
- `supabase/functions/schedule-from-readiness/index.ts`
- `supabase/functions/stripe-charge-success/index.ts`
- `supabase/functions/stripe-charge-success-fee/index.ts`
- `supabase/functions/stripe-checkout-setup/index.ts`
- `supabase/functions/stripe-subscription-checkout/*` if present
- `supabase/functions/create-plan/index.ts`
- `supabase/functions/mandate-issue-v2/index.ts`
- shared Supabase function helpers under `supabase/functions/_shared/*`
- targeted tests under `tests/*`, `scripts/*`, or Supabase function test locations

Required changes:

- Disable or strictly gate `mcp-executor` direct `body.tool` passthrough for booking tools.
- Lock `run-plan` behind auth plus server-verified parent confirmation.
- Prevent automatic off-session charges unless confirmation/mandate checks pass server-side.
- Validate `target_url`, Stripe `success_url`, and Stripe `cancel_url` server-side.
- Enforce HTTPS-only and provider-domain allowlists for signup targets.
- Redact or remove raw request/credential logging.
- Add prompt-injection, URL-safety, payment-gate, waiver/final-submit, and PII-redaction tests.

Constraints:

- Do not change public MCP tools or ChatGPT descriptors.
- If touching approval-sensitive files, run `test:chatgpt-app` and update `docs/APPROVAL_IMPACT_LOG.md`.
- Unsafe automation pauses for parent review today.

### Phase 5: Signup Intent Data Model And RLS

Goal:

- Add pre-commit intent and consent state without overloading downstream registration records.

Likely files:

- `supabase/migrations/*`
- generated Supabase types if the repo updates them
- `supabase/functions/*` only where needed for intent CRUD/audit
- docs/checklists as needed

Required schema direction:

- `signup_intents`: root parent-owned intent state with `user_id`, optional `child_id`, optional `mandate_id`, provider/program fields, target URL, status, metadata, expiration, and timestamps.
- `signup_intent_events`: append-only event stream with intent ID, user ID, event type, decision/status, redacted args/result, hashes, metadata, and timestamps.
- `parent_action_confirmations`: narrow consent ledger, or a deliberate `signup_intent_events` subtype if a separate query surface is not needed.

RLS direction:

- Mirror own-row patterns for parent-owned records: `auth.uid() = user_id`.
- Use service-role-only writes for execution/audit events unless direct parent confirmation writes are explicitly required.
- Do not overload `registrations` or `scheduled_registrations`; those are downstream outcomes.

### Phase 6: Same-Day Web App P0 Polish

Goal:

- Make Activity Finder, Autopilot, Dashboard, Credentials, Mandates, Discovery Runs, and Admin surfaces shippable without changing MCP approval posture.

Likely files:

- `src/App.tsx`
- `src/pages/ActivityFinder.tsx`
- `src/pages/Autopilot.tsx`
- `src/pages/RegistrationDashboard.tsx`
- `src/pages/Credentials.tsx`
- `src/pages/MandatesAudit.tsx`
- `src/pages/DiscoveryRuns.tsx`
- `src/pages/admin/AdminConsole.tsx`
- `src/lib/activityFinder.ts`
- `src/lib/autopilot/*`
- `src/components/BillingCard.tsx`
- `src/lib/subscription.ts`

Constraints:

- Additive web app changes only.
- No change to public MCP tools, manifest, OpenAPI, `.well-known`, OAuth/Auth0, CSP, or protected actions.
- Backend identity must still derive from auth/session/JWT.

Required changes:

- Preserve Activity Finder -> Autopilot handoff while fixing return URL query-string handling.
- Carry provider display context through handoff.
- Clean up client-side `userId` body sending where practical; backend remains authoritative.
- Add auth/ownership cues or guards for Discovery Runs and other user-data surfaces.
- Make Autopilot parent-review boundaries clearer without promising set-and-forget.

### Phase 7: Provider Learning P0 Using Existing Infrastructure First

Goal:

- Capture provider readiness and redacted learning signals using existing discovery/playbook/fixture/autopilot foundations.

Likely files:

- `src/lib/autopilot/*`
- `chrome-helper/*`
- `supabase/migrations/*`
- `supabase/functions/maintenance-discovery/*`
- provider/admin UI files under `src/pages/DiscoveryRuns.tsx` and `src/pages/admin/AdminConsole.tsx`
- backend routes in `mcp_server/index.ts` only if explicitly approved and isolated from public MCP behavior

Constraints:

- Check existing `discovery_runs`, `discovery_hints`, `program_fingerprints`, cached provider/program tables, and `autopilot_runs` before adding tables.
- No sensitive data in learning artifacts.
- No readiness promotion by model output alone.

Required changes:

- Consolidate or reconcile provider roster across UI playbooks, MCP provider registry, and edge-function provider registry.
- Replace stubbed confidence/merge behavior only when tests define expected promotion behavior.
- Store selected result and pause-reason evidence using existing `activity_finder_searches`, `discovery_runs.meta`, and `autopilot_runs.audit_events` where possible.
- Keep Generic beta fill-only until fixture coverage exists.

### Phase 8: Production And Railway Readiness

Goal:

- Verify deploy, health, env, and submission evidence.

Likely files:

- `RAILWAY_DEPLOY.md`
- `docs/INFRA_RUNBOOK.md`
- `docs/CHATGPT_APP_REVIEW_PACKAGE.md`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- deployment docs if needed
- no runtime code unless a verified production blocker requires it

Constraints:

- Confirm worker service has `PORT` discipline if Railway probes `/health`.
- Clarify that Dockerfile owns the real Railway build if `railway.json` stays as an echo build command.
- Align deploy docs with root `package.json` vs `package.production.json`.
- Keep one canonical production URL story.

### Phase 9: Release Candidate Verification

Goal:

- Verify same-day MVP readiness and prepare Railway deploy.

Likely files:

- docs/checklist updates
- deployment docs if needed
- no code changes unless a release blocker is found

Checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run mcp:build`
- `npm run test:sse`
- `npm run test:openai-smoke`
- `npm run env:check`
- Railway smoke checks as appropriate

## Migration Plan

1. Inventory existing tables: `discovery_runs`, `discovery_hints`, `program_fingerprints`, cached provider/program tables, `program_discovery_status`, `activity_finder_searches`, and `autopilot_runs`.
2. Map provider learning requirements onto existing columns first.
3. Identify gaps that require new lifecycle, permissions, or audit semantics.
4. Add minimal migrations only for proven gaps.
5. Add RLS policies before exposing any UI/API path.
6. Backfill only redacted provider-level data.
7. Verify rollback/remediation path.

Candidate future tables, only if needed:

- `provider_registry`
- `provider_playbook_versions`
- `provider_capabilities`
- `provider_flow_observations`
- `provider_fixture_runs`
- `provider_field_mappings`
- `provider_learning_runs`
- `provider_promotion_reviews`

## Backend/API Plan

- Keep ChatGPT public MCP surface unchanged.
- Use verified auth/session/JWT identity for user-specific APIs.
- Ignore or overwrite client-sent `userId`.
- Keep web-only `/api/signup-intents` out of the MCP tool registry. Implement it as a normal authenticated HTTP route beside `/api/activity-finder/search` or as a Supabase Edge Function.
- Treat provider pages, signup URLs, cached content, and model output as untrusted.
- Add deterministic checks for unsafe actions before enabling any automation level above supervised preparation.
- Require server-verified parent confirmation before registration, payment, waiver acceptance, provider login, final submit, or destructive/write execution.
- Ensure audit events record parent confirmation, pause reason, policy decision, provider readiness, and run state.
- Keep learning APIs redacted and provider-focused.

## Frontend Plan

- Activity Finder: improve clarity of source, confidence, signup path, and next step.
- Autopilot: show safe prepared steps, pause boundaries, provider playbook, fixture status, and parent-only actions.
- Dashboard: show run status, pending parent action, provider readiness, and recent audit state.
- Credentials: keep parent-controlled, do not expose secrets to learning.
- Mandates: prepare future mandate review/revocation without enabling autonomous set-and-forget today.
- Discovery/Admin: expose provider readiness and redacted observations for operator review.

## Provider Learning Plan

- Start with existing playbooks for Active / ActiveNet, DaySmart / Dash, Amilia, CivicRec / RecDesk, CampMinder, and Generic beta.
- Use existing Chrome helper fixtures.
- Connect supervised `autopilot_runs` outcomes to discovery hints and program fingerprints where safe.
- Record redacted pause reasons and field mapping observations.
- Add fixture result tracking only if existing structures cannot represent it.
- Require human/operator promotion review.
- Require provider-specific tests before verified readiness.

## ChatGPT App Compatibility Test Plan

Run before and after any production phase:

- Public `ListTools` snapshot.
- Verify public tools are exactly `search_activities` and `register_for_activity`.
- Verify hidden/private/internal tools are not exposed.
- Public descriptor/schema/annotation diff.
- `mcp/manifest.json` diff.
- `mcp/openapi.json` diff.
- `public/.well-known/*` diff.
- OAuth discovery smoke.
- SSE smoke.
- OpenAI reviewer prompt smoke.
- Approval impact log update.

## Security Test Plan

- Verify backend derives identity from auth/session/JWT.
- Verify client-sent `userId` cannot access another user's data.
- Verify RLS for child, family, credentials, mandates, searches, runs, and learning records.
- Verify `mcp-executor` cannot invoke booking tools through unauthenticated/direct passthrough.
- Verify `run-plan` cannot execute without auth and server-verified confirmation.
- Verify automatic off-session Stripe charging cannot run without confirmation/mandate gates.
- Verify `target_url`, Stripe `success_url`, and Stripe `cancel_url` reject non-HTTPS, `javascript:`, `data:`, `blob:`, and non-allowlisted hosts.
- Verify raw request bodies, credentials, tokens, payment data, and child medical/allergy data are not logged.
- Verify provider page prompt-injection content cannot override policy.
- Verify model output cannot authorize sensitive actions.
- Verify payment, waiver, login, medical/allergy, and final submit boundaries pause.
- Verify audit logs record sensitive decisions.
- Verify redaction removes child data, credentials, tokens, payment data, and medical/allergy details.

## Release Plan

1. Complete docs-only readiness pass.
2. Capture ChatGPT compatibility guardrails and snapshots.
3. Complete read-only implementation audit and freeze final phase order.
4. Clean up reviewer-facing approval docs/evidence drift.
5. Implement backend safety gates for registration/payment/URL/PII before web polish.
6. Add signup intent data/RLS if needed for server-verified confirmation and audit.
7. Implement additive web P0 polish.
8. Adapt provider learning using existing infrastructure first.
9. Run targeted tests during development.
10. Run release candidate checks.
11. Deploy to Railway.
12. Smoke production web and MCP endpoints.
13. Update checklist and approval impact log.
14. Ship only if same-day cutoffs pass.

## Risks And Blockers

- Public/private MCP tool visibility regression.
- Accidental manifest, OpenAPI, OAuth, CSP, or `.well-known` changes.
- Client-sent `userId` trusted in web/API flows.
- UI consent treated as sufficient without server-verified confirmation.
- `mcp-executor` direct tool passthrough can invoke booking tools if not locked down.
- Automatic off-session Stripe charges run without confirmation/mandate gates.
- Raw `targetUrl` or Stripe redirect URLs accept unsafe schemes or hosts.
- Raw request, credential, token, payment, child, or medical/allergy data leaks through logs or learning artifacts.
- Provider learning stores sensitive family data.
- Provider roster remains fragmented across UI playbooks, MCP provider registry, and edge-function registry.
- UI copy overpromises set-and-forget before mandate/readiness gates.
- Missing RLS on new learning data.
- Provider fixtures too thin to support readiness promotion.
- Railway env drift.
- Worker health endpoint missing in Railway if `PORT` is not set.
- Reviewer-facing docs misstate live tool posture or canonical production URLs.
- Broad production code changes late in the same-day window.

## Same-Day Cutoff Decisions

Ship today only if:

- Public MCP surface remains unchanged.
- Web app P0 flow works for parent-supervised activity discovery and run preparation.
- Unsafe automation pauses for parent review.
- Provider learning is redacted and readiness-only.
- No autonomous payment, waiver, login, medical/allergy, or final submit is enabled.
- Auth/RLS checks pass for touched surfaces.
- Railway smoke checks pass.

Cut or defer if:

- It requires changing public MCP tools or OAuth.
- It requires new untested RLS-sensitive tables.
- It cannot be verified with targeted tests.
- It weakens parent confirmation.
- It stores sensitive provider learning artifacts.
