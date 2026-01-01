# Prioritization & Rate Limiting Spec (placeholders)

This document defines **how SignupAssist prioritizes and executes many queued signups** that target the same provider session, while staying transparent and compliant.

Status: **placeholders** until we learn provider-specific limits and semantics.

Related docs:
- [Scheduled Registration Worker Runbook](./SCHEDULED_REGISTRATION_WORKER_RUNBOOK.md)
- Worker implementation reference: [`mcp_server/worker/scheduledRegistrationWorker.ts`](../mcp_server/worker/scheduledRegistrationWorker.ts)

---

## Goals

- **Policy clarity (user-facing)**: Define a fair, defensible ordering rule when many users queue for the same session.
- **Execution safety (engineering)**: Scale without triggering throttles/blocks that reduce overall success.
- **Provider-agnostic defaults**: Start conservative; tune per provider/org as we learn.
- **Correctness + compliance**: Avoid double-booking, preserve audit trail, and respect PII redaction.

Non-goals (for now):
- Guaranteeing seat allocation outcomes (providers decide).
- Deep provider-specific optimization (holds/waitlists) beyond placeholders.

---

## Terminology & entities

- **Provider**: External registration platform (e.g., Bookeo, CampMinder).
- **Org credential**: An org-level API key/token used by SignupAssist for a provider org. (Current assumption: **shared org-level credential**.)
- **Event/session**: The provider unit that becomes available (e.g., a class slot) at a particular time.
- **Scheduled job**: A durable record representing a queued auto-registration attempt.
  - Current DB table: `scheduled_registrations`
- **Receipt/registration record**: Post-execution record for transparency/status/audit lookup.
  - Current DB table: `registrations`
- **Audit events**: Tool calls + decisions logged for transparency.
  - Current DB table: `audit_events`

---

## Policy: first-come-first-served (FCFS)

### Policy statement (what we promise)

When multiple users queue for the **same session** (same provider/org/event), SignupAssist will **attempt registrations in first-come-first-served order**, based on when each user scheduled with SignupAssist.

Important caveat: **providers ultimately decide who gets the seat**. Our policy controls attempt ordering and retry budget, not the provider’s internal allocation.

### FCFS ordering definition

For jobs targeting the same session, compute a deterministic ordering key:

1) `scheduled_time` (earliest executes first)  
2) `queued_at` (when user confirmed “book now” / job created)  
3) `tie_breaker` (stable deterministic hash)  

Recommended tie-breaker:

- `tie_breaker = sha256(user_id + scheduled_time + event_id)` (truncate for ordering)

### Fairness across multiple sessions under the same org credential

Org credentials share rate limits, so a “hot” session should not starve other sessions for the same org.

- **Within a session**: strict FCFS.
- **Across sessions (same provider+org)**: round-robin (or weighted round-robin) across session queues to allocate org-level capacity.

---

## Core constraint: org-level shared rate limits

With org-level credentials, the provider typically rate-limits at **(provider, org_ref)**, not per user. Therefore:

- We need a shared **dispatch budget** per `(provider, org_ref)`.
- Priority/fairness is implemented by how we allocate that shared budget across session queues and job ranks.

---

## Execution model (queues + dispatch)

### Queue keys

- **Session queue key**: `(provider, org_ref, event_id)`
- **Org dispatch key**: `(provider, org_ref)` (rate limiting + concurrency caps live here)

### Architecture

```mermaid
flowchart TD
userQueue[UserQueuesJob] --> jobRow[scheduled_registrations]
jobRow --> schedulerScan[WorkerScanOrScheduler]
subgraph orgDispatch [OrgDispatch(provider,org_ref)]
  schedulerScan --> eventQueues[EventQueues(provider,org_ref,event_id)]
  eventQueues --> pacing[MicroPacingAndOrdering]
  pacing --> limiter[RateLimiterAndConcurrencyCaps]
end
limiter --> providerAPI[ProviderAPI]
providerAPI --> outcome[OutcomeClassifier]
outcome --> receipts[registrations]
outcome --> audit[audit_events]
```

### Micro-pacing (preserves FCFS while reducing burstiness)

Even with strict FCFS, firing many requests in the same millisecond can trigger throttles.
We preserve FCFS while smoothing load via deterministic pacing:

`send_at = scheduled_time + rank * min_spacing_ms`

- `rank`: position in FCFS ordering within the session queue
- `min_spacing_ms`: provider/org placeholder (start conservative; tune later)

### Concurrency + rate limiting

Per `(provider, org_ref)`, enforce:

- `max_concurrency`: max in-flight provider requests
- `max_rps`: max requests per second
- `burst`: short burst capacity

Implementation options: token bucket + semaphore (or leaky bucket).

---

## Provider capability profile (placeholders)

Instead of hard-coding per provider everywhere, define a capability sheet that can be filled later:

- `booking_model`: `immediate_commit | hold_then_commit | checkout_finalizes | waitlist_only | unknown`
- `supports_hold`: boolean
- `hold_ttl_ms`: number | null
- `supports_waitlist`: boolean
- `idempotency_key_supported`: boolean
- `idempotency_key_location`: `header | body | query | none`
- `rate_limit_scope`: `org_key | ip | user | unknown`
- `error_taxonomy`: provider error → `transient | permanent`
- `success_definition`: what response counts as “seat secured”

---

## Config placeholders (YAML)

Start conservative; tune from production telemetry.

```yaml
providers:
  default:
    # Org-level dispatch controls (provider, org_ref)
    max_concurrency: 2
    max_rps: 2
    burst: 4
    min_spacing_ms: 50

    retry:
      window_ms: 120000
      backoff_ms: [250, 500, 1000, 2000]
      retry_on_http: [408, 429, 500, 502, 503, 504]
      fail_fast_on_codes:
        - validation_error
        - sold_out
        - not_found

  bookeo:
    # Placeholders — tune later
    max_concurrency: 3
    max_rps: 3
    burst: 6
    min_spacing_ms: 40

  campminder:
    # Placeholders — tune later
    max_concurrency: 1
    max_rps: 1
    burst: 2
    min_spacing_ms: 100
```

---

## Retries & fairness

### Retry budget per job (bounded)

To preserve fairness and prevent one job from consuming the org’s entire dispatch budget:

- Each job gets a **retry window** (e.g., 30–120s after `scheduled_time`).
- Each job uses a capped backoff schedule.
- Permanent errors fail fast and free capacity.

### Error classification (generic)

- **Transient (retry)**:
  - network timeouts
  - provider 5xx
  - provider 429 (after a short delay)
  - “not yet open” race conditions near open time

- **Permanent (fail fast)**:
  - validation errors
  - sold out / capacity exceeded
  - program/session not found
  - auth/credential errors (unless clearly transient)

---

## Multi-worker scaling & coordination

As volume grows, multiple worker instances will execute concurrently.

Requirements:
- **Atomic claiming** (one worker executes a job): `pending -> executing` with conditional update.
- **Idempotency**: retries must not double-book; use provider idempotency keys when available.
- **Time correctness**: treat `scheduled_time` as authoritative and minimize clock skew.

Current implementation reference:
- `scheduledRegistrationWorker.ts` uses conditional updates on `scheduled_registrations` to claim work.

---

## Observability (what to log now)

To turn placeholders into real limits, track:

### Queue + fairness metrics
- queued job count by `(provider, org_ref, event_id)`
- time-to-first-attempt (p50/p95)
- time-to-success/fail (p50/p95)
- success rate by **rank** (e.g., 1–10 vs 100–200)

### Provider health metrics
- response latency p50/p95 by provider/org
- 429 rate, 5xx rate
- error taxonomy counts (sold out vs throttled vs validation)

### Capacity metrics
- in-flight requests (concurrency)
- effective requests/sec (RPS) and burst usage

---

## Failure modes & mitigations (placeholders)

- **Thundering herd at open time**: micro-pacing + org dispatch limiter
- **Provider throttling (429)**: adaptive reduction of concurrency/RPS; increase spacing
- **Provider outage (5xx)**: bounded retry window; mark failed with clear message
- **Duplicate execution**: atomic claiming + idempotency
- **Partial success (booking succeeds, fee charge fails)**: booking is success; receipt + audit; fee failure is non-fatal + alert

---

## Security & compliance notes

- **Audit trail**: consequential actions must be logged (`audit_events`) and visible to users.
- **PII redaction**: do not persist raw child/parent PII in audit args; keep hashes + timeline.
- **Transparency**: user messaging should state:
  - FCFS attempt order (if relevant)
  - provider decides seat allocation
  - charges occur only on success (platform fee); provider fees handled by provider

### User-facing transparency language (templates)

These templates keep messaging **accurate, consistent, and non-technical**.

Notes:
- Avoid implying we can “guarantee” the seat.
- Avoid implying we “charge now” for scheduled jobs (charges are success-only).

#### Template: queue/schedule confirmation (FCFS + provider caveat)

> You’re queued for **{program_name}** at **{opens_at}**.\n\
> We’ll attempt registration **first-come-first-served** based on when people scheduled with SignupAssist.\n\
> Final availability is determined by **{provider_name}**.\n\
> No charge now — the SignupAssist success fee is charged **only if registration succeeds**.

#### Template: answer “how do you prioritize?” (short)

> We attempt queued registrations **in the order they were scheduled with SignupAssist (first-come-first-served)**.\n\
> The provider ultimately decides who gets the seat, but we log everything in your audit trail.

#### Template: oversubscribed outcome (sold out / no seat)

> We attempted registration right when it opened, but the provider reported the session was already full.\n\
> You were **not charged**. You can view the attempt timeline via **view my registrations → audit …**.

#### Template: transient throttling (429) / retries

> The provider rate-limited requests right at open time, so we retried for a short window.\n\
> If we can’t secure a spot within that window, we’ll mark the attempt as failed and you won’t be charged.\n\
> You can review the timeline in your audit trail.

#### Template: success (scheduled job executed)

> Registration succeeded — you’re in.\n\
> You’ll see a receipt in **view my registrations** and the full timeline in **audit …**.

---

## Appendix

### Glossary

- **FCFS**: First-come-first-served ordering for attempt execution.
- **Org dispatch**: shared rate-limited capacity for an org credential.
- **Micro-pacing**: deterministic spacing by rank to reduce burstiness while preserving FCFS.


