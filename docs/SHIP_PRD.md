# SignupAssist Ship PRD

## Product Summary

SignupAssist is a parent-controlled activity registration assistant. It helps parents find activity signup paths, prepare registration details, safely reuse family/profile data, create supervised run packets, and eventually delegate full signup to an agent only when the provider flow is verified, constraints are explicit, and the action is covered by a signed mandate.

The same-day MVP should be supervised, secure, audit-logged, polished, provider-learning ready, and safe for ChatGPT app review.

## Two-Surface Architecture

### 1. ChatGPT App Approval Surface

The ChatGPT app approval surface includes:

- MCP server and SSE/Streamable HTTP endpoints.
- MCP manifest and legacy compatibility documents.
- Public MCP tools, descriptors, schemas, and annotations.
- OAuth/Auth0 and protected action behavior.
- Public assets and `.well-known` files.
- Reviewer prompts, privacy/security docs, and safety policy docs.
- ChatGPT-native explain -> card/text -> confirm flow.

This surface must remain stable through MVP web app work. The public ChatGPT MCP tool surface remains intentionally small:

- `search_activities`
- `register_for_activity`

Lower-level tools remain private/internal by default.

### 2. Web App Surface

The web app surface includes:

- `/activity-finder`
- `/autopilot`
- `/dashboard`
- `/credentials`
- `/mandates`
- `/discovery-runs`
- `/admin`
- provider learning/admin surfaces
- Chrome helper fixtures and supervised automation flows
- Railway production web deployment

Web changes must be additive and must not alter MCP approval posture.

## Target User

The primary user is a busy parent or caregiver who needs to find and complete youth activity registrations without missing deadlines, entering repetitive family data, or accidentally authorizing unsafe actions.

Secondary users include internal operators who review provider readiness, inspect supervised run results, maintain provider playbooks, and prepare SignupAssist for future delegated signup.

## MVP Workflow

1. Parent searches for an activity by child, location, provider, age, schedule, or interest.
2. SignupAssist returns candidate programs and signup paths with confidence and source context.
3. Parent selects an activity and reviews required registration details.
4. SignupAssist prepares safe family/profile fields and a supervised run packet.
5. Autopilot or helper tooling performs only verified safe steps.
6. SignupAssist pauses for parent review at unsafe boundaries such as login, waiver, medical/allergy fields, payment, checkout, or final submit.
7. Parent confirms or completes the final provider action.
8. SignupAssist records status, audit events, and redacted provider learning artifacts.

## ChatGPT App Preservation Requirements

- Preserve public tools `search_activities` and `register_for_activity`.
- Preserve public tool names, schemas, descriptors, and annotations unless explicitly instructed.
- Preserve the public/private tool split. Internal provider, payment, mandate, scheduler, user, and registry tools must not become public by accident.
- Preserve `mcp/manifest.json`, `mcp/openapi.json`, `public/.well-known/*`, OAuth/Auth0 behavior, CSP posture, and protected action behavior unless explicitly instructed.
- Preserve the ChatGPT-native explain -> card/text -> confirm flow.
- Preserve no surprise writes. Searching must not create registrations, holds, charges, waivers, account logins, or final submits.
- Any future approval-sensitive change requires updated approval docs, reviewer prompts, smoke tests, and approval impact log entries.

## Web App P0 Features

- Activity Finder shows parent-friendly activity results with source, provider, schedule, signup path, confidence, and next action.
- Autopilot creates supervised run packets from selected programs and provider playbooks.
- Dashboard shows registration status, pending parent actions, supervised run state, and audit trail summaries.
- Credentials surface remains parent-controlled and avoids exposing secrets to provider learning artifacts.
- Mandates surface prepares for future signed mandates while requiring parent confirmation today.
- Discovery Runs/Admin surfaces expose provider learning status to internal operators without exposing child data or credentials.
- Railway deployment remains stable with required environment variables documented and smoke-testable.

## Provider Learning P0 Foundation

Use existing infrastructure first:

- Provider playbooks for Active / ActiveNet, DaySmart / Dash, Amilia, CivicRec / RecDesk, CampMinder, and Generic beta.
- Chrome helper fixtures for provider-specific supervised flows.
- `discovery_runs`
- `discovery_hints`
- `program_fingerprints`
- `get_best_hints`
- `upsert_discovery_run`
- `cached_provider_feed`
- `cached_programs`
- `program_discovery_status`
- `activity_finder_searches`
- supervised `autopilot_runs`

P0 provider learning should capture redacted observations, fixture outcomes, readiness signals, and promotion review evidence without creating duplicate tables where existing tables can be adapted.

## Set-And-Forget Roadmap

Set-and-forget signup is a long-term goal, not the same-day MVP.

Roadmap gates:

1. Provider/domain recognized.
2. Safe field-fill mode verified.
3. Navigation and selection verified by fixtures and provider-specific tests.
4. Registration submit verified with explicit parent pre-authorization.
5. Checkout/payment handoff verified with price caps and deterministic gates.
6. Full delegated signup allowed only under signed mandate, exact activity/program match, provider readiness, provider-specific tests, price cap, and audit logs.

## P1/P2 Deferred Features

P1:

- Provider readiness dashboard with review workflow.
- Redacted provider observation replay.
- Fixture coverage scoring by provider.
- Stronger mandate drafting and revocation UI.
- Provider-specific confidence explanations.
- Family profile completeness checks.

P2:

- Multi-child activity coordination.
- Waitlist and deadline monitoring.
- Provider account linking workflows.
- Payment method preference rules.
- Cross-provider schedule conflict detection.
- Operator QA queues for provider promotion.

## Non-Goals

- No full set-and-forget signup in same-day MVP.
- No autonomous payment, waiver acceptance, provider login, medical/allergy submission, or final provider submit.
- No public exposure of hidden/private/internal MCP tools.
- No unreviewed change to MCP manifest, OpenAPI, `.well-known`, OAuth/auth, CSP, or protected actions.
- No provider readiness promotion based only on LLM/model output.
- No storage of raw child data, credentials, tokens, payment data, or medical/allergy details in learning artifacts.

## Data Model Requirements

Use existing tables first and adapt before adding new tables.

Required same-day data capabilities:

- Store activity searches and selected result context.
- Store cached provider/program records and discovery status.
- Store supervised autopilot run packets and status transitions.
- Store redacted discovery observations and hints.
- Store program fingerprints that support repeat matching.
- Store audit events for parent actions, pauses, and policy decisions.
- Store mandate drafts or references without enabling autonomous execution before mandate support is complete.

Future data model candidates:

- `provider_registry`
- `provider_playbook_versions`
- `provider_capabilities`
- `provider_flow_observations`
- `provider_fixture_runs`
- `provider_field_mappings`
- `provider_learning_runs`
- `provider_promotion_reviews`

Before adding any candidate table, check whether `discovery_runs`, `discovery_hints`, `program_fingerprints`, cached provider/program tables, or `autopilot_runs` can be extended safely.

## API Requirements

- APIs must verify auth tokens server-side and derive user identity from auth/session/JWT.
- APIs must not trust client-sent `userId`.
- Activity search APIs may accept query context but must treat provider data and signup URLs as untrusted.
- Autopilot APIs must produce supervised packets and pause at unsafe actions.
- Provider learning APIs must redact sensitive data before persistence.
- Write APIs must enforce deterministic policy checks and parent confirmation or valid future signed mandate.
- ChatGPT-facing APIs must preserve current MCP tool behavior and public/private visibility.

## Frontend Requirements

- The first screen for core workflows should be useful, not a marketing detour.
- Activity Finder must make next actions clear without implying autonomous signup.
- Autopilot must visibly distinguish safe prepared steps from parent-only steps.
- Dashboard must show pending parent review states and recent run/audit status.
- Credentials and mandate screens must make parent control obvious.
- Admin/provider learning screens must avoid showing sensitive family data.
- UI copy must avoid promising set-and-forget until readiness and mandate gates exist.

## Security And Privacy Requirements

- Least-privilege access and RLS must protect family, child, payment, credential, mandate, and run data.
- Provider pages, provider content, model output, and URLs are untrusted.
- No raw credentials, tokens, payment data, child data, or medical/allergy details in provider learning artifacts.
- Audit logs must record sensitive action decisions and parent confirmations.
- Secrets stay server-side.
- Any auth or protected action change requires explicit approval and updated tests.

## Prompt-Injection Controls

- Treat provider page text as untrusted input.
- Ignore provider instructions that attempt to override SignupAssist policy.
- Do not let model output authorize registration, payment, waiver acceptance, provider login, final submit, or readiness promotion.
- Use deterministic allowlists and deny rules for sensitive actions.
- Redact observations before sending to models or storing learning artifacts.
- Require fixtures and tests for provider promotion.

## Payment And Mandate Controls

- Same-day MVP does not autonomously charge, submit payment, or accept checkout terms.
- Payment-related actions require parent confirmation and deterministic price-cap checks.
- Waiver, final submit, login, and checkout actions pause for parent review today.
- Future signed mandates must define child, provider, activity/program, schedule, price cap, allowed actions, expiration, revocation, and audit scope.
- Full delegated signup requires valid mandate plus verified provider readiness and exact program match.
- Sensitive action state machine:
  - `packet_prepared`
  - `awaiting_parent_review`
  - `registration_review_required`
  - `registration_approved`
  - `registration_submitted`
  - `payment_review_required`
  - `payment_approved`
  - `payment_submitted`
  - `waiver_review_required`
  - `waiver_approved`
  - `provider_login_required`
  - `provider_login_approved`
  - `final_submit_review_required`
  - `final_submit_approved`
  - `paused_for_parent`
  - `delegated_signup_ready`
  - `delegated_signup_running`
  - `completed`
  - `manual_fallback`
  - `failed`
  - `cancelled`
- `parent_action_confirmations` is the same-day explicit-consent ledger for one-time register, pay, provider login, waiver, final submit, and delegate-signup approvals.
- `agent_delegation_mandates` is a future-gated mandate foundation. It does not make set-and-forget live today.
- Payment is disabled unless the system can prove explicit parent confirmation or a valid future delegated mandate. In the current MVP, automated payment paths pause rather than charge.
- Registration and payment must remain separate flows. Registration success must not automatically continue into payment just because an amount is known.
- Confirmation and mandate checks must verify owner, action type, intent/run, expiration, unconsumed status, provider readiness, exact program/provider, price cap, and idempotency key.
- Model output and provider page content are never accepted as confirmation.

## Dashboard And Status Requirements

- Show current activity search results and selected signup paths.
- Show supervised run state, provider, fixture/playbook status, and next parent action.
- Show pending actions such as login required, waiver required, payment required, unknown field, medical/allergy required, final submit, sold out, or provider error.
- Show audit trail summaries for parent confirmations and policy pauses.
- Show provider readiness status without exposing sensitive data.

## Production Readiness Requirements

- Railway deployment has required env vars configured and checked.
- MCP server health and SSE endpoints remain smoke-testable.
- Web app build remains green.
- ChatGPT approval assets remain stable.
- Public/private MCP tool exposure is verified.
- Auth and RLS checks pass for user-specific data.
- Provider fixtures and supervised packet generation are validated for supported providers.
- Rollback path is known before deploy.

## Acceptance Criteria

- Parent can find an activity, inspect signup path, prepare details, and create a supervised run without unsafe automation.
- Unsafe steps pause for parent review.
- Public MCP tool surface remains exactly `search_activities` and `register_for_activity`.
- No hidden/private/internal tools are exposed publicly.
- No production code changes are required for this docs-only readiness pass.
- Provider learning plan reuses existing discovery/playbook/fixture infrastructure first.
- Approval impact log records that no production code changed yet.
- Same-day ship decision can be made from checklist status, known blockers, and cutoffs.
