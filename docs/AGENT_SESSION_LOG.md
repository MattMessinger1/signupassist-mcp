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
- `mcp_server/index.ts`
  - `signupassist.chat` tool handler now **suppresses wizard step headers** when `metadata.suppressWizardHeader=true` (keeps Step headers for the actual signup wizard).
- `mcp_server/ai/APIOrchestrator.ts`
  - Added a **Supabase fetch timeout** (abort after `SUPABASE_FETCH_TIMEOUT_MS`, default 8000ms) to prevent “app hangs” when awaited session persistence to `browser_sessions` stalls.

- `scripts/regressionSignup2.ts`
  - Added an assertion that **Step 4/5 includes “book now”** (explicit consent phrase).
  - Added an optional (opt-in) check `REGRESSION_ASSERT_YES_DOESNT_BOOK=1` to verify a generic “yes” in Step 4 does not book.

- `mcp_server/index.ts`
  - Updated `ensureSuccessFeeDisclosure(...)` to be **non-interactive** (no “would you like me to…” question) and to **skip Step 5** (post-success) and messages that already include a clear “SignupAssist Fee…” line. This reduces accidental follow-up tool calls that can make the UI look like it “loops” after success.
  - **OAuth testing / fresh account**: restored strict Auth0 challenge on **`GET /sse`** (401 + `WWW-Authenticate` with `authorization_uri`/`token_uri`). This ensures ChatGPT reliably shows the Auth0 login page after disconnect/reconnect so we can test a fresh user.

### Local verification

- `npm run mcp:build` ✅
- Deployed: commit `426c47b` (pushed to `origin/main`)


