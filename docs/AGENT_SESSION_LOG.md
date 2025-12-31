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


