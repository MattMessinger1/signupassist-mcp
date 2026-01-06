# Agent Session Log (durable resume notes)

This file exists because chat sessions can get cut off. It is the **repo source of truth** for “where we left off” and how to resume.

## Safety / security

- **Never** paste secrets here (tokens, API keys, Stripe links, Auth0 secrets, Supabase service role key, etc.).
- Keep any IDs redacted unless they’re harmless (use `xxxx...`).

---

## 2025-12-30 — Production hardening + Stripe + timezone standardization

### What we shipped (high signal)

- **Stripe Checkout return finalization for ChatGPT flows**
  - Problem: users complete Stripe Checkout but don’t return through our web frontend, so `user_billing` may not update.
  - Fix: `GET /stripe_return?...` now calls Supabase edge function `stripe-checkout-success` to write `user_billing.default_payment_method_id` (and last4/brand when available).
  - Follow-up fix: corrected route nesting so `/stripe_return` actually runs (was previously being shadowed by SPA routing due to a brace/route-block issue).

- **Payment gating: first principles**
  - Problem: orchestrator treated “card on file” as `cardLast4` presence, which is a display-only nice-to-have.
  - Fix: gate on **source of truth**: `user_billing.default_payment_method_id` (`hasPaymentMethod`) instead of requiring last4/brand.

- **Timezone standardization**
  - Standard: **store/compute in UTC**, **display using `userTimezone`** (IANA string) with UTC fallback.
  - Removed server-local `toLocaleString()` formatting in the orchestrator.
  - Updated message templates to format times via user timezone instead of relying on server locale.

- **V1 UX hardening (first-time + returning)**
  - First-time users see a **one-time trust/safety intro** (responsible delegate, Stripe-hosted payment entry, audit trail).
  - Step 2/5 is **schema-driven**: collect all required fields via micro-questions (no schema dumps), and only ask for what’s missing.
  - Returning users are **prefilled** from Supabase (`delegate_profiles`, `children`, `user_billing`) to reduce friction.

- **Receipts reliability (REG)**
  - Fixed a production failure mode where `stripe.charge_success_fee` could return a non-UUID `charge_id` (e.g. `'unknown'`), which breaks FK inserts into `registrations`.
  - Fixed a production migration mismatch where `registrations.create` could fail if `provider_*` columns weren’t present yet; tool now retries without those fields.

### Evidence / current behavior

- Stripe test card flow works via hosted Checkout (no card input in chat), and `user_billing` can reflect `visa •••• 4242` after `/stripe_return` finalization.
- Program browse messages already use `formatTimeForUser(...)` for schedule/open times, respecting `userTimezone`.
- Book-now flow produces:
  - a `REG-xxxxxxxx` receipt in “view receipts”
  - an audit trail via `audit REG-xxxxxxxx` that includes `bookeo.confirm_booking` and `stripe.charge_success_fee`
- **Scheduled worker real execution verified (prod)**
  - Before fix: `SCH-a8b5f41c` failed with `Invalid phone number type` (Bookeo rejected our `phoneNumbers` payload).
  - Fix deployed: omit `customer.phoneNumbers` in Bookeo booking payloads (phone is optional in v1).
  - After fix: `SCH-6f18f5ab` completed and linked to receipt `REG-a1cae43f` (`view receipts` shows `SCH-6f18f5ab … → receipt REG-a1cae43f`; `audit REG-a1cae43f` shows `scheduler.schedule_signup`, `bookeo.confirm_booking`, `stripe.charge_success_fee`).
- App Store readiness checks (prod):
  - `/.well-known/openai-apps-challenge` returns 200 when `OPENAI_VERIFICATION_TOKEN` is set
  - `GET /sse` returns **401** with `WWW-Authenticate: Bearer ...` to trigger OAuth in ChatGPT preview
  - **ChatGPT Preview UX hardening**: fixed a common “Step 1 restart” failure mode when the user answers an off-script question (e.g., “11”) while a program list is on screen. We now keep the user in-flow and prompt for a valid class selection instead of falling back to a generic “what are you looking for?” prompt.

### Commits deployed today (for traceability)

- `fix(stripe): finalize checkout on /stripe_return for ChatGPT flows`
- `fix(stripe): make /stripe_return reachable (routing brace fix)`
- `fix(payment): gate on hasPaymentMethod (default_payment_method_id) not last4`
- `chore(time): store/compute UTC, format dates via userTimezone`
- `feat(ux): trust intro + returning prefill; fix FORM_FILL + booking status`
- `fix(ux): keep submit_form payload in sync with delegate/child prefills`
- `fix(stripe): don't return 'unknown' charge_id (breaks receipts FK)`
- `fix(registrations): retry create without provider_* fields when schema lags`
- `fix(bookeo): omit phoneNumbers from booking payloads (avoids “Invalid phone number type”)`
- `fix(chat): prevent ChatGPT preview browse/session regressions (refresh immutable context + in-flow fallback)`
- `fix(meta): mark signupassist.chat as consequential (Stripe + booking) to avoid “preview-only” fake completions`

### Known gaps / next steps (pull from punchlist)

See `docs/V1_PUNCHLIST.md` for the authoritative checklist. Highest-signal remaining items:

- **OAuth in ChatGPT preview** (manual): verify full sign-in flow completes.
- **Pre-submission runbook**: finish any remaining “one hour” checks and capture evidence/screenshots for review packet.

### How to resume (operator quickstart)

- **Repo state**: pull latest `main`.
- **Health**: check server version via `/health`.
- **SSE/OAuth smoke**: `npm run test:sse`
- **API-only smoke**: `tsx scripts/smokeApiOnly.ts`
- **E2E scheduled smoke (safe)**: `npm run test:e2e` (requires `E2E_USER_ID`)

---

## 2025-12-31 — Canonical checklist + remove DesignDNA runtime gating

### What changed

- **Docs**: removed stale `docs/CHATGPT_COMPLIANCE_CHECKLIST.md` so `docs/V1_PUNCHLIST.md` remains the single canonical v1 checklist.
- **Runtime**: removed the `DesignDNA` runtime validator/logging from `mcp_server/ai/APIOrchestrator.ts` to avoid non-canonical “Design DNA” gating/noise in production.
- **Kept (compliance-critical)**: Responsible Delegate + security-note helpers moved to `mcp_server/ai/complianceHelpers.ts`.

### Follow-up (same day): COPPA guardrails + Stripe link reliability + less choppy Step 2/5

- **COPPA / eligibility enforcement (runtime)**:
  - Hard-gated the flow so only a **parent/legal guardian age 18+** can proceed past Step 2/5.
  - Uses the parent/guardian DOB to validate 18+ (no new DB columns needed; aligns with `docs/TERMS_OF_USE.md` and `docs/PRIVACY_POLICY.md`).
  - Prevents persisting profile/children if the user fails the 18+ gate.
- **Stripe “loop” fix**:
  - Persisted `stripeCheckoutUrl` (+ session id + timestamp) in session context so we can **re-send** the same Stripe Checkout link if ChatGPT gets choppy.
  - In PAYMENT step, if no card is on file, we now always show the Stripe link (instead of repeatedly asking to “save a payment method” without providing the link).
- **Step 2/5 clarity**:
  - Prompts now label fields as **Parent/guardian** vs **Child** and finish parent fields before child fields.
  - Added a guard to avoid accidentally treating the delegate’s name as the child when only a name (no age) is provided.
  - Added a guard to avoid saving a “child” record identical to the delegate (common UX slip).

### How to test quickly (ChatGPT preview)

- Run a book-now flow to Step 4/5 and type “proceed” multiple times: you should see the **same Stripe Checkout link** re-sent.
- Complete Stripe Checkout and return, then type **done**: the system should detect `user_billing.default_payment_method_id` and proceed to confirmation.
- During Step 2/5: provide relationship + DOB and ensure the flow blocks if DOB implies <18.

### Streamlining / UX polish (follow-up)

- **Step 1/5**: when a program list exists but the user replies with something that isn’t a selection, we now re-print a compact numbered list of options so the user isn’t “stuck” guessing what 1–N refers to.
- **Step 3/5**: fixed review text to render with **real newlines** (no literal `\n` sequences shown to the user).
- **COPPA messaging**: eligibility note (“parent/legal guardian age 18+”) is now included in the **one-time trust intro** instead of being repeated in every Step 2/5 prompt.
- **Less choppy Steps 3–5**: activation/provider-matching (and `user.get_delegate_profile` lookup) now runs only in **Step 1/5 (BROWSE)**, so REVIEW/PAYMENT turns avoid extra tool calls and reduce repeated prompts/latency.
- **Step 2/5 fewer turns**: form-fill now asks up to **3 missing items per prompt** (and clearly labels whether we’re collecting **parent/guardian** vs **child** info) to reduce back-and-forth without dumping schemas.

### GitHub sync

- Pushed to `origin/main`: `e0fc628..131fd45` (includes Step 2 batching, activation gating, and Bookeo metadata fix).

### Railway deploy note (healthcheck stuck)

- Symptom: Railway build completes, then healthcheck retries `/health` with “service unavailable”.
- Fix shipped: `/health` now supports **GET or HEAD**, and startup now forces **HTTP mode on Railway** (even if `NODE_ENV` isn’t `production` / `PORT` isn’t injected), to avoid accidentally starting in stdio-only mode.
- Additional fix: Railway build logs showed `dist/mcp_server/ai/` missing after `tsc`. Root cause was TypeScript sometimes inferring `rootDir` as `mcp_server` (since `mcp/` has no TS), which changes output paths to `dist/index.js` + `dist/ai/*` and breaks Docker `CMD ["node","dist/mcp_server/index.js"]`. Set `compilerOptions.rootDir = "."` in `tsconfig.mcp.json` to make dist paths stable.

### Signup #2 (returning user) reliability + privacy hardening

- **Signup #2 explicit + fast**: returning users with 1 saved child now get a Step 2/5 prompt that shows what we’ll reuse (**child name + DOB**, **parent name + relationship + DOB**) and asks only what’s missing (often email), with a clear **“different child”** escape hatch.
- **No skipped Step 3/5**: REVIEW now always shows a full “Please review the details below…” summary at least once before accepting “yes/cancel”. If the user types more info in REVIEW, we treat it as edits, rehydrate, and re-render the summary.
- **App Store posture**: removed raw MCP message body logging; added **scoped debug logging** via `DEBUG_LOGGING=true` + (`DEBUG_USER_ID` or `DEBUG_SESSION_ID`) and redacted audit args storage (`audit_events.args_json`) while preserving hashes.
- Code: commit `c0b6eef` (pushed to `origin/main`).
- Follow-up: commit `61d21ef` moves **payment method confirmation before final review/consent** (Step 3 = payment, Step 4 = review) and fixes “different child …” parsing so the directive doesn’t become part of the child’s name.

---

## 2025-12-31 — V1 E2E polish (flow correctness + logging posture)

### What we changed (high signal)

- **Signup #2: filter bad saved child**
  - Added a guard to **hide saved child records that match the delegate** (same name + DOB), preventing the returning-user “On file” prompt from ever suggesting the bogus child record.

- **Step 2/5 copy clarity**
  - Step 2 prompts now explicitly state **payment method confirmation (Stripe) is next**, followed by final review/consent.

- **Enforce payment-before-review everywhere**
  - Fixed a step-order regression where `submit_form` could still advance to `REVIEW` even though v1 requires `PAYMENT` first.
  - Ensured the various submit paths consistently call `submitForm(..., { nextStep: 'payment' })`.
  - Hardened PAYMENT step:
    - “change card” now **always generates (or re-sends) a Stripe Checkout link**
    - “done” detection is less brittle (recognizes “done/all set/finished/added card” safely)
  - Fixed legacy gate: `authorize_payment` now keys off `hasPaymentMethod` (or last4 fallback), not `cardBrand`.

- **Receipts/audit/cancel reliability**
  - `viewAuditTrail` now falls back to `scheduled_registrations` when a full UUID is ambiguous and the `registrations` lookup fails.

- **Production logging posture (debuggable, but redacted+scoped)**
  - `APIOrchestrator` no longer emits unconditional `console.log` traces.
    - Added `DEBUG_LOGGING` (off by default; **requires `DEBUG_USER_ID` or `DEBUG_SESSION_ID` in prod**) and redacts common PII fields.
  - Removed a major PII leak in `bookeo.confirm_booking`: **no longer logs full booking payloads**.
  - Normalized Bookeo env keys (trim + drop trailing comma) to reduce “Invalid secretKey” footguns.
  - Reduced server debug endpoints to avoid logging response bodies / PII-ish blobs.

- **Worker smoke helper**
  - Added `npm run test:worker` → `scripts/smokeWorkerExecute.ts`
  - This schedules a job due soon and (optionally) watches DB status transitions.
  - Requires explicit `E2E_EXECUTE=1` because it can create real bookings and charge the success fee.

### Current status

- Code is **build-clean** (`npm run mcp:build`).
- ✅ Evidence captured (prod):
  - Regression: `scripts/regressionSignup2.ts` passed against `https://signupassist.shipworx.ai` using Auth0 user `auth0|69547f…`.
    - Note: payment method not on file for that user, so Step 4/5 review check was skipped (expected).
  - Worker execute smoke: `npm run test:worker` succeeded.
    - Scheduled: `SCH-31388c61` → `completed`
    - Booking number: `1567512312459746`
    - Receipt: `REG-a4df8aba` (status `confirmed`)
    - `audit SCH-31388c61` responded successfully

---

## 2025-12-31 — ChatGPT preview fixes (account switching + flow correctness)

- **Saved child name sanitization (no DB mutation)**: strip directives like “different child …” and embedded DOB fragments so they never appear in Step 2/5 “On file” or the review summary.
- **SUBMIT step hardening**: added an explicit `FlowStep.SUBMIT` handler so ChatGPT retries/refreshes can’t fall into the generic “unsupported organization” messaging mid-booking.
- **Step 5/5 header correctness**: after a successful booking, we persist `step=COMPLETED` for the response snapshot so ChatGPT consistently renders **Step 5/5 — Registering** on the success message.
  - Added `FlowStep.COMPLETED` → same handling as `BROWSE` for subsequent user messages (so completion doesn’t trap the session).
- **No double-consent**: fixed the “yes twice” issue by setting `reviewSummaryShown=true` when we already include the full summary in the response.
- **OAuth switching**: `/oauth/authorize` now sets `prompt=login` by default (configurable via `AUTH0_OAUTH_PROMPT`) so it’s easy to sign in as a different user inside ChatGPT’s embedded browser.
- **PII log reduction**: removed email logging from `stripe.create_checkout_session` and stopped logging raw `formData` in `confirmPayment`.

- **Step 3/5 card clarity** (prod): PAYMENT fallback now shows the saved card brand/last4 (and refreshes via `stripe.check_payment_status` if needed) so the user can verify they’re using the correct card before consenting.
  - Deployed: commit `c0e05bd` (verify: Step 3/5 shows “visa •••• 4242” instead of a generic prompt).

---

## 2026-01-01 — Fix: explicit Step 4/5 consent (prevents skipped review)

### Symptom (prod)

- User confirmed the saved card in **Step 3/5** with “yes”, but the flow proceeded straight to **Step 5/5 — Registering**, effectively skipping **Step 4/5 (Review & consent)**.

### Root cause

- The REVIEW step previously accepted a generic confirmation like **“yes”** as final consent.
- In ChatGPT tool flows, a short “yes” can be repeated/duplicated across adjacent turns (payment confirmation + booking confirmation), creating accidental consent and making the review summary effectively invisible.

### Fix shipped (code)

- `mcp_server/ai/APIOrchestrator.ts`
  - Added `isBookingConfirmation(...)` and changed `FlowStep.REVIEW` to require an **explicit** booking phrase (e.g., **“book now”**) for final consent.
  - Generic “yes” in REVIEW now **does not** book; it replies with a reminder to type **book now**.
  - Updated the review summary footer to say **book now** (not “yes”) so consent is unambiguous.
  - Follow-up: if the user types “yes” in Step 4, we now **re-print the full review summary** (program/date/fees/payment method) + the “book now” instruction. This prevents the “details missing” UX when ChatGPT retries/drops a previous summary message.
  - Follow-up: if a booking completes but ChatGPT retries the final confirmation message, we **re-send the last confirmation** (instead of restarting Step 1 browse). Stores a minimal `lastCompletion` (confirmation text + timestamp) in session context for ~2 minutes.
  - **Cancel flow UX**: cancellation confirmations now persist a `lastCompletion` snapshot too, and empty/duplicate follow-ups re-send the cancellation confirmation instead of jumping to Step 1 browse. Also switched cancellation confirmations to **accurately reflect refund status** (don’t claim refund succeeded when the refund call fails).
  - **Audit UX**: `audit <8-hex>` is now accepted (no need to prepend `REG-`), and saying “audit” without an ID now shows the registrations list and prompts the user to pick a REG-/SCH- code (instead of returning an error).
  - **Step header UX**: receipts/audit/cancel are treated as **account management** views and now set `metadata.suppressWizardHeader=true` so ChatGPT doesn’t prepend `Step 1/5 — …` on those screens.
  - **Cancel retry UX**: when ChatGPT duplicates the user’s “yes” after a cancellation, the `lastCompletion` replay now also sets `metadata.suppressWizardHeader=true` (prevents `Step 5/5` from reappearing on the replayed confirmation).
  - **Audit reliability**: hardened `viewAuditTrail` against malformed timestamps / non-array mandate scopes and ensured audit errors also set `metadata.suppressWizardHeader=true` (so errors don’t render as `Step 5/5`).
  - **Wizard “continued” correctness**: fixed a bug where `Step N/5 continued` could appear on the *first* visible turn of a step (especially Step 1). We now reset/clear `wizardProgress` on step transitions, on explicit “browse” intents, and whenever we return an account-management view (`suppressWizardHeader=true`), so “continued” only appears on the 2nd consecutive turn of the same wizard step.
  - Follow-up: additionally reset/clear `wizardProgress` on all program-list renders (`searchPrograms`) and other “start browse” entry points to eliminate any remaining `Step 1/5 continued` cases caused by retries/duplicate tool calls.
  - **SSE refresh stability**: ChatGPT connector refresh uses `POST /sse` (not `GET`). We now accept **GET or POST** as the SSE connect endpoint and allow **unauthenticated POST /sse** (refresh) while still requiring OAuth for **GET /sse** (login) and for `/messages` `tools/call`. Includes SSE keep-alive comment heartbeats and transport cleanup on `res.on('close')` (plus `req.on('aborted')`) to reduce “hang after refresh” cases in ChatGPT dev mode.
  - **OAuth reconnect hardening**: `/oauth/authorize` and `/oauth/token` now force the canonical Auth0 `client_id`/`client_secret` from server env (ignores any stale/incorrect values stored in the ChatGPT UI) and logs truncated Auth0 token errors (no tokens) to speed up debugging.
  - **Set & forget scheduled signup UX**: for “opens later” programs, Step 3/5 and Step 4/5 now explicitly show the **registration open time** and clarify **no charge unless registration succeeds**. Scheduled signup confirmations now store a `lastCompletion.kind="scheduled"` snapshot so ChatGPT empty reconnect calls re-print the scheduling confirmation instead of jumping back to Step 1.
- `mcp_server/index.ts`
  - `signupassist.chat` tool handler now **suppresses wizard step headers** when `metadata.suppressWizardHeader=true` (keeps Step headers for the actual signup wizard).
- `mcp_server/ai/APIOrchestrator.ts`
  - Added a **Supabase fetch timeout** (abort after `SUPABASE_FETCH_TIMEOUT_MS`, default 8000ms) to prevent “app hangs” when awaited session persistence to `browser_sessions` stalls.
  - **Wizard UX**: added `wizardProgress` tracking + `metadata.wizardContinued` so multi-turn steps display `Step N/5 continued — …` on follow-up turns (e.g., Step 2/5 often spans multiple messages).

- `scripts/regressionSignup2.ts`
  - Added an assertion that **Step 4/5 includes “book now”** (explicit consent phrase).
  - Added an optional (opt-in) check `REGRESSION_ASSERT_YES_DOESNT_BOOK=1` to verify a generic “yes” in Step 4 does not book.

- `mcp_server/index.ts`
  - Updated `ensureSuccessFeeDisclosure(...)` to be **non-interactive** (no “would you like me to…” question) and to **skip Step 5** (post-success) and messages that already include a clear “SignupAssist Fee…” line. This reduces accidental follow-up tool calls that can make the UI look like it “loops” after success.
  - **OAuth testing / fresh account**: restored strict Auth0 challenge on **`GET /sse`** (401 + `WWW-Authenticate` with `authorization_uri`/`token_uri`). This ensures ChatGPT reliably shows the Auth0 login page after disconnect/reconnect so we can test a fresh user.

### Local verification

- `npm run mcp:build` ✅

---

## 2026-01-03 — Fix: graceful declines for unsupported providers + non‑US locations

### Symptom

- Prompts like **“Toronto, Ontario, Canada”** or **“8am yoga at Inner Fire Yoga studio”** were triggering `signupassist.chat` and returning a list of **AIM Design** programs.
- Server logs showed `ActivationConfidence` LOW but still proceeded to:
  - `Searching programs for org: aim-design`
  - `bookeo.find_programs`

### Fix (code)

- `mcp_server/ai/APIOrchestrator.ts`
  - Added early-return guards in low-confidence **BROWSE** step to:
    - decline **non‑US** location requests (no AIM Design fallback)
    - decline **unsupported provider** hints (e.g., “studio”, “academy”, “gym”, etc.)
    - decline **unsupported activities** (no active org offers it) instead of listing unrelated programs
  - Fixed `detectNonUSLocationHint()` false positives by only treating **ALL‑CAPS** 2‑letter tokens as US state abbreviations (avoids matching the word “in” as Indiana).

- `mcp_server/ai/apiMessageTemplates.ts`
  - Added `getUnsupportedRequestMessage(...)` helper for consistent decline copy.

### Evidence

- Local runtime sanity check (no-network stub) confirmed:
  - Toronto prompt returns a **US-only** message and does **not** call `searchPrograms`/`bookeo.find_programs`
  - Inner Fire Yoga prompt returns an **unsupported** message and does **not** call `searchPrograms`/`bookeo.find_programs`

### How to verify in prod (fast)

- Prompt: “Sign up my kids for a class in Toronto, Ontario Canada”
  - Expect: **US-only** decline; no `bookeo.find_programs` in logs.
- Prompt: “Sign me up for the 8am yoga class at Inner Fire Yoga studio”
  - Expect: **unsupported provider** decline; no `bookeo.find_programs` in logs.

---

## 2026-01-02 — Activation gate: Activity + Age + Location + cached-program match (DB) before discovery

### Goal

- Ensure SignupAssist only proceeds to program discovery when:
  - the user has provided **Activity + Child Age + Location (city/state)**, AND
  - there is at least one **matching program in our Supabase cached program feed**.

### What changed (code)

- `mcp_server/ai/APIOrchestrator.ts`
  - Added a strict **cached program match** check against Supabase:
    - Primary: `cached_programs` (JSON `programs_by_theme`, non-expired)
    - Fallback: `cached_provider_feed` (legacy)
  - Updated **single-turn** “Activity + City” fast-path:
    - Now requires **age** too (A-A-L triad).
    - Verifies a cached program match exists before calling `bookeo.find_programs`.
  - Updated **location response** handling:
    - If activity or age is missing, ask for it instead of proceeding.
    - If triad complete but cache match is 0, return a “no matching programs in listings” message (no live discovery).
  - Added a **triad completion** path when a user replies with just an age (e.g., `"8"`) after prior turns captured activity + location.

- `mcp/openapi.json`
  - Marked `/orchestrator/chat` as `x-openai-isConsequential: false`.
  - Added an explicit “Activation gate” note to the operation description.

- `mcp/manifest.json`
  - Added the “Activation gate” rule to `description_for_model`.

### Evidence / sanity checks

- `npm run mcp:build` ✅ (tsc compiled cleanly after changes)

### Notes / follow-ups

- If activity keywords are too strict (e.g., programs don’t include “robotics” in title/description/theme), consider broadening the matcher (e.g., allow STEM→robotics fallback) while still enforcing “exists in DB”.
- Validate in ChatGPT that “Find robotics classes in Madison, WI for my 8-year-old” reliably triggers the tool call and returns AIM Design programs when the cache contains matches.

---

## 2026-01-03 — Rollback checkpoint before unauth discovery changes (SSE/OAuth safe baseline)

### Baseline (prod)

- **Prod commit**: `c3dee5f39fcc2af90c8c31c59ee8e1b9dc125a7f`
- **Prod builtAt**: `2026-01-02T22:39:07.649Z`

### Rationale

We are about to change MCP tool visibility + auth gating for a read-only discovery tool. If anything regresses with ChatGPT connector behavior (SSE/OAuth), revert to the baseline commit above.

---

## 2026-01-03 — Reduce Web Search fallback by enriching `signupassist.start` tool output

### What changed

- Updated `signupassist.start` to accept an optional `query` and return a **rich plain-text list** of relevant programs in `result.content[]` (so ChatGPT can answer without Web Search).
- Strengthened `public/.well-known/chatgpt-apps-manifest.json` instructions to:
  - call `signupassist.start` first for discovery + signup intents
  - avoid Web Search if `signupassist.start` returns usable options

### Evidence (prod)

- Deployed commit: `df3f1bcdf8e15086fc57050c71ab392354630775`
- Unauthed `tools/call signupassist.start` with query `"I'd like to sign up for robotics class for my 9 year old in Madison, WI"` returns content with the robotics program listed.

---

## 2026-01-03 — Rollback tag before V1 “single public tool + OAuth-only” posture

### Baseline (prod)

- **Prod commit**: `f4c9e915a48c799e268bbd907d25221c408feb1a`
- **Rollback tag**: `rollback/pre-v1-single-public-tool-20260103-0951`

### Rationale

We are about to simplify the public MCP surface to **one tool** (`signupassist.chat`) and restore **OAuth-required for all tool calls**. If anything regresses with SSE/Auth0/OpenAI connector behavior, redeploy the tag above.

## 2026-01-01 — Fix: `audit REG-...` crashes when audit args are redacted (`participants.map is not a function`)

### Symptom (prod)

- Chat: `audit REG-xxxxxxxx`
- UI: **“An error occurred while loading the audit trail.”**
- Logs: `[viewAuditTrail] Exception` (or specifically: `participants.map is not a function`)

### Root cause

- `mcp_server/middleware/audit.ts` redacts PII in `audit_events.args_json` by replacing keys like `delegate_*` / `participant_*` with the string `"[REDACTED]"`.
- `mcp_server/ai/APIOrchestrator.ts` assumed `args_json.participant_data` was always an array and called `participants.map(...)`, which throws when `participant_data` is a redacted string (or otherwise non-array).

### Fix (code)

- `mcp_server/ai/APIOrchestrator.ts`
  - Hardened `viewAuditTrail()` event rendering (`formatEventDetails`) to safely handle:
    - redacted/non-array `participant_data`
    - redacted/non-object `delegate_data`
    - non-string IDs when truncating
    - missing `result_json.success` (renders **Unknown** instead of defaulting to failed)
  - Improved catch logging to include the thrown error message while still redacting PII.

### How to verify

- Deploy the commit containing the above `APIOrchestrator.ts` change.
- In ChatGPT, run: `audit REG-xxxxxxxx` for a recent registration.
- Expected: audit trail renders; “Participants” shows **[REDACTED]** (or `N/A`) and no exception is thrown.
- Deployed: commit `426c47b` (pushed to `origin/main`)

---

## 2026-01-01 — Fix: ChatGPT “Create App” broken by `GET /sse` OAuth challenge

### Symptom (prod)

- In ChatGPT Settings → Connectors → **New App**, clicking **Create** fails after providing the MCP Server URL (e.g. `/sse`) + OAuth credentials.

### Evidence

- Live server responded:
  - `GET /mcp` → **200**
  - `GET /.well-known/oauth-authorization-server` → **200**
  - `HEAD /sse` → **404**
  - `GET /sse` (no Authorization) → **401** (`WWW-Authenticate: ... authentication_required ...`)
  - `POST /sse` (no Authorization) → **200** `text/event-stream`

### Root cause

- We were **requiring OAuth on `GET /sse`** (while allowing unauthenticated `POST /sse` for connector refresh).
- It appears ChatGPT’s **Create App** flow may validate using **`GET /sse`**, and treats the 401 challenge as a hard failure instead of triggering OAuth.

### Fix (code)

- `mcp_server/index.ts`
  - Allow **unauthenticated `GET /sse`** (same as `POST /sse`) to maximize compatibility with ChatGPT connector creation/validation.
  - Support **`HEAD /sse`** as a lightweight validation probe (returns 200 without opening an SSE transport).
  - OAuth is still enforced for **consequential calls** via `POST /messages` when `method === tools/call` (401 + `WWW-Authenticate` to trigger OAuth consent).

### Notes / follow-up

- If we still need a “force login on connect” mode for specific testing, add an explicit opt-in switch (e.g. query param or env flag) rather than defaulting to 401 on `GET /sse`.

---

## 2026-01-01 — Fix: ChatGPT OAuth config “Request timeout” (OIDC discovery + HEAD probes)

### Symptom (ChatGPT UI)

- ChatGPT Settings → Connectors → **New App** shows:
  - **“Error fetching OAuth configuration — Request timeout”**

### Evidence

- Prod previously returned **404** to HEAD probes:
  - `HEAD /.well-known/oauth-authorization-server` → 404
  - `HEAD /oauth/authorize` → 404
  - `HEAD /oauth/token` → 404
- Prod also returned **404** for OIDC discovery:
  - `GET /.well-known/openid-configuration` → 404

### Fix (code)

- `mcp_server/index.ts`
  - Added **HEAD support** for OAuth endpoints:
    - `/.well-known/oauth-authorization-server` (GET/HEAD → 200)
    - `/oauth/authorize` (GET/HEAD → 302)
    - `/oauth/token` (HEAD → 200; POST unchanged)
  - Added **OIDC discovery + JWKS** under our domain:
    - `/.well-known/openid-configuration` (GET/HEAD → 200)
    - `/.well-known/jwks.json` (GET/HEAD → 200; proxies Auth0 JWKS with 5m in-process cache)

### Rationale

- ChatGPT’s connector creation/validation appears to probe OAuth/OIDC endpoints using **HEAD** (and may rely on OIDC discovery),
  so returning 404 can cause OAuth config validation to fail with a timeout.

---

## 2026-01-01 — Fix: Auth0 “Unknown client” during ChatGPT OAuth

### Symptom

- Auth0 tenant logs show:
  - `invalid_request: Unknown client: 0pe6q?tHCEDas698UvrDLNC3xns5Iraq` (visually ambiguous `l` vs `1`)

### Root cause

- Production was redirecting `/oauth/authorize` to an **incorrect Auth0 `client_id`** due to a subtle **`1` vs `l`** mismatch.
- Auth0 treats that as an unknown client and aborts the OAuth flow.

### Evidence (local repro via curl)

- `client_id=...q1t...` → Auth0 responds `invalid_request: Unknown client`.
- `client_id=...qlt...` → Auth0 responds `302` to `/u/login` (valid client).

### Fix

- Update Railway env var `AUTH0_CLIENT_ID` to the exact value copied from Auth0 dashboard (use the copy button to avoid `l`/`1` confusion), then restart the service.

---

## 2026-01-01 — Fix: ChatGPT OAuth redirect hang (token exchange + /sse probe timeouts)

### Symptom

- ChatGPT returns to `https://chatgpt.com/connector_platform_oauth_redirect?...` and appears to “hang”.
- ChatGPT `oauth_config` and action refresh calls intermittently fail with “Request timeout”.

### Evidence

- Server logs showed `/oauth/token` sometimes returning `403 invalid_grant` (stale/invalid code), and later succeeding with `200`.
- We reproduced that `GET/POST /sse` without acting as a real SSE client can hang until client timeout.

### Fix (code)

- `mcp_server/index.ts`
  - `/oauth/token` now forwards to Auth0 as **`application/x-www-form-urlencoded`** (better PKCE compatibility) and logs presence of `code_verifier` safely.
  - `/sse` now always requires OAuth for **both GET and POST** (returns fast `401 + WWW-Authenticate`), preventing ChatGPT’s probes from opening a long-lived SSE stream and timing out.

### Follow-up: stabilize ChatGPT probes + avoid SPA fallback on protocol endpoints

- ChatGPT also probes:
  - `/.well-known/oauth-protected-resource` (and `.../sse`)
  - `GET /messages?sessionId=...` (probing / validation)
- Previously, unknown methods/paths could fall through to the SPA fallback and return `index.html` (200 text/html),
  which can create opaque “timeout / method not allowed” behavior in the ChatGPT UI.

Fix:

- `mcp_server/index.ts`
  - Added `/.well-known/oauth-protected-resource` metadata (and a couple `/sse` variants) returning 200 JSON.
  - Added explicit `405` JSON responses for wrong methods on `/messages` and `/oauth/token` (prevents SPA index.html fallback).


---

## 2026-01-01 — Fix: ChatGPT “invoke app” 424 (MCP tools/call missing `content`)

### Symptom (ChatGPT)

- User tries: “invoke the Signup Assist app now”
- ChatGPT shows “You allowed this action” but then fails with:
  - **424 validation error**: response missing required **`content`** field

### Evidence (server logs)

- ChatGPT posts MCP JSON-RPC directly to **`POST /sse`** with a JSON body:
  - `methodName=tools/call`

### Root cause

- `POST /sse` had a “discovery compatibility” fast-path for `initialize` + `tools/list`, but **did not handle `tools/call`**.
- When `tools/call` was POSTed to `/sse`, the server would:
  - consume the JSON body (so the tool call message was effectively dropped)
  - open an SSE stream and emit an **unsolicited eager `tools/list`** message (previously `id: 1`)
  - in practice, this can collide with the client’s request id and/or be interpreted as the tool response, which then fails validation because the result has **no `content`** (it’s a tools list result)

### Fix (code)

- `mcp_server/index.ts`
  - **Handle `tools/call` synchronously in the `POST /sse` JSON-body fast-path**:
    - enforce OAuth in prod
    - execute the tool handler directly
    - return a finite JSON-RPC response with `result.content`
  - **Harden `mcpOk(...)`** to guarantee every tool result includes a **non-empty `content`** array (even when a tool returns `structuredContent` only)
  - **Avoid JSON-RPC id collisions on SSE connect**: changed eager `tools/list` message id from `1` → a non-numeric string id (`eager-tools-list`)

### Local verification

- `npm run mcp:build` ✅

---

## 2026-01-05 — Fix: “Book now” confirmation consistency (receipt + single-tool front door)

### Symptom (ChatGPT)

- After typing **book now**, some chats showed an inconsistent “booking in progress” style message or produced incorrect follow-up promises (e.g., implying SignupAssist emails confirmations).

### Root cause (best-effort)

- ChatGPT can sometimes call cached/legacy tool names or internal tool endpoints, producing non-deterministic post-booking output.

### Fix (code)

- `mcp_server/index.ts`
  - Enforced an **Auth0 (ChatGPT) tool allowlist** across `/sse` JSON-RPC, `/messages`, and `/tools/call`:
    - Allow only `signupassist.chat`
    - Alias cached legacy `signupassist.start` / `signupassist.find` → `signupassist.chat`
    - Block all other tools for Auth0 callers (prevents internal/private tool paths from being invoked by ChatGPT)
- `mcp_server/ai/apiMessageTemplates.ts` + `mcp_server/ai/APIOrchestrator.ts`
  - Upgraded the Step 5/5 booking success output to a receipt-style confirmation including:
    - Participants
    - Fees (program fee vs $20 success fee)
    - Truthful copy: **provider emails confirmation** (SignupAssist does not claim to email in v1)

### Regression guard

- `scripts/smokeApiOnly.ts` now includes a small template assertion: success receipt contains `Booking #` + `Participants` and does not claim "SignupAssist will email".

---

## 2026-01-05 — V1.1 Signup UX Improvements (Calendar + Sold-Out + Batch Sibling)

### Baseline / Reversion Point

- **Last known-good commit**: `2281499` (chore: shorten Step 2 email note)
- **Reversion command**: `git revert HEAD` (if single commit) or `git reset --hard 2281499` + force push

### What changed

1. **Calendar Integration** (`mcp_server/utils/calendar.ts` - NEW)
   - Added `.ics` file generation for Apple Calendar / Outlook
   - Added Google Calendar URL generation
   - Success message now includes "Add to calendar" links

2. **Sold-Out Handling** (`mcp_server/ai/APIOrchestrator.ts`)
   - Added sold-out detection in `selectProgram()`
   - Added `suggestAlternatives()` helper to find open programs
   - Shows up to 3 alternatives when selected program is full

3. **Batch Sibling Registration** (`mcp_server/ai/APIOrchestrator.ts`)
   - After first child info, asks "Would you like to register another child?"
   - Supports up to 3 children per registration (or fewer if slots limited)
   - Clear messaging: "$20.00 SignupAssist fee is the same whether you register 1, 2, or 3 children"
   - Added `participants` array and `awaitingAdditionalChild` flag to APIContext
   - Added `add_another_child` and `finish_child_selection` action handlers
   - NL handling for "yes/no/add another/done" responses
   - **Availability checking**: checks `available_slots` before offering to add more children
   - **Slot warnings**: shows "⚠️ Only X spots remaining" when slots are limited
   - **Graceful limit**: if class becomes full mid-batch, stops asking and proceeds to payment
   - Extended `lastCompletion` type with `program_name` and `program_data`

4. **Multi-child messaging updates** (`APIOrchestrator.ts` + `apiMessageTemplates.ts`)
   - Review summary now lists all participants with count: "Participants (3 children):"
   - Success fee line shows "(flat fee for 1-3 children)" when multiple children
   - Success message shows "**Participants:** Tommy, Sarah, Jake"
   - Receipts/audit trail already support multiple participant names (verified)

### Files modified

| File | Change Type |
|------|-------------|
| `mcp_server/utils/calendar.ts` | NEW |
| `mcp_server/ai/apiMessageTemplates.ts` | Modified (import + success message) |
| `mcp_server/ai/APIOrchestrator.ts` | Modified (sold-out, batch sibling, type extensions) |

### Reversion Plan

If issues arise after deployment:

**Option A: Full revert (safest)**
```bash
git reset --hard 2281499
git push --force origin main
# Railway will auto-deploy the reverted commit
```

**Option B: Selective revert (if only one feature is broken)**
```bash
# Revert the single commit containing all features
git revert <new-commit-hash>
git push origin main
```

### How to verify in prod

1. **Calendar links**: Complete a booking → success message should show "Add to calendar" links
2. **Sold-out**: Select a sold-out program → should see alternatives message (not form entry)
3. **Batch sibling**: After entering first child → should see "add another child?" prompt with flat fee messaging

### Risk assessment

- **Calendar**: LOW - additive, graceful fallback if no start_time
- **Sold-out**: LOW - new condition after existing `closed` check
- **Batch sibling**: MEDIUM - modifies child collection flow; existing single-child path still works

---

## 2026-01-05 — Fix: closed program re-listing + sibling registration + multi-child review

### Symptom (prod)

During a multi-child “book now” flow, the user observed:

1) After detecting a class was closed/past, it still appeared again in later “Available classes” lists.
2) After adding a second child, the assistant responded as if it still only “had Percy’s information”.
3) The Review & Consent step showed only the first child (Percy), not both children (Percy + Mina).

### Root causes

- **Closed program re-listing**: the `selectProgram()` `bookingStatus === 'closed'` fallback re-called `searchPrograms()` without remembering that the selected `program_ref` is known-unavailable for the rest of the session.
- **Sibling input routing**: after “Yes, add another child”, the next free-text message could be treated as generic `submit_form` hydration rather than “select next child”, leaving sibling state inconsistent.
- **Review rendering**: review primarily normalized from `context.formData`. In sibling flows, the authoritative list may still live on `context.participants`, and `pendingParticipants` could become partial (dropping earlier siblings).

### Fix shipped

- **Session-local hidden program list**
  - Added `hiddenProgramRefs` to the session context.
  - When `selectProgram()` detects `bookingStatus === 'closed'`, it adds the `program_ref` to `hiddenProgramRefs` and re-renders browse.
  - `searchPrograms()` filters out `hiddenProgramRefs`, so the known-closed program won’t appear again in this chat session.

- **Sibling flow correctness**
  - Added `awaitingAdditionalChildInfo` to explicitly represent “we are waiting for the next child’s name/age/DOB”.
  - `handleAddAnotherChild()` now sets `awaitingAdditionalChildInfo: true` when prompting for the next child.
  - `handleMessage()` routes the next message to `select_child` when `awaitingAdditionalChildInfo` is set, and also detects child lines while on the “add another child?” prompt.
  - `handleSelectChild()` now keeps `pendingParticipants` synced to the full `participants` list (prevents dropping earlier siblings).

- **Review includes all children**
  - `buildReviewSummaryFromContext()` now falls back to `context.participants` (and only then `context.pendingParticipants`) when `formData` isn’t normalized yet.

- **Reset hygiene**
  - `handleClearContext()` and the “select program” stale-state reset now clear sibling fields (`participants`, `pendingParticipants`, awaiting flags) and `hiddenProgramRefs`.

### Verification

- Added regression: `scripts/regressionSiblingAndHiddenPrograms.js`
  - Hidden closed program does not re-appear in browse message when `hiddenProgramRefs` contains its `program_ref`.
  - Sibling add-child free-text updates `context.participants` and review summary includes both children.
- Added npm script: `npm run test:sibling-flow`

Notes:
- The regression is network-free. It may log warnings about missing `SUPABASE_URL` (background session persistence), but functional assertions pass.

---

## 2026-01-05 — Streamlined sibling selection from saved children

### Problem

When the user said "Yes, add another child", the system asked for name+age even if the user had saved children on file. This created unnecessary friction (e.g., user says "Yes, Percy" but we ask "What's the child's name and age?").

### Solution

Modified both the initial "Would you like to register another child?" prompt AND the sibling sub-state routing to:

1. Load saved children if not already loaded
2. Filter out children already in `context.participants`
3. Show remaining saved children as numbered options
4. Always include a "Different child" option for entering new info
5. Match user input by number (e.g., "2") or by name (e.g., "Percy")

### What changed (code)

- `mcp_server/ai/APIOrchestrator.ts`
  - `getRemainingSavedChildren()` helper already existed — loads+filters saved children
  - `matchSavedChildFromInput()` helper already existed — matches by number or name
  - `handleSelectChild()` now shows remaining saved children as numbered options after storing first child
  - `handleAddAnotherChild()` now shows remaining saved children instead of asking for name+age
  - **NEW**: Sibling sub-state routing (handleMessage) now:
    - Checks if `remainingSavedChildrenForSelection` has entries
    - Matches user input (number or name) against saved children using `matchSavedChildFromInput`
    - If match found, adds saved child to participants and shows "add another?" prompt
    - If user selects "different child" option, switches to manual name+age input
  - `handleSelectChild()` now handles `_alreadyAdded` flag to skip re-parsing when child was already added via saved child selection

### Example flow

```
I have Simon's information.

Would you like to register another child for **Ocean Explorers**?

**Your saved children:**
1. Percy Messinger
2. Mina Messinger
3. Different child (enter new info)

Reply with a number, name, or "no" to continue.
```

User types "2" → Mina is added → shows "add another?" prompt with remaining children.

### Verification

- Extended regression test `scripts/regressionSiblingAndHiddenPrograms.js`:
  - `testSavedChildSelectionByNumber()` — user types "2" to select saved child
  - `testSavedChildSelectionByName()` — user types "Percy" to select saved child
  - `testDifferentChildOption()` — user types the "different child" number to enter new info
- `npm run test:sibling-flow` ✅ (all 5 test cases pass)

