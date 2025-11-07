# Railway Cache Architecture – Fast Program Discovery

## 🎯 Objective
Achieve **<2 second program discovery** using pre-fetched catalog data, eliminating login gates before program browsing.

---

## 🏗️ Architecture Overview

```
User Message
    ↓
[1] Parse A-A-P Triad (Age, Activity, Provider)
    ↓
[2] Missing data? → Ask ONE clarifying question → Stop
    ↓
[3] Query cached_programs with filters
    ├─ Hit (>80%) → Return grouped cards (<2s)
    └─ Miss → Trigger background refresh + "Fetching fresh data..."
    ↓
[4] User selects program
    ↓
[5] NOW check prerequisites (login, waivers, payment method)
    ↓
[6] Proceed to registration
```

---

## 📊 Database Schema

### Current: `cached_programs` table
```sql
CREATE TABLE cached_programs (
  id uuid PRIMARY KEY,
  org_ref text NOT NULL,           -- e.g., "blackhawk-ski"
  category text NOT NULL,           -- e.g., "lessons", "camps", "all"
  cache_key text UNIQUE,            -- "{org_ref}:{category}"
  programs_by_theme jsonb NOT NULL, -- Grouped program data
  metadata jsonb,                   -- { last_fetch, source, version }
  cached_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz,
  updated_at timestamptz
);

-- Indexes for fast lookup
CREATE INDEX idx_cached_programs_org_category ON cached_programs(org_ref, category);
CREATE INDEX idx_cached_programs_expiry ON cached_programs(expires_at);
```

### Proposed Enhancement: Add age fields for faster filtering
```sql
-- Optional: Add age_min/age_max to programs_by_theme.groups[].cards[]
-- This enables SQL-level filtering instead of application-level

-- Example structure:
{
  "groups": [
    {
      "title": "Beginner Lessons",
      "theme": "lessons",
      "cards": [
        {
          "id": "prog-123",
          "title": "Alpine Basics",
          "age_min": 6,
          "age_max": 10,
          "schedule": "Saturdays 9-11 AM",
          "price": "$125",
          "status": "open"
        }
      ]
    }
  ]
}
```

---

## 🔄 Cache Refresh Strategy

### Primary: Nightly Cron (via `refresh-program-cache`)
- **Frequency:** Daily at 2 AM
- **Scope:** All high-traffic org_refs (e.g., blackhawk-ski, vail-resorts)
- **TTL:** 24 hours
- **Method:** Full scrape → `upsert_cached_programs` RPC

### Secondary: On-Demand (cache miss)
- **Trigger:** User query for uncached org/category
- **Method:** Fire-and-forget background job
- **Priority:** Low (don't block user response)
- **Fallback:** Show "Fetching fresh data, this may take 60-90s"

### Invalidation
- Manual: Admin triggers via `/api/admin/invalidate-cache`
- Automatic: `expires_at` cleanup via scheduled job

---

## 🚀 Pre-Login Narrowing Flow

### Phase 1: A-A-P Triage (Age, Activity, Provider)

**Extract from user message:**
```typescript
const triad = parseAAPTriad(message, context);
// Returns: { age?: number, activity?: string, provider?: string, complete: boolean, missing: string[] }
```

**If incomplete:**
```typescript
if (!triad.complete) {
  const question = buildAAPQuestion(triad);
  return { message: question, type: 'clarification' };
}
```

**Example:**
```
User: "I need skiing lessons"
AI: "What's your child's age? (This helps me show age-appropriate programs)"
User: "7"
AI: "Which organization? (e.g., Blackhawk Ski Club, YMCA)"
User: "Blackhawk"
AI: [queries cache] → [shows cards]
```

### Phase 2: Cache Lookup

**Query with filters:**
```typescript
const cached = await findProgramsCached(
  orgRef: 'blackhawk-ski',
  category: 'lessons',
  childAge: 7,
  maxAgeHours: 24
);
```

**Age filtering (application-level):**
```typescript
if (childAge) {
  programs.groups = programs.groups
    .map(group => ({
      ...group,
      cards: group.cards.filter(card => isAgeAppropriate(card, childAge))
    }))
    .filter(group => group.cards.length > 0);
}
```

### Phase 3: Render Cards

**Cache hit:**
```json
{
  "message": "Here are skiing lessons for a 7-year-old at Blackhawk:",
  "cards": {
    "type": "carousel",
    "groups": [
      {
        "title": "Beginner Lessons",
        "cards": [
          { "id": "prog-123", "title": "Alpine Basics", ... }
        ]
      }
    ]
  },
  "cta": ["View details", "See schedule"]
}
```

**Cache miss:**
```json
{
  "message": "Fetching fresh program data for Blackhawk... This may take 60-90 seconds.",
  "status": "loading"
}
```

---

## ⚡ Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Cache hit rate | >80% | TBD |
| P50 response time | <2s | TBD |
| P95 response time | <5s | TBD |
| Cache staleness | <24h | 24h |

---

## 🔐 Security & Privacy

**No login required for discovery:**
- All cached data is public-facing program info (title, schedule, price)
- No PII stored in cache
- Credentials/payments only requested AFTER program selection

**Audit trail:**
- Cache lookups logged to `audit_events` with `event_type: 'cache_lookup'`
- Background refreshes logged with `event_type: 'cache_refresh'`

---

## 🧪 Testing Checklist

- [ ] Cache hit returns results in <2s
- [ ] Cache miss triggers background refresh
- [ ] Age filtering works correctly
- [ ] A-A-P triage asks ONE question only
- [ ] User can decline triage and get broader results
- [ ] No login required until program selection
- [ ] Cards render correctly in ChatGPT interface
- [ ] Background refresh populates cache for next request

---

## 📈 Monitoring

**Key metrics:**
```sql
-- Cache hit rate
SELECT 
  COUNT(*) FILTER (WHERE cache_hit) * 100.0 / COUNT(*) as hit_rate
FROM audit_events 
WHERE event_type = 'cache_lookup'
  AND created_at > now() - interval '7 days';

-- Average response time
SELECT 
  percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95
FROM audit_events
WHERE event_type = 'program_discovery'
  AND created_at > now() - interval '7 days';

-- Stale cache entries
SELECT org_ref, category, cached_at, expires_at
FROM cached_programs
WHERE expires_at < now() + interval '6 hours'
ORDER BY expires_at;
```

---

## 🚀 Implementation Phases

### Phase 1: Core Cache Lookup (2-3h)
- [x] Update `findProgramsCached` with age filtering
- [x] Add `isAgeAppropriate` helper
- [x] Add background refresh trigger stub
- [ ] Test cache hit/miss flow

### Phase 2: Pre-Login Narrowing (3-4h)
- [x] Create `preLoginNarrowing.ts` module
- [x] Add `parseAAPTriad` function
- [x] Add `buildAAPQuestion` function
- [ ] Integrate into AIOrchestrator
- [ ] Test A-A-P triage flow

### Phase 3: ChatGPT Integration (4-6h)
- [ ] Update OpenAPI spec for card format
- [ ] Add system prompt for Railway cache flow
- [ ] Test in ChatGPT Apps interface
- [ ] Performance benchmarking

### Phase 4: Monitoring & Optimization (2-3h)
- [ ] Add cache metrics to audit_events
- [ ] Create monitoring dashboard
- [ ] Tune cache TTL based on hit rate
- [ ] Document runbook for cache issues

**Total: 11-16 hours**

---

## 📚 Related Documentation

- [ChatGPT Integration Guide](./CHATGPT_INTEGRATION.md)
- [Design DNA Principles](./design_dna.pdf)
- [Program Discovery Prompts](./PROGRAM_DISCOVERY_PROMPTS.md)
- [Orchestrator Card Flow](./ORCHESTRATOR_CARD_FLOW.md)
