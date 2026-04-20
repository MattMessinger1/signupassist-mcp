# SignupAssist Ship Checklist

## Pre-Code Checks

- [ ] Confirm target repo is `/Users/mattmessinger/Desktop/signupassist-mcp`.
- [ ] Confirm worktree state before edits.
- [ ] Confirm requested scope and allowed files.
- [ ] Confirm whether the change touches approval-sensitive files.
- [ ] Confirm no production code is changed in docs-only phases.
- [ ] Confirm blockers will be reported instead of hidden.

## ChatGPT App Approval Checks

- [ ] Public ChatGPT flow remains explain -> card/text -> confirm.
- [ ] No surprise writes are introduced.
- [ ] `mcp/manifest.json` unchanged unless explicitly approved.
- [ ] `mcp/openapi.json` unchanged unless explicitly approved.
- [ ] `public/.well-known/*` unchanged unless explicitly approved.
- [ ] OAuth/Auth0 behavior unchanged unless explicitly approved.
- [ ] CSP/resource template/widget posture unchanged unless explicitly approved.
- [ ] Reviewer docs and screenshots updated if approval behavior changes.
- [ ] `docs/APPROVAL_IMPACT_LOG.md` updated for every later phase.

## MCP Compatibility Checks

- [ ] Public `ListTools` response includes `search_activities`.
- [ ] Public `ListTools` response includes `register_for_activity`.
- [ ] Public `ListTools` response excludes lower-level internal tools.
- [ ] Public tool descriptors unchanged unless explicitly approved.
- [ ] Public tool schemas unchanged unless explicitly approved.
- [ ] Public tool annotations unchanged unless explicitly approved.
- [ ] Consequential action semantics preserved for registration flow.
- [ ] Read-only semantics preserved for activity search flow.
- [ ] MCP SSE smoke passes before release.

## Public/Private MCP Tool Exposure Check

- [ ] Public tool surface is exactly `search_activities` and `register_for_activity`.
- [ ] Internal provider tools remain hidden/private.
- [ ] Internal Stripe/payment tools remain hidden/private.
- [ ] Internal mandate tools remain hidden/private.
- [ ] Internal scheduler tools remain hidden/private.
- [ ] Internal user/profile tools remain hidden/private.
- [ ] Internal registration management tools remain hidden/private.
- [ ] No diagnostic flag exposes private tools in production reviewer flows.

## Web App Checks

- [ ] `/activity-finder` supports parent-supervised search and signup path review.
- [ ] `/autopilot` creates supervised run packets and shows pause boundaries.
- [ ] `/dashboard` shows current status and pending parent actions.
- [ ] `/dashboard` groups runs by ready, opening soon, scheduled, paused, completed, and fallback states.
- [ ] `/dashboard` shows provider readiness, readiness score, price cap, reminder state, and last redacted audit event per run.
- [ ] `/credentials` remains parent-controlled.
- [ ] `/mandates` does not imply full delegation is active today.
- [ ] `/discovery-runs` shows redacted provider learning status only.
- [ ] `/admin` avoids exposing sensitive family data.
- [ ] `/chat-test`, `/mcp-chat-test`, `/flow-test`, `/disambiguation-demo`, and mockup routes are hidden unless test routes are explicitly enabled.
- [ ] No MCP bearer token is configured as a production `VITE_*` frontend variable.
- [ ] Web copy does not overpromise set-and-forget.
- [ ] Web changes are additive and do not alter ChatGPT MCP approval posture.

## Migration Checks

- [ ] Existing tables reviewed before proposing new tables.
- [ ] `discovery_runs` considered for observations.
- [ ] `discovery_hints` considered for reusable hints.
- [ ] `program_fingerprints` considered for deterministic program matching.
- [ ] Cached provider/program tables considered for provider inventory context.
- [ ] `autopilot_runs` considered for supervised run outcomes.
- [ ] New migrations are minimal and justified.
- [ ] Rollback/remediation path documented.

## Auth/RLS Checks

- [ ] Backend derives user identity from auth/session/JWT.
- [ ] Client-sent `userId` is ignored or overwritten for user-specific data.
- [ ] User A cannot read or patch User B's signup intent.
- [ ] User A cannot attach User B's child profile or autopilot run to a signup intent.
- [ ] User A cannot use User B's mandate or parent action confirmation.
- [ ] RLS protects child and family data.
- [ ] RLS protects credentials and tokens.
- [ ] RLS protects mandates and audit logs.
- [ ] RLS protects searches and autopilot runs.
- [ ] RLS protects provider learning records that could reveal user activity.
- [ ] Cross-user access tests pass for touched APIs.

## UI Checks

- [ ] Parent can identify provider, activity, schedule, price, and next step.
- [ ] Unsafe actions are clearly marked as parent review required.
- [ ] Run cards provide Review, Resume, View audit, Open provider, and supported cancel affordances.
- [ ] Reminder copy is honest when automation is only prepared and manual reminder is recommended.
- [ ] Loading, empty, error, and unavailable-provider states are handled.
- [ ] Mobile and desktop layouts do not overlap text or controls.
- [ ] Buttons and confirmations use clear action labels.
- [ ] Admin/provider learning screens distinguish beta vs verified readiness.

## Security Checks

- [ ] Provider pages are treated as untrusted data.
- [ ] Signup URLs are treated as untrusted data.
- [ ] Target URL validator rejects invalid protocols, localhost, private IP ranges, metadata IPs, internal hostnames, and unsafe redirect chains.
- [ ] Server-side code does not fetch unknown target URLs unless resolved IPs are validated.
- [ ] Model output is treated as advisory only.
- [ ] Prompt-injection attempts cannot override policy.
- [ ] Provider prompt-injection fixtures cannot authorize pay, submit, accept waiver, exfiltrate child data, change price cap, use hidden URLs, or promote readiness.
- [ ] Sensitive actions require deterministic policy checks.
- [ ] Audit logs capture parent confirmations and policy pauses.
- [ ] Visible audit summaries redact DOB, phone, address, medical/allergy notes, credentials, tokens, and payment data.
- [ ] Provider learning observations redact child PII, credentials, tokens, provider password fields, payment data, medical/allergy notes, and raw provider page content.
- [ ] Route-query tests confirm `/autopilot` handoff includes only `intent=<id>`.
- [ ] Basic security headers are present on API responses.
- [ ] Production CORS allowlist is configured for web-only APIs when `CORS_ALLOW_ORIGINS` or equivalent env is set.
- [ ] Lightweight rate limits cover auth-sensitive web APIs when rate limiting is enabled.
- [ ] Secrets stay server-side.
- [ ] Error messages do not leak sensitive data.

## Provider Learning Checks

- [ ] Existing playbooks are used first.
- [ ] Chrome helper fixtures are used first.
- [ ] Learning artifacts are redacted.
- [ ] Provider readiness levels are represented consistently.
- [ ] Provider automation policy is displayed separately from readiness.
- [ ] CampMinder live browser automation is blocked unless written provider/camp permission or approved API access is recorded.
- [ ] Playwright/browser automation is limited to SignupAssist-owned web proof, fixtures, explicit sandbox/test accounts, or parent-supervised assist.
- [ ] Beta-to-verified promotion requires fixture evidence.
- [ ] Promotion requires human/operator review.
- [ ] Provider readiness cannot be promoted by model output alone.
- [ ] Learning does not alter ChatGPT public tool behavior.

## Payment Gate Checks

- [ ] No autonomous payment is enabled in same-day MVP.
- [ ] Price cap checks exist before future payment automation.
- [ ] Checkout/payment handoff pauses for parent review today.
- [ ] Payment data is never stored in learning artifacts.
- [ ] Success fee/refund behavior remains behind existing protected actions.
- [ ] Stripe webhook endpoints point to the current Supabase project/function URLs for the active launch mode.
- [ ] Stripe webhook signing secret is configured in the target runtime and Supabase Edge Function secrets.

## Privacy/Legal Checks

- [ ] Privacy policy remains accurate.
- [ ] Safety policy remains accurate.
- [ ] Review test account docs remain accurate.
- [ ] Child data is minimized.
- [ ] Medical/allergy details are not stored in learning artifacts.
- [ ] Credentials, tokens, and payment data are not stored in learning artifacts.
- [ ] Waiver acceptance requires parent review unless future mandate gates are complete.

## Railway/Env Checks

- [ ] Required Railway env vars are documented.
- [ ] `npm run env:check` passes before release.
- [ ] `npm run infra:check` passes before release.
- [ ] Railway smoke checks pass when run.
- [ ] Production MCP base URL remains correct.
- [ ] Public manifest URLs remain correct.

## Smoke Checks

- [ ] `npm run build` passes before production release.
- [ ] `npm run mcp:build` passes before production release.
- [ ] `npm test` passes or documented targeted substitute is approved.
- [ ] `npm run test:security-mvp` passes before launch.
- [ ] `npm run test:golden-path` passes before launch.
- [ ] `npm run test:chatgpt-golden-path` passes before ChatGPT-impacting release.
- [ ] `npm run test:sse` passes before ChatGPT-impacting release.
- [ ] `npm run test:openai-smoke` passes before ChatGPT-impacting release.
- [ ] Activity Finder smoke passes.
- [ ] Autopilot supervised packet smoke passes.
- [ ] Dashboard status smoke passes.

## Golden Path Evidence

- [ ] Activity Finder search proof captured for desktop and mobile.
- [ ] Activity Finder result includes provider, status, readiness/trust copy, confidence, and freshness where available.
- [ ] Network proof shows `POST /api/activity-finder/search` with only the search query and optional bearer token.
- [ ] Network proof shows `POST /api/signup-intents`.
- [ ] Browser URL proof shows `/autopilot?intent=<uuid>` with no query, child/profile, provider, target URL, activity, age, grade, address, or location details.
- [ ] Autopilot proof shows the loaded intent, safety limits, provider readiness, reminder copy, redacted learning choice, and review/create step.
- [ ] Created run proof shows the duplicate-create path replaced by dashboard handoff.
- [ ] Dashboard proof shows the run in the appropriate status section with redacted last audit event.
- [ ] `/mandates` proof shows no raw JWS, token, credential identifier, or unredacted metadata.
- [ ] Redacted DB proof captured with `npm run evidence:release -- --signup-intent-id=<id> --pretty`.
- [ ] No live third-party provider automation was used for proof unless an approved sandbox/API/written permission path is documented.

## Final Deploy Checks

- [ ] Diff contains only intended files.
- [ ] Approval impact log is updated.
- [ ] Ship checklist status is reviewed.
- [ ] Same-day cutoff decisions are applied.
- [ ] Rollback path is known.
- [ ] Railway deploy completes.
- [ ] Production web smoke passes.
- [ ] Production MCP smoke passes.
- [ ] Final summary includes changed files, tests run, blockers, and follow-up prompt.
