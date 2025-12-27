# V1 Scheduled Signup Smoke Test (SCH → Worker → REG)

This is the canonical verification plan for the **schedule-at-open** flow:

1) create a scheduled job (`scheduled_registrations`)  
2) worker executes it at `scheduled_time` (rapid retries)  
3) receipt is created (`registrations`)  
4) user can view/cancel/audit in **text-only** ChatGPT v1

---

## Preconditions

- **Web service** deployed and healthy (MCP server)
- **Worker service** deployed and running (`npm run worker:scheduled`)
- Env vars set per `docs/V1_ENV_VARS.md`
- Supabase contains program feed data for the org you’re testing (v1 default: `aim-design`)

Optional sanity:
- Run endpoint smoke: `./scripts/v1_endpoint_smoke.sh <BASE_URL>`
- Run DB preflight: `npm run v1:preflight`

---

## Test A: “Fast scheduled” (recommended staging smoke)

This test doesn’t need a real “opens_at” window. It validates the worker and receipts pipeline.

### Step 1 — Create a scheduled job

In ChatGPT (text-only), go through:
- browse programs → select a program
- fill required fields
- choose **schedule** and pick a time ~2–3 minutes in the future
- confirm scheduled registration

Expected:
- Chat response includes a **`SCH-xxxxxxxx`** reference (via `view_receipts`)
- Supabase has a row in `scheduled_registrations` with `status='pending'`

### Step 2 — Worker executes the job

Expected transitions in `scheduled_registrations`:
- `pending` → `executing` → `completed`

Also expected:
- A row in `registrations` with:
  - `booking_number` populated (provider confirmation)
  - `success_fee_cents=2000` (charged only on success)
  - provider payment state fields populated when available

### Step 3 — Verify user-visible controls (text-only)

In chat:
- “view my registrations” should list both **SCH** and **REG** codes
- “audit SCH-xxxxxxxx” shows scheduled job audit events
- “audit REG-xxxxxxxx” shows booking + success fee + receipt events

---

## Test B: Cancel scheduled job (SCH) before execution

### Step 1 — Create a scheduled job ~5 minutes out

Expected: `scheduled_registrations.status='pending'`

### Step 2 — Cancel via text-only confirmation

In chat: `cancel SCH-xxxxxxxx`

Expected:
- assistant asks for confirmation (“reply yes/no”)
- reply “yes”
- DB: `scheduled_registrations.status='cancelled'`
- worker must not execute it

---

## Test C: Cancel confirmed booking (REG) (if enabled)

In chat: `cancel REG-xxxxxxxx`

Expected:
- Bookeo cancellation attempted (`bookeo.cancel_booking`)
- SignupAssist success fee refund attempted (`stripe.refund_success_fee`) if `charge_id` exists

---

## Automation helper (optional)

If you have Supabase env vars locally, you can monitor a job:

```bash
npm run v1:watch-scheduled -- <scheduled_registration_id>
```


