# Deploy Smoke Checklist (5–10 minutes)

This is a lightweight checklist to run after a Railway deploy to catch the most common regressions fast.

## 1) Verify the build/commit running

- Hit `GET /health`
- Confirm the response includes the expected `BUILD` SHA / built-at timestamp.

## 2) Browse + select program (Step 1/5)

- In ChatGPT: “browse classes”
- Confirm:
  - Programs render quickly
  - Selecting a program advances into the flow (no unexpected resets to browse)

## 3) Multi-child selection UX (Step 2/5)

- Add first child (or pick from saved children).
- When asked “register another child?”:
  - Confirm remaining saved children are listed as numbered options.
  - Pick a child by **number** and by **name**.
  - Choose **Different child** and enter a new child (name + age/DOB).

## 4) Review summary correctness (Step 4/5)

- Confirm Review includes:
  - All children listed (not just the first)
  - Program fee line shows `× N children = $Total`
  - Payment method on file shown (brand + last4 when available)

## 5) Booking submission resilience (Step 5/5)

- Type **book now**
- If ChatGPT retries or you re-send **book now**:
  - Confirm it does **not** double-book (idempotency guard)
  - You should either see “already working…” or a replayed confirmation

## 6) Receipts + audit trail

- “view my registrations” → newest REG should appear
- “audit REG-xxxxxxxx” → audit trail renders (no crashes)


