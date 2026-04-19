# SignupAssist Production Runbook

This is the canonical runbook for finishing and proving the web app MVP without regressing the ChatGPT app approval surface.

The old tryable MVP runbook is historical. Use this file for production readiness, web golden-path verification, evidence capture, and final stabilization.

## Current State

Canonical production URL:

- `https://signupassist.shipworx.ai/`

Current product surfaces to verify:

- `/activity-finder`
- `/autopilot`
- `/dashboard`
- `/discovery-runs`
- `/mandates`
- `/privacy`
- `/terms`
- `/safety`

Current ChatGPT MCP URL:

- `https://signupassist.shipworx.ai/sse`

Current public MCP tool surface:

- `search_activities`
- `register_for_activity`

These public tool names, schemas, descriptors, annotations, and public/private exposure posture must remain stable unless an explicit approval-surface change is requested and documented.

## Completed Phase Ledger

The implementation evidence lives in `docs/APPROVAL_IMPACT_LOG.md`. Treat that file as the detailed audit trail. Current completion state:

- Prompt 5, Activity Finder UX: complete. `/activity-finder` is polished, responsive, and preserves the secure `signup_intent_id` handoff.
- Prompt 6, Autopilot wizard: complete. `/autopilot?intent=<id>` loads intent data and supports a supervised setup wizard.
- Prompt 7, provider learning foundation: complete. Existing playbooks and fixtures are reused first; provider learning remains redacted and web/backend/admin only.
- Prompt 8, dashboard/status/audit/reminder polish: complete. `/dashboard` groups runs by meaningful parent next action and surfaces readiness, reminder, and redacted audit state.
- Prompt 9, sensitive action gates and future mandates: complete. Registration, payment, provider login, waivers, final submit, and delegation are gated by deterministic confirmation/mandate checks.
- Prompt 10, security/privacy regression suite and URL safety: complete. URL safety, prompt-injection, IDOR/BOLA, route-query, and redaction checks exist.
- Prompt 11, ChatGPT review hardening: materially complete. Submission docs, legal pages, child-safe language, reviewer flow parsing, Stripe setup recovery, and final Bookeo booking proof have been addressed.

Remaining work is production proof and stabilization, not broad feature building.

## Non-Negotiable Approval Guardrails

Before any web-app work, restate and verify these guardrails:

- Public MCP tools remain exactly `search_activities` and `register_for_activity`.
- Hidden/private/internal provider, payment, mandate, scheduler, user/profile, registration management, registry, and diagnostic tools must not be exposed.
- Do not change `mcp/manifest.json`, `mcp/openapi.json`, `public/.well-known/*`, OAuth/Auth0/auth behavior, CSP/widget/resource metadata, protected actions, tool names, tool schemas, tool descriptors, or tool annotations unless explicitly approved.
- If any approval-sensitive file changes, update `docs/APPROVAL_IMPACT_LOG.md` and run ChatGPT compatibility checks.
- Preserve no-widget V1 posture unless a future prompt explicitly asks for widgets and includes screenshot/CSP/reviewer updates.
- Preserve parent/guardian child-safe positioning. SignupAssist is adult parent/guardian-controlled, not child-directed, and not for adult-only activities.
- Do not collect personal information about children under 13 in ChatGPT. General age/grade may be used for search.
- Keep final ChatGPT booking confirmation explicit. Generic "yes" must not book; final confirmation requires exact `book now` plus the ChatGPT permission card flow.

Required approval checks:

```bash
npm run test:chatgpt-app
npm run test:approval-snapshots
npm run test:mcp-manifest
npm run test:mcp-descriptors
git diff --check
```

## Production Readiness Gate

Release only when the operator can show:

- Clean worktree and known commit.
- Strict env checks pass for the relevant targets.
- Frontend build and MCP build pass.
- Security MVP tests pass.
- ChatGPT compatibility snapshots pass.
- Railway web health is green.
- Worker health is either green or explicitly marked non-blocking for this release.
- Legal pages are deployed and match the current child-safe parent/guardian posture.
- The dual golden paths have fresh evidence.

Pre-deploy commands:

```bash
git status --short
git rev-parse HEAD

npm run env:list -- --target=frontend
npm run env:list -- --target=railway-web
npm run env:list -- --target=railway-worker
npm run env:list -- --target=supabase-functions

npm run env:check -- --target=frontend --strict
npm run env:check -- --target=railway-web --strict
npm run env:check -- --target=railway-worker --strict
npm run env:check -- --target=supabase-functions --strict

npm run typecheck
npx tsc -p tsconfig.app.json --noEmit
npm run mcp:build
npm run build
npm run test:security-mvp
npm run test:golden-path
npm run test:authz-audit
npm run test:chatgpt-app
npm run test:approval-snapshots
npm run test:mcp-manifest
npm run test:mcp-descriptors
git diff --check
```

The one-command release gate equivalent is:

```bash
npm run predeploy:release
```

`npm run predeploy:check` is a broader legacy preflight that includes broad `npm run test`; do not treat it as the complete release gate unless it is paired with the ChatGPT guardrails and `git diff --check`.

Broad `npm run lint` and broad `npm run test` may still expose pre-existing failures. Do not hide them. Classify failures as introduced, pre-existing, or unknown.

## Environment Targets

Use `scripts/envRegistry.ts` and `scripts/envDoctor.ts` as the source of truth.

Railway web required variables include:

- `MCP_ACCESS_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`
- `OPENAI_API_KEY`
- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_AUDIENCE`

Railway web production-significant recommended variables include:

- `MANDATE_SIGNING_KEY`
- `PII_ENCRYPTION_KEY`

Railway worker required variables include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKEO_API_KEY`
- `BOOKEO_SECRET_KEY`

Frontend required variables include:

- `VITE_MCP_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Treat `VITE_MCP_ACCESS_TOKEN` carefully because Vite exposes it to the browser. Use only low-risk dev/test tokens if it is configured.

Supabase functions required variables include:

- `MCP_SERVER_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MANDATE_SIGNING_KEY`

## Railway And Production Smoke

After deploy, capture:

```bash
export RAILWAY_MCP_URL=https://signupassist.shipworx.ai

curl -fsS "$RAILWAY_MCP_URL/health"
curl -fsS "$RAILWAY_MCP_URL/status"
curl -fsS "$RAILWAY_MCP_URL/identity"

RAILWAY_MCP_URL="$RAILWAY_MCP_URL" npm run infra:smoke:railway
MCP_SERVER_URL="$RAILWAY_MCP_URL" \
MCP_ACCESS_TOKEN="$MCP_ACCESS_TOKEN" \
MCP_ALLOW_UNAUTH_READONLY_TOOLS=true \
npm run test:sse
```

If secrets are available locally or in CI, also run:

```bash
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
npm run infra:smoke:supabase

STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
STRIPE_AUTOPILOT_PRICE_ID="$STRIPE_AUTOPILOT_PRICE_ID" \
STRIPE_SMOKE_REQUIRE_WEBHOOK=1 \
npm run infra:smoke:stripe

MCP_SERVER_URL="$RAILWAY_MCP_URL" \
MCP_ACCESS_TOKEN="$MCP_ACCESS_TOKEN" \
E2E_USER_ID="$E2E_USER_ID" \
npm run test:e2e
```

Railway-specific risks to check:

- Confirm Railway uses the intended Dockerfile/build path. `railway.json` has an echo build command, so do not assume it is the real build.
- Confirm Railway is Dockerfile-driven for this app; the Docker build copies `package.production.json` over `package.json`, so production runtime behavior follows the production manifest in the container.
- Confirm the web service start command actually launches the MCP server.
- Confirm the worker service start command launches the scheduled worker if the worker is in scope for this release.
- Confirm `/identity` or deploy metadata maps to the commit being released.
- If worker execution touches real registrations, pause worker first during rollback triage.

## Third-Party Provider Automation Policy

Playwright and browser automation are approved for SignupAssist-owned web proof, redacted/local provider fixtures, explicit sandbox or test provider accounts, and parent-supervised browser assist where unsafe steps pause.

Do not use Playwright to run unattended live CampMinder or other third-party provider signups unless the provider or specific camp gives explicit written authorization or an approved API path exists.

Provider automation policy statuses:

- `unknown`
- `fixtures_only`
- `supervised_browser_only`
- `api_authorized`
- `written_permission_required`
- `written_permission_received`
- `prohibited`
- `legal_review_required`

Current policy posture:

- CampMinder: `written_permission_required`. Fixture checks, provider recognition, readiness display, redacted learning, supervised run packets, and parent-supervised assist are allowed. Unattended live browser login, application submit, payment, waiver acceptance, final submit, or timing-based registration are blocked until written provider/camp permission or an approved API path is recorded.
- Other large providers: `legal_review_required` unless a later provider-specific review records API authorization, written permission, or prohibition.
- Generic providers: `fixtures_only` until a provider-specific policy exists.

Required live-provider stop conditions:

- provider terms, automation permission, or official API authorization is unclear
- login, MFA, CAPTCHA, bot challenge, or credential prompt
- waiver, legal agreement, or policy acceptance
- payment, card field, checkout, or provider charge confirmation
- final submit, register, book, purchase, or equivalent irreversible action
- medical, allergy, PHI-like, or unknown sensitive fields
- provider page content claiming the user approved an action

CampMinder reference posture:

- Public CampMinder terms require written consent for automated/electronic access patterns that live browser automation may trip.
- CampMinder has an API-key path, which should be preferred over live browser automation.
- Sources to review before changing status:
  - `https://campminder.pactsafe.io/versions/62ba16aa5f5a4316a760997e.pdf`
  - `https://help.campminder.com/en/articles/6988427-get-to-know-campminder-api`

## Dual Golden Paths

The MVP is not production-proven until both golden paths are freshly verified.

### ChatGPT Reviewer Golden Path

Use a fresh ChatGPT chat for each test case. The test account should not require MFA, SMS verification, email verification loops, or private-network access.

Verify:

1. Browse AIM Design programs.
   - Prompt: `Use SignupAssist to show me programs at AIM Design.`
   - Expected tool: `search_activities`.
   - Expected result: child-safe youth program results, no booking, no payment.

2. Age-filtered browse.
   - Prompt: `Use SignupAssist to find robotics classes for my 9 year old at AIM Design.`
   - Expected tool: `search_activities`.
   - Expected result: relevant youth/robotics result if available, no booking, no payment.

3. Start signup.
   - Prompt: `Use SignupAssist to sign my child up for a class at AIM Design.`
   - Expected tool: `register_for_activity`.
   - Expected result: OAuth if needed, then Step 1/5 program list.

4. Complete connected Bookeo signup.
   - Select an available program.
   - Use synthetic adult parent/account-holder data.
   - Use synthetic participant data, preferably age 13 or older when compatible with the selected program.
   - Complete Stripe-hosted payment setup if prompted.
   - Confirm final review summary.
   - Type `book now`.
   - Approve the final ChatGPT permission card.
   - Expected result: Bookeo booking confirmation/receipt only after final confirmation.

5. Adult-only safety.
   - Prompt: `Use SignupAssist to sign me up for a wine tasting class for adults only.`
   - Expected result: decline or redirect as out of scope, no adult-only signup, no booking, no payment.

6. Negative no-trigger prompts.
   - `What's a good recipe for chicken parmesan?`
   - `Find me the best laptop under $1000.`
   - `Summarize the difference between Agile and Scrum.`
   - Expected result: SignupAssist does not trigger.

Evidence:

- Chat URLs or screenshots.
- Tool invoked.
- Booking number if final booking is completed.
- Stripe test evidence if Stripe setup is completed.
- Cancellation/refund evidence if a final booking is later cleaned up.

### Web Parent Golden Path

Use a clean browser session or incognito profile. Record account, deploy SHA, browser, viewport, and timestamp.

1. Visit `/activity-finder`.
2. Search for a youth activity, for example: `soccer at Keva in Madison for age 9`.
3. Verify results render with provider, status badge, match details, readiness/trust copy, and parent-controlled language.
4. Select a valid result.
5. Confirm the app creates a server-side signup intent.
6. Confirm browser navigates to `/autopilot?intent=<uuid>`.
7. Confirm the URL does not include:
   - finder query
   - activity
   - venue
   - address
   - age
   - grade
   - location
   - `targetUrl`
   - provider name/key
   - child/profile data
8. Confirm `/autopilot?intent=<uuid>` loads intent data in page state/body.
9. Complete the seven-step supervised Autopilot wizard:
   - Activity
   - Provider
   - Child/Profile
   - Timing and reminder
   - Safety limits
   - Provider learning
   - Review and create
10. Create a supervised run packet.
11. Confirm the signup intent updates to `scheduled` or the expected post-create status.
12. Confirm `autopilot_run_id` is linked when practical.
13. Visit `/dashboard`.
14. Confirm the run appears in the expected section with provider readiness, price cap, reminder state, last redacted audit event, and parent CTAs.
15. Visit `/discovery-runs`.
16. Confirm provider readiness and fixture/promotion copy are visible without child PII.
17. Visit `/mandates`.
18. Confirm audit/mandate copy does not imply full unattended delegation is live.

Evidence:

- Desktop screenshot of Activity Finder search results.
- Mobile screenshot of Activity Finder search results.
- Screenshot of `/autopilot?intent=<uuid>` showing loaded intent.
- Screenshot of Autopilot safety limits.
- Screenshot of Autopilot provider learning step.
- Screenshot of Autopilot review/create step.
- Screenshot of Dashboard run card.
- Screenshot of Discovery Runs provider readiness.
- Network evidence for:
  - `POST /api/activity-finder/search`
  - `POST /api/signup-intents`
  - `GET /api/signup-intents/:id`
  - `PATCH /api/signup-intents/:id`
- Redacted DB evidence for:
  - `activity_finder_searches`
  - `signup_intents`
  - `signup_intent_events`
  - `autopilot_runs`

Never capture or commit secrets, child PII, credentials, tokens, raw card/payment data, medical/allergy notes, or provider passwords.

## Web Safety Regression Checks

Run or manually verify:

- Signed-out Activity Finder continue redirects safely to auth.
- User A cannot read or patch User B's signup intent.
- User A cannot access User B's child profile, run, mandate, or confirmation.
- Unsafe target URLs are rejected.
- Provider page content and model output cannot authorize registration, payment, waiver acceptance, provider login, final submit, price-cap change, or provider readiness promotion.
- Payment and final submit remain paused unless explicit confirmation or valid future mandate gates pass.
- Visible audit/provider-learning summaries redact child DOB, address, phone, medical/allergy notes, credentials, tokens, and payment data.

Recommended command:

```bash
npm run test:security-mvp
```

## Evidence Pack Template

Use an untracked evidence folder or external storage. Do not commit raw evidence unless it is explicitly redacted and intended for docs.

```bash
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
mkdir -p "evidence/$RELEASE_ID"

git status --short | tee "evidence/$RELEASE_ID/git-status.txt"
git rev-parse HEAD | tee "evidence/$RELEASE_ID/git-commit.txt"

curl -fsS "https://signupassist.shipworx.ai/health" | tee "evidence/$RELEASE_ID/health.json"
curl -fsS "https://signupassist.shipworx.ai/status" | tee "evidence/$RELEASE_ID/status.json"
curl -fsS "https://signupassist.shipworx.ai/identity" | tee "evidence/$RELEASE_ID/identity.json"

npm run test:chatgpt-app 2>&1 | tee "evidence/$RELEASE_ID/test-chatgpt-app.log"
npm run test:approval-snapshots 2>&1 | tee "evidence/$RELEASE_ID/test-approval-snapshots.log"
npm run test:security-mvp 2>&1 | tee "evidence/$RELEASE_ID/test-security-mvp.log"
npm run test:golden-path 2>&1 | tee "evidence/$RELEASE_ID/test-golden-path.log"
```

Before sharing evidence, redact:

- service role keys
- bearer tokens
- OAuth credentials
- Stripe secrets
- Bookeo secrets
- child/family PII
- card/payment data
- provider credentials
- medical/allergy notes

## Stabilization Ledger

Known pre-existing or previously observed issues:

- Broad `npm run lint` may fail on pre-existing lint debt outside the current pass.
- Broad `npm run test` may fail on known pre-existing telemetry/debug assertions.
- `mcp_server/providers/stripe.ts` has pre-existing lint issues if linted directly.
- `mcp_server/worker/scheduledRegistrationWorker.ts` has pre-existing `no-explicit-any` and stale `eslint-disable` issues.
- Production logs previously showed `user.list_children` falling back because `children.first_name_encrypted` was missing.
- Production logs previously showed `registrations.create` retrying because `provider_amount_due_cents` was missing, but registration creation recovered.
- Provider learning persistence to `discovery_runs` is not fully wired; current web path stores provider learning posture in `autopilot_runs.caps.provider_learning`.
- Lightweight golden-path contract tests are checked in under `npm run test:golden-path`. Full screenshot/browser evidence remains a release evidence task because it depends on the deployed app and authenticated test account.

Launch blockers:

- Public MCP surface changes unexpectedly.
- Hidden/private/internal tools are exposed publicly.
- `/activity-finder` -> `/autopilot` leaks sensitive route query data.
- User ownership/RLS checks fail.
- Payment, waiver, provider login, or final submit can execute without explicit confirmation or valid mandate.
- Provider learning stores child PII, credentials, tokens, payment data, raw provider page content, or medical/allergy details.
- Production legal pages are stale or contradict the child-safe parent/guardian posture.
- Railway production health fails and cannot be explained as non-blocking.

Acceptable residual risks if documented:

- Broad lint debt unrelated to touched files.
- Broad test debt unrelated to touched files.
- Worker health unavailable only if worker is explicitly out of release scope.
- Provider learning persistence deferred if readiness is still visible and redacted.
- Manual reminder copy if automated reminders are not fully configured.

## Rollback

Urgent incident:

1. Use Railway dashboard rollback to the last healthy deploy.
2. Verify `/health`, `/status`, and `/identity`.
3. Re-run `infra:smoke:railway`, `test:sse`, and ChatGPT compatibility checks.
4. If worker behavior could affect real registrations, pause worker first.

Code regression:

1. `git revert <bad_sha>`
2. Push to the Railway-connected branch.
3. Verify `/identity` shows the expected commit.
4. Re-run production smoke.

Env regression:

1. Restore previous Railway/Supabase env values.
2. Rebuild frontend if any `VITE_*` variable changed.
3. Re-run env checks and production smoke.

Schema regression:

1. Prefer a forward migration.
2. Do not run destructive rollback without explicit review.
3. Verify RLS and ownership tests after remediation.

## Prompt-Sized Implementation Queue

Use these prompts one at a time. Commit after each successful chunk.

### Prompt A: Browser Golden-Path Test Foundation

Add lightweight browser verification for Activity Finder and URL safety. Cover Activity Finder first-run, loading, backend error, missing detail, `needs_signup_link`, tested fast path, signed-out redirect, and `autopilot?intent=<id>` query-only navigation. Do not change MCP tools, manifest, OpenAPI, `.well-known`, OAuth/Auth0, CSP, or protected actions. Append `docs/APPROVAL_IMPACT_LOG.md`. Run targeted browser tests, ChatGPT compatibility snapshots, and `git diff --check`. Commit as `test: add web golden path browser foundation`.

### Prompt B: Authenticated Web Golden Path

Add or document a safe authenticated fixture for web MVP verification. Verify Activity Finder creates a server-side signup intent, Autopilot loads it, a supervised run packet can be created with an active subscription fixture, the signup intent links to the run, and Dashboard shows the run with redacted audit state. Do not expose secrets or PII. Commit as `test: add authenticated web golden path`.

### Prompt C: Redacted Evidence Helper

Add a script that accepts `signup_intent_id` and/or `autopilot_run_id` and prints only redacted evidence rows for release review. It must never print child PII, credentials, tokens, payment data, medical/allergy notes, provider passwords, or raw provider page content. Commit as `chore: add redacted release evidence helper`.

### Prompt D: Dashboard And Provider Learning Verification

Add seeded verification for Dashboard sections, provider readiness, redacted audit summaries, and `/discovery-runs` provider readiness cards. If provider learning persistence to `discovery_runs` is not wired, document that as deferred rather than inventing duplicate tables. Commit as `test: verify dashboard and provider readiness`.

### Prompt E: Production Readiness Evidence

Run the final command matrix, production URL checks, Railway/Supabase/Stripe smokes where credentials are available, and browser screenshots. Record blockers and update docs only. Commit as `docs: record production readiness evidence`.

### Prompt F: Final Stabilization

Fix introduced failures only. Classify broad failures as introduced, pre-existing, or unknown. Confirm only intentional approval-sensitive files changed, public MCP tools remain exactly `search_activities` and `register_for_activity`, and hidden/private/internal tools are not exposed. Commit as `chore: stabilize web app release candidate`.

## Approval Impact Protocol

Every later phase must append to `docs/APPROVAL_IMPACT_LOG.md`:

- files changed
- whether approval-sensitive files changed
- whether public MCP tool names changed
- whether public MCP schemas/descriptors/annotations changed
- whether hidden/private/internal tools were exposed
- whether manifest/OpenAPI/.well-known/OAuth/CSP/protected actions changed
- tests run
- production smoke status, if applicable
- blockers and residual risk
