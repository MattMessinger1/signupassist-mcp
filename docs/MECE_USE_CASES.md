# MECE Use Cases (v1) — SignupAssist (ChatGPT Apps via MCP)

This document is the **single catalog of user-facing use cases** for SignupAssist v1, written to be **MECE**:

- **Mutually Exclusive**: each use case has one primary intent and one “happy-path” state progression.
- **Collectively Exhaustive**: taken together, these cover every supported user intent in v1.

**Canonical entry point (SSoT):** In ChatGPT, all user-facing flows must route through the MCP tool **`signupassist.chat`** (not direct provider tools like `bookeo.*`). This keeps step headers, micro-questions, consent gates, and audit posture consistent.

---

## Groups (MECE buckets)

- **Onboarding/Trust**: explain what SignupAssist does, how consent works, what we store, and what we *never* collect.
- **Discovery**: show programs and help a user choose one.
- **Registration**: collect only required info, review, consent, payment setup, submit, receipt.
- **Account Management**: payment method setup, saved profile/children, auth linking.
- **Post‑Booking**: view receipts/history; cancellations/refunds where supported.
- **Error Recovery**: session expired, missing info, provider outages, rate limits.

---

## Use Case Index (summary)

| ID | Group | Primary intent (examples) | Entry points | Auth required | State path (happy) |
|---:|---|---|---|---|---|
| U01 | Onboarding/Trust | “What is this?”, “Is this safe?” | `signupassist.chat` | none | `BROWSE` |
| U02 | Discovery | “Show me AIM Design classes”, “Find robotics classes” | `signupassist.chat` | none | `BROWSE` |
| U03 | Discovery | “Yes (that provider)”, “AIM Design (yes)” | `signupassist.chat` | none | `BROWSE` |
| U04 | Registration | “I want #3”, “Sign up for Ocean Explorers” | `signupassist.chat` | none→OAuth later | `BROWSE → FORM_FILL` |
| U05 | Registration | “My email is…”, “Percy, 11” | `signupassist.chat` | none→OAuth later | `FORM_FILL → REVIEW` |
| U06 | Registration | “Set it up when registration opens” | `signupassist.chat` | OAuth + mandate | `FORM_FILL → REVIEW → PAYMENT → SUBMIT → COMPLETED` (scheduled) |
| U07 | Registration | “Book it now”, “Confirm/Authorize” | `signupassist.chat` | OAuth + mandate | `FORM_FILL → REVIEW → PAYMENT → SUBMIT → COMPLETED` |
| U08 | Account Management | “Add a card”, “Update payment method” | `signupassist.chat` | OAuth | `PAYMENT` |
| U09 | Post‑Booking | “Show my registrations”, “View receipts” | `signupassist.chat` | OAuth | (no change) |
| U10 | Post‑Booking | “Cancel SCH‑…”, “Cancel REG‑…” | `signupassist.chat` | OAuth + confirm | (varies) |
| U11 | Error Recovery | “Start over”, “Clear context” | `signupassist.chat` | none | `BROWSE` |
| U12 | Error Recovery | “Session expired”, “Something broke” | `signupassist.chat` | none | (varies) |

---

## Detailed use cases

### U01 — Onboarding / Trust

- **User intent / examples**: “What is SignupAssist?”, “Will you store my card?”, “Is this legit?”
- **Entry points**: `signupassist.chat` (first turn or anytime)
- **Auth required**: none
- **States**: stays in `BROWSE` (trust is informational)
- **Successful exit**: user agrees to proceed to discovery (U02)
- **Context updates**: optional `hasSeenTrustMessage=true` (if implemented)
- **Backend calls**: none
- **Compliance gates**:
  - No PII requests here
  - Explicitly state: **no passwords**, **no card numbers stored**, **Stripe hosted checkout**
  - Mention **audit trail** for consequential actions
- **Failure modes + messaging**:
  - User distrust → provide privacy/terms links and stop

### U02 — Discovery: Browse programs

- **User intent / examples**: “Show me AIM Design classes”, “Find robotics classes in Madison”
- **Entry points**: `signupassist.chat`
- **Auth required**: none
- **States**: `BROWSE`
- **Successful exit**: user sees program list and selects one (U04)
- **Context updates**:
  - `orgRef`
  - `displayedPrograms[]` (for title/ordinal matching)
  - `requestedActivity?`, `requestedLocation?` (optional)
- **Backend calls**:
  - `bookeo.find_programs` (invoked internally by orchestrator)
- **Compliance gates**:
  - Do **not** ask for PII before a specific program is chosen
- **Failure modes + messaging**:
  - No programs → explain and offer “try again later”
  - Location mismatch → ask whether to show out-of-area programs

### U03 — Discovery: Provider confirmation

- **User intent / examples**: user answers “Yes” after “Did you mean AIM Design?”
- **Entry points**: `signupassist.chat`
- **Auth required**: none
- **States**: `BROWSE`
- **Successful exit**: provider locked and programs shown (U02)
- **Context updates**: `pendingProviderConfirmation` → cleared; `orgRef` set
- **Backend calls**: `bookeo.find_programs`
- **Compliance gates**: no PII
- **Failure modes + messaging**: unrecognized “yes” → ask which provider

### U04 — Registration: Program selection

- **User intent / examples**: “3”, “the first one”, “Sign up for Coding Course”
- **Entry points**: `signupassist.chat`
- **Auth required**: none (selection only)
- **States**: `BROWSE → FORM_FILL`
- **Successful exit**: program selected and requirements discovered
- **Context updates**:
  - `selectedProgram`
  - `requiredFields` (cached from discovery)
  - `displayedPrograms` cleared (optional)
- **Backend calls**:
  - `bookeo.discover_required_fields`
- **Compliance gates**:
  - Still no payment; only begin collecting *required* info for that program
- **Failure modes + messaging**:
  - Invalid selection → re-show list; ask user to pick by number/title

### U05 — Registration: Collect required information (micro‑questions)

- **User intent / examples**: “My email is…”, “Percy Messinger, 11”, “done”
- **Entry points**: `signupassist.chat`
- **Auth required**: none for collection; OAuth needed before writes
- **States**: `FORM_FILL → REVIEW`
- **Successful exit**: complete form payload assembled for review
- **Context updates**:
  - `pendingDelegateInfo`, `childInfo`, `pendingParticipants`, `formData`
- **Backend calls**: none (until submit)
- **Compliance gates**:
  - **Data minimization**: ask one field at a time; never dump schema
  - **No PHI** (no allergies/medical notes)
- **Failure modes + messaging**:
  - Missing required field → ask for exactly that field next

### U06 — Registration: Schedule‑at‑open (set‑and‑forget)

- **User intent / examples**: “Schedule it”, “Do it when it opens”
- **Entry points**: `signupassist.chat`
- **Auth required**: OAuth + explicit confirmation
- **States**: `FORM_FILL → REVIEW → PAYMENT → SUBMIT → COMPLETED`
- **Successful exit**: scheduled job created + receipt reference returned (SCH‑…)
- **Context updates**: `schedulingData`, `paymentAuthorized`, `step`
- **Backend calls**:
  - `scheduler.schedule_registration`
  - `stripe.*` setup (if missing payment method)
  - receipt creation tools (e.g., `registrations.create`) as applicable
- **Compliance gates**:
  - Explicit user confirmation before scheduling/charging
- **Failure modes + messaging**:
  - Payment method missing → route to U08 first

### U07 — Registration: Book‑now (immediate execution)

- **User intent / examples**: “Confirm”, “Authorize”, “Book it”
- **Entry points**: `signupassist.chat`
- **Auth required**: OAuth + explicit confirmation
- **States**: `FORM_FILL → REVIEW → PAYMENT → SUBMIT → COMPLETED`
- **Successful exit**: provider booking confirmed + receipt reference returned (REG‑…)
- **Context updates**: `paymentAuthorized`, `step`
- **Backend calls**:
  - `stripe.charge_success_fee` (only on success)
  - provider booking confirmation tool(s)
  - `registrations.create`
- **Compliance gates**:
  - No payment without explicit authorization
  - Stripe hosted checkout only (no card entry in app)
  - Audit trail for consequential actions
- **Failure modes + messaging**:
  - Provider failure → do not charge success fee; offer retry/contact support

### U08 — Account Management: Payment method setup

- **User intent / examples**: “Add a card”, “Update payment method”
- **Entry points**: `signupassist.chat`
- **Auth required**: OAuth
- **States**: typically `PAYMENT` (or stays in current step with a detour)
- **Successful exit**: payment method saved + user returned to next step
- **Context updates**: `cardLast4`, `cardBrand`
- **Backend calls**:
  - `stripe.create_customer`
  - `stripe.create_checkout_session`
  - `stripe.save_payment_method`
  - `stripe.check_payment_status`
- **Compliance gates**:
  - Always redirect to Stripe hosted flow; never request card numbers in chat
- **Failure modes + messaging**:
  - Checkout cancelled → return to prior step without booking

### U09 — Post‑Booking: View receipts / history

- **User intent / examples**: “Show my registrations”, “View receipts”
- **Entry points**: `signupassist.chat`
- **Auth required**: OAuth
- **States**: usually does not change flow step
- **Successful exit**: list of receipts / registrations
- **Context updates**: none (or pagination cursor)
- **Backend calls**: `registrations.list`
- **Compliance gates**: only show the authenticated user’s data
- **Failure modes + messaging**: none found → explain + offer to browse programs

### U10 — Post‑Booking: Cancel (scheduled or completed)

- **User intent / examples**: “Cancel SCH‑123”, “Cancel REG‑123”
- **Entry points**: `signupassist.chat`
- **Auth required**: OAuth + explicit confirmation
- **States**: may temporarily enter a “confirm cancel” prompt; otherwise unchanged
- **Successful exit**: cancellation confirmed; refund (if applicable) executed
- **Context updates**: `pendingCancelRef` (optional)
- **Backend calls**:
  - Scheduled: `scheduler.cancel_scheduled_registration`
  - Completed: `registrations.cancel_with_refund` (if supported)
- **Compliance gates**:
  - Always confirm before cancellation/refund
  - Audit cancellation + refund actions
- **Failure modes + messaging**:
  - Not cancellable → explain policy + offer support

### U11 — Error Recovery: Start over / clear context

- **User intent / examples**: “Start over”, “Clear this”
- **Entry points**: `signupassist.chat`
- **Auth required**: none
- **States**: `BROWSE`
- **Successful exit**: new browse flow begins
- **Context updates**: reset session context
- **Backend calls**: delete session row (if supported)
- **Compliance gates**: none

### U12 — Error Recovery: Session / provider failures

- **User intent / examples**: “It got stuck”, “Something broke”
- **Entry points**: `signupassist.chat`
- **Auth required**: none (unless user requests receipts)
- **States**: varies
- **Successful exit**: user can retry, start over, or contact support
- **Context updates**: optional `lastError`, reset flags
- **Backend calls**: none (or retried provider calls)
- **Compliance gates**:
  - Never “guess” a booking succeeded; confirm via provider response/receipt



