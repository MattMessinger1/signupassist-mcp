# V1 “Works + Compliant” Punchlist (ChatGPT Apps via MCP)

This is the authoritative checklist for v1. The goal is:

- **(1) Works for end users** (book-now + schedule-at-open + cancel + receipts + audit)
- **(2) Passes ChatGPT App Store review** (OAuth, privacy, no PHI/PCI issues, explicit consent)

**MECE source of truth:** [`docs/MECE_USE_CASES.md`](docs/MECE_USE_CASES.md)

---

## A. App Store “hard blockers” (must be green)

- [x] **ChatGPT Apps manifest is valid JSON**
  - File: `public/.well-known/chatgpt-apps-manifest.json`
  - Endpoint: `/.well-known/chatgpt-apps-manifest.json`

- [x] **Submission mode is “apps via MCP”**
  - Manifest uses `api.type: "mcp"` and `api.server_url` points to `/sse`

- [ ] **OAuth works end-to-end in ChatGPT preview**
  - Endpoints: `/oauth/authorize`, `/oauth/token`, `/.well-known/oauth-authorization-server`
  - Env: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`
  - Evidence helper: `npm run test:sse` (validates OAuth metadata + MCP SSE connect with token)

- [x] **Protected actions are OAuth-gated** (401 triggers OAuth)
  - In v1 **MCP-only** posture, OAuth gating happens at the MCP transport boundary:
    - `GET /sse` and `POST /messages` return **401** without a valid OAuth token (Auth0 JWT) or `MCP_ACCESS_TOKEN`
    - `POST /tools/call` returns **401** in production without a valid token
  - Legacy OpenAPI endpoint `/orchestrator/chat` is **disabled in MCP-only mode** (returns 410) to prevent routing around MCP.

- [x] **Legal pages reachable**
  - `/privacy` serves `docs/PRIVACY_POLICY.md`
  - `/terms` serves `docs/TERMS_OF_USE.md`

- [x] **Logo URL reachable from manifest**
  - `public/logo-512.svg` → `/logo-512.svg`

- [x] **Domain verification token (if required by submission UI)**
  - Endpoint(s): `/.well-known/openai-apps-challenge` (current UI) and `/.well-known/openai-verification.txt` (legacy)
  - Env: `OPENAI_VERIFICATION_TOKEN`

---

## B. “Works for end user” acceptance matrix (v1)

### B1. Book-now flow (signup window open)
- [x] Browse/search programs returns real Bookeo programs (no scraping)
  - Evidence helper: `npm run test:smoke` (API-only smoke) and `npm run test:sse` (MCP SSE smoke)
- [x] User selects a program via NL (“the first one” / “3” / title match)
  - Evidence: prod chat selection works with numeric input (e.g. “2” selects the 2nd program)
- [x] Collect required fields (delegate + participants) with micro-questions (no schema dumps)
  - Evidence: Step 2/5 prompts only for missing required fields; returning users are prefilled from `delegate_profiles` + `children`
- [x] Review step summarizes what will happen
- [x] User explicitly authorizes
  - Evidence: Step 3/5 requires a text “yes” to proceed
- [x] Booking executes (provider confirm)
  - Evidence: prod book-now returned Booking #... and completed Step 5/5
- [x] Success fee charges only on success ($20)
  - Evidence: audit shows `stripe.charge_success_fee` after `bookeo.confirm_booking` for a confirmed booking
- [x] Receipt is created (REG- code) and viewable via “view receipts”
  - Evidence: `view receipts` lists `REG-...` for a confirmed booking (e.g. `REG-89240246`)
- [x] Audit trail shows consequential actions via “view audit trail”
  - Evidence: `audit REG-...` shows `bookeo.confirm_booking` + `stripe.charge_success_fee`

### B2. Schedule-at-open flow (signup window not open yet)
- [ ] System computes/uses accurate “opens at” time from provider metadata
- [ ] User confirms scheduled execution
- [x] Scheduled job created (SCH- code) and viewable via “view receipts”
- [ ] Worker executes at `scheduled_time` with rapid retries
- [ ] On success: provider booking + $20 fee + receipt row created
- [ ] Provider payment state stored from provider response (paid/unpaid/unknown + amounts)

### B3. Cancel & user control (text-only v1)
- [x] Cancel scheduled signup by reference: “cancel SCH-xxxx” + yes/no confirm
- [ ] Cancel completed booking by reference: “cancel REG-xxxx” + confirm (if supported)
- [x] Audit trail supports both scheduled and completed registrations
  - Evidence: `audit REG-...` works for completed bookings; `audit SCH-...` works for scheduled jobs

---

## C. Operational reliability (production)

- [ ] **Deploy scheduled worker as a second always-on service**
  - Command: `npm run worker:scheduled`

- [ ] **No double-execution / idempotency**
  - Worker claims jobs with `status=pending` → `executing` atomic update

- [ ] **Job cancellation is respected**
  - If user cancels before execution, worker must not run it

- [ ] **Observability**
  - Logs for: job claimed, booking attempt, fee attempt, receipt write, completion/failure

---

## D. Compliance hygiene (reviewers will check these)

- [x] **Single Source of Truth (SSoT) for ChatGPT tool routing**
  - Canonical tool: `signupassist.chat`
  - `ListTools` returns **public-only** tools by default (reduces model confusion)
  - `signupassist.start` is not publicly listed (prevents bypassing orchestrator guardrails)

- [x] **No PHI fields** (no allergies/medical notes)
- [x] **No in-app card input** (Stripe Checkout / tokenization only)
- [x] **Explicit confirmation before booking/charging**
- [x] **Audit trail for consequential actions**

- [x] **Avoid stale/contradictory manifests**
  - Align or deprecate: `public/.well-known/ai-plugin.json`, `public/.well-known/openai-connector.json`, `/mcp/manifest.json`
  - Ensure legal + OAuth URLs are consistent and correct

---

## E. Pre-submission “one hour” checklist

- [x] Hit `/.well-known/chatgpt-apps-manifest.json` in production (200 + valid JSON)
- [x] Hit `/.well-known/oauth-authorization-server` (200 + correct issuer/endpoints)
- [ ] OAuth login completes in ChatGPT preview
- [x] Run `bash scripts/v1_endpoint_smoke.sh https://signupassist.shipworx.ai` (expect 200s + 401 for protected)
- [x] Run `npm run test:sse` (MCP SSE: OAuth metadata + `/sse`/`/messages` + `signupassist.chat`)
- [x] Run `tsx scripts/smokeApiOnly.ts` (API-only smoke: manifest + Bookeo + signupassist.chat)
- [x] Run `npm run test:e2e` (safe scheduled smoke: creates SCH ~30 min out, cancels it, checks receipts/audit)
- [ ] Run `tsx scripts/v1_preflight.ts` in a production-like env (Supabase tables + cached feed)
- [ ] Search → select → schedule → see SCH receipt
- [ ] Worker runs and executes due job; see REG receipt; see audit trail
