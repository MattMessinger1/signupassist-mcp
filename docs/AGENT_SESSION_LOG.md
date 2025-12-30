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


