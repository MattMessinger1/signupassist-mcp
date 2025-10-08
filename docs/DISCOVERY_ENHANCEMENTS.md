# Discovery System Enhancements - Implementation Plan

## Overview
Four additive improvements to enhance observability, consistency, and robustness of the existing discovery system. All changes are **non-breaking** and build on the current architecture.

**Total Estimated Time:** 11-15 hours across 4 independent priorities

---

## Priority 1: Standardize Field Keys (2-3 hours)

### Goal
Adopt consistent namespace pattern for field keys across all providers to improve mapping and audit trails.

### Changes

**1. Create namespace constants** (`mcp_server/types/pricing.ts`):
```typescript
export const FIELD_NAMESPACES = {
  CHILD: 'child.',
  GUARDIAN: 'guardian.',
  PROGRAM: 'program.option.',
  MEMBERSHIP: 'membership.',
  WAIVER: 'waiver.',
  PAYMENT: 'payment.'
} as const;

export type FieldNamespace = typeof FIELD_NAMESPACES[keyof typeof FIELD_NAMESPACES];
```

**2. Update field key normalization** (`mcp_server/lib/serial_field_discovery.ts`):
```typescript
import { FIELD_NAMESPACES } from '../types/pricing.js';

function normalizeFieldKey(rawKey: string, label?: string): string {
  // Already namespaced? Return as-is
  if (Object.values(FIELD_NAMESPACES).some(ns => rawKey.startsWith(ns))) {
    return rawKey;
  }

  // Infer namespace from label/name patterns
  const lower = (label || rawKey).toLowerCase();
  
  if (lower.includes('child') || lower.includes('student') || lower.includes('participant')) {
    return `${FIELD_NAMESPACES.CHILD}${rawKey}`;
  }
  if (lower.includes('parent') || lower.includes('guardian') || lower.includes('emergency')) {
    return `${FIELD_NAMESPACES.GUARDIAN}${rawKey}`;
  }
  if (lower.includes('membership') || lower.includes('member')) {
    return `${FIELD_NAMESPACES.MEMBERSHIP}${rawKey}`;
  }
  if (lower.includes('waiver') || lower.includes('consent')) {
    return `${FIELD_NAMESPACES.WAIVER}${rawKey}`;
  }
  if (lower.includes('payment') || lower.includes('billing') || lower.includes('card')) {
    return `${FIELD_NAMESPACES.PAYMENT}${rawKey}`;
  }
  
  // Default to program namespace
  return `${FIELD_NAMESPACES.PROGRAM}${rawKey}`;
}
```

**3. Update frontend field mapping** (`src/lib/fieldMapping.ts`):
- Update `COMMON_FIELD_MAPPINGS` to use namespaced keys
- Add migration logic to handle old keys

### Testing
- Run discovery on existing program
- Verify field keys have proper namespaces
- Confirm old field mappings still work

---

## Priority 2: Structured Event Emitter (3-4 hours) ✅ IMPLEMENTED

### Goal
Add stage-level timing and structured events for precise performance monitoring and debugging.

### Implementation Steps

#### Step 1: Create Event Emitter Module (30 min)

**File: `mcp_server/lib/events.ts`** (new file)

```typescript
/**
 * Discovery Event Emitter
 * Tracks stage-level timing and events for performance monitoring
 */

export type StageType = 
  | 'auth'              // Login/authentication
  | 'prereq_check'      // Individual prerequisite check (membership, waiver, payment)
  | 'nav_to_program'    // Navigation to program registration form
  | 'dom_ready'         // Waiting for DOM elements
  | 'field_discovery'   // Serial field discovery loop
  | 'submit'            // Form submission attempt
  | 'retry'             // Retry logic
  | 'completed';        // Final completion

export type EventType = 
  | 'stage.start' 
  | 'stage.end' 
  | 'discovery.completed' 
  | 'error'
  | 'warning';

export interface DiscoveryEvent {
  type: EventType;
  stage?: StageType;
  timestamp: number;
  duration_ms?: number;
  metadata?: Record<string, any>;
}

// Thread-local event storage (cleared per discovery run)
let events: DiscoveryEvent[] = [];

/**
 * Emit a discovery event
 */
export function emitEvent(event: Omit<DiscoveryEvent, 'timestamp'>): void {
  const fullEvent: DiscoveryEvent = {
    ...event,
    timestamp: Date.now()
  };
  
  events.push(fullEvent);
  
  // Console logging for immediate visibility
  const label = event.stage ? `${event.type}:${event.stage}` : event.type;
  const meta = event.metadata ? JSON.stringify(event.metadata) : '';
  console.log(`[Event] ${label} ${meta}`);
}

/**
 * Get all events from current discovery run
 */
export function getEvents(): DiscoveryEvent[] {
  return [...events];
}

/**
 * Clear events (call at start of each discovery run)
 */
export function clearEvents(): void {
  events.length = 0;
}

/**
 * Compute duration between stage start and end
 */
export function computeStageDuration(stage: StageType): number | null {
  const start = events.find(e => e.type === 'stage.start' && e.stage === stage);
  const end = events.find(e => e.type === 'stage.end' && e.stage === stage);
  
  if (start && end) {
    return end.timestamp - start.timestamp;
  }
  return null;
}

/**
 * Get summary of all stage timings
 */
export function getStageSummary(): Record<string, number | null> {
  const stages: StageType[] = [
    'auth',
    'prereq_check',
    'nav_to_program',
    'dom_ready',
    'field_discovery',
    'submit',
    'retry',
    'completed'
  ];
  
  const summary: Record<string, number | null> = {};
  for (const stage of stages) {
    summary[`${stage}_ms`] = computeStageDuration(stage);
  }
  
  // Compute total time
  if (events.length > 0) {
    summary.total_ms = events[events.length - 1].timestamp - events[0].timestamp;
  }
  
  return summary;
}
```

#### Step 2: Integrate into Login Flow (30 min)

**File: `mcp_server/lib/login.ts`** (update existing)

```typescript
import { emitEvent } from './events.js';

export async function loginWithCredentials(
  page: Page,
  creds: { email: string; password: string },
  postLoginCheck: any,
  context?: any
): Promise<LoginResult> {
  
  emitEvent({ type: 'stage.start', stage: 'auth' });
  const authStart = Date.now();
  
  console.log('[Login] Starting login for org:', postLoginCheck.orgRef || 'unknown');
  
  // ... existing login logic ...
  
  const duration = Date.now() - authStart;
  emitEvent({ 
    type: 'stage.end', 
    stage: 'auth',
    duration_ms: duration,
    metadata: { 
      strategy: result.strategy,
      verified: result.verified 
    }
  });
  
  return result;
}
```

#### Step 3: Integrate into Prerequisite Discovery (45 min)

**File: `mcp_server/lib/unified_discovery.ts`** (update existing)

```typescript
import { emitEvent, clearEvents, getEvents, getStageSummary } from './events.js';

export async function discoverPrerequisites(
  page: Page,
  orgRef: string,
  baseDomain: string,
  provider: string,
  warmHints: Record<string, any>
): Promise<PrerequisiteDiscoveryResult> {
  
  console.log('[PrereqDiscovery] Using unified domain:', baseDomain, 'baseUrl:', `https://${baseDomain}`);
  
  const paths = getPrerequisitePaths(provider, orgRef);
  console.log(`[PrereqDiscovery] Checking ${paths.length} prerequisite paths for provider: ${provider}`);
  
  const checks: PrerequisiteCheckResult[] = [];
  let totalLoopCount = 0;
  let totalConfidence = 0;
  
  for (const prereq of paths) {
    // Emit start event for this specific prereq check
    emitEvent({ 
      type: 'stage.start', 
      stage: 'prereq_check',
      metadata: { prereq_id: prereq.id, prereq_label: prereq.displayName }
    });
    const prereqStart = Date.now();
    
    console.log(`[PrereqDiscovery] Checking ${prereq.displayName} (${prereq.id})...`);
    
    const targetUrl = `https://${baseDomain}${prereq.path}`;
    console.log(`[PrereqDiscovery] Navigating to ${prereq.path}...`);
    
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await humanPause(800, 1500);
      
      // ... existing discovery logic ...
      
      const duration = Date.now() - prereqStart;
      emitEvent({
        type: 'stage.end',
        stage: 'prereq_check',
        duration_ms: duration,
        metadata: {
          prereq_id: prereq.id,
          status: result.checkStatus,
          fields_found: result.fieldsDiscovered?.length || 0
        }
      });
      
      checks.push(result);
      
    } catch (error) {
      emitEvent({
        type: 'error',
        stage: 'prereq_check',
        metadata: { prereq_id: prereq.id, error: error.message }
      });
      // ... existing error handling ...
    }
  }
  
  // ... rest of function ...
}
```

#### Step 4: Integrate into Program Discovery (45 min)

**File: `mcp_server/lib/unified_discovery.ts`** (update existing)

```typescript
export async function navigateToProgramForm(
  page: Page, 
  programRef: string, 
  baseDomain: string
): Promise<void> {
  
  emitEvent({ 
    type: 'stage.start', 
    stage: 'nav_to_program',
    metadata: { program_ref: programRef }
  });
  const navStart = Date.now();
  
  console.log('[ProgramNav] Using unified domain:', baseDomain, 'url:', `https://${baseDomain}`);
  
  // ... existing navigation logic ...
  
  const duration = Date.now() - navStart;
  emitEvent({
    type: 'stage.end',
    stage: 'nav_to_program',
    duration_ms: duration,
    metadata: { final_url: page.url() }
  });
}

export async function discoverProgramFieldsMultiStep(
  page: Page,
  programRef: string,
  warmHints: Record<string, any>
): Promise<{
  fields: DiscoveredField[];
  loopCount: number;
  confidence: number;
  urlsVisited: string[];
  stops?: { reason: string; evidence?: any };
}> {
  
  emitEvent({ 
    type: 'stage.start', 
    stage: 'field_discovery',
    metadata: { program_ref: programRef }
  });
  const discoveryStart = Date.now();
  
  const allFields: DiscoveredField[] = [];
  const urlsVisited: string[] = [];
  let totalLoops = 0;
  
  // ... existing multi-step logic ...
  
  const duration = Date.now() - discoveryStart;
  emitEvent({
    type: 'stage.end',
    stage: 'field_discovery',
    duration_ms: duration,
    metadata: {
      fields_found: allFields.length,
      loops: totalLoops,
      urls_visited: urlsVisited.length
    }
  });
  
  return { fields: allFields, loopCount: totalLoops, confidence, urlsVisited, stops };
}
```

#### Step 5: Integrate into Serial Discovery Loop (30 min)

**File: `mcp_server/lib/serial_field_discovery.ts`** (update existing)

```typescript
import { emitEvent } from './events.js';

export async function discoverFieldsSerially(
  page: Page,
  programRef: string,
  warmHints: Record<string, any> = {}
): Promise<SerialDiscoveryResult> {
  
  const discovered = new Map<string, DiscoveredField>();
  const seen = new Set<string>();
  let loopCount = 0;
  let successDetected = false;
  
  console.log('[SerialDiscovery] Starting discovery loop...');
  
  // DOM ready check
  emitEvent({ type: 'stage.start', stage: 'dom_ready' });
  await page.waitForLoadState('domcontentloaded');
  emitEvent({ type: 'stage.end', stage: 'dom_ready' });
  
  // ... existing loop logic ...
  
  while (loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(`[SerialDiscovery] Loop ${loopCount}/${MAX_LOOPS}`);
    
    // ... fill fields ...
    
    // Emit submit attempt
    emitEvent({ 
      type: 'stage.start', 
      stage: 'submit',
      metadata: { loop: loopCount }
    });
    
    const submitted = await trySubmit(page);
    
    emitEvent({
      type: 'stage.end',
      stage: 'submit',
      metadata: { submitted, loop: loopCount }
    });
    
    // ... rest of loop ...
  }
  
  // ... return result ...
}
```

#### Step 6: Store Events in Discovery Runs (30 min)

**File: `mcp_server/providers/skiclubpro.ts`** (update existing)

```typescript
import { clearEvents, getEvents, getStageSummary } from '../lib/events.js';

export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs): Promise<FieldSchema> {
  // ... existing validation ...
  
  return await auditToolCall(
    { /* ... */ },
    args,
    async () => {
      // Clear events at start of discovery
      clearEvents();
      
      // ... existing discovery logic ...
      
      // STAGE: PREREQUISITES ONLY
      if (stage === 'prereq' || stage === 'prerequisites_only') {
        // ... existing prereq logic ...
        
        const prereqResult = await discoverPrerequisites(/* ... */);
        
        // Collect events and timings
        const allEvents = getEvents();
        const timings = getStageSummary();
        
        return {
          program_ref: args.program_ref,
          prerequisite_status: prereqResult.overallStatus,
          program_questions: [],
          metadata: {
            url: baseUrl,
            field_count: 0,
            categories: [],
            discovered_at: new Date().toISOString(),
            // Add events and timings
            events: allEvents,
            timings: timings,
            prerequisitesConfidence: prereqResult.confidence,
            prerequisitesLoops: prereqResult.loopCount,
            run: runId,
            stage: 'prereq'
          }
        } as FieldSchema;
      }
      
      // STAGE: PROGRAM DISCOVERY
      // ... existing program logic ...
      
      const programResult = await discoverProgramFieldsMultiStep(/* ... */);
      
      // Collect events and timings
      const allEvents = getEvents();
      const timings = getStageSummary();
      
      return {
        program_ref: args.program_ref,
        program_questions: programResult.fields,
        metadata: {
          url: programSession.page.url(),
          field_count: programResult.fields.length,
          categories: [],
          discovered_at: new Date().toISOString(),
          // Add events and timings
          events: allEvents,
          timings: timings,
          programConfidence: programResult.confidence,
          programLoops: programResult.loopCount,
          run: runId,
          stage: 'program'
        }
      } as FieldSchema;
    }
  );
}
```

### Testing Plan

**Test 1: Verify Events Appear in Logs**
```bash
# Run a discovery job and check MCP logs
# Should see: [Event] stage.start:auth
#             [Event] stage.end:auth {\"duration_ms\":12000}
#             [Event] stage.start:prereq_check {\"prereq_id\":\"membership\"}
#             ... etc
```

**Test 2: Verify Timings in Database**
```sql
-- Check discovery_jobs.metadata for events
SELECT 
  id,
  metadata->'timings' as timings,
  metadata->'events' as events
FROM discovery_jobs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 1;
```

**Test 3: Identify Bottlenecks**
```typescript
// Example: Find slowest stage
const timings = job.metadata.timings;
const slowest = Object.entries(timings)
  .filter(([k, v]) => k.endsWith('_ms') && v)
  .sort((a, b) => b[1] - a[1])[0];

console.log(`Slowest stage: ${slowest[0]} = ${slowest[1]}ms`);
```

### Rollback Plan

If events cause issues:
1. Remove `import { emitEvent } from './events.js'` from all files
2. Remove all `emitEvent()` calls
3. Events module is isolated, so no data corruption risk

### Success Criteria

✅ MCP logs show `[Event]` entries with stage names and timings  
✅ `discovery_jobs.metadata.timings` contains duration for each stage  
✅ `discovery_jobs.metadata.events` contains full event array  
✅ Can identify slow stages (e.g., \"auth took 15s, need to optimize\")

---

## Priority 3: Formalize Blockers (2-3 hours)

### Goal
Make prerequisite failures explicit and actionable with structured blocker types.

### Changes

**1. Add blocker types** (`mcp_server/prereqs/types.ts`):
```typescript
export type BlockerType = 
  | 'membership_unpaid'
  | 'membership_expired'
  | 'waiver_missing'
  | 'waiver_expired'
  | 'payment_method_missing'
  | 'captcha'
  | 'site_maintenance';

export interface Blocker {
  type: BlockerType;
  message: string;
  action?: string; // User-facing guidance
  url?: string;    // Where to resolve
}

export interface PrerequisiteCheckResult {
  checkId: string;
  displayName: string;
  checkStatus: 'pass' | 'fail' | 'unknown';
  message?: string;
  fieldsDiscovered?: DiscoveredField[];
  blockers: Blocker[]; // NEW
}
```

**2. Update prerequisite discovery** (`mcp_server/lib/prerequisites.ts`):
```typescript
export async function discoverPrerequisites(...): Promise<PrerequisiteCheckResult[]> {
  const results: PrerequisiteCheckResult[] = [];
  
  for (const prereq of PREREQ_PATHS) {
    const result: PrerequisiteCheckResult = {
      checkId: prereq.id,
      displayName: prereq.displayName,
      checkStatus: 'unknown',
      blockers: []
    };
    
    // ... discovery logic ...
    
    // If form found with \"unpaid\" or \"expired\" signals
    if (hasUnpaidSignal) {
      result.checkStatus = 'fail';
      result.blockers.push({
        type: 'membership_unpaid',
        message: 'Membership payment required',
        action: 'Complete payment at /membership',
        url: `${baseUrl}/membership`
      });
    }
    
    results.push(result);
  }
  
  return results;
}
```

**3. Display in UI** (`src/components/PrereqsPanel.tsx`):
```tsx
{prereq.blockers?.length > 0 && (
  <div className="mt-2 space-y-1">
    {prereq.blockers.map((blocker, i) => (
      <Alert key={i} variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{blocker.message}</AlertTitle>
        {blocker.action && (
          <AlertDescription>
            {blocker.action}
            {blocker.url && (
              <a href={blocker.url} target="_blank" className="underline ml-1">
                Visit page
              </a>
            )}
          </AlertDescription>
        )}
      </Alert>
    ))}
  </div>
)}
```

### Testing
- Mock a \"membership unpaid\" scenario
- Verify blocker appears in UI with actionable link
- Confirm blocker stored in `discovery_jobs.prerequisite_checks`

---

## Priority 4: Fingerprint Fallback Logic (4-5 hours)

### Goal
Handle minor form changes gracefully by finding \"close match\" fingerprints when exact match fails.

### Changes

**1. Create new DB function** (`supabase/migrations/XXXXXX_add_fingerprint_fallback.sql`):
```sql
-- Levenshtein distance function (PostgreSQL built-in)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE OR REPLACE FUNCTION public.get_hints_with_fallback(
  p_provider text,
  p_program text,
  p_fingerprint text,
  p_stage text,
  p_similarity_threshold real DEFAULT 0.85
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
DECLARE
  v_exact_match jsonb;
  v_close_match jsonb;
  v_fingerprint_length int;
BEGIN
  -- Try exact match first
  SELECT jsonb_build_object(
    'provider', provider_slug,
    'program', program_key,
    'stage', stage,
    'fingerprint', form_fingerprint,
    'hints', hints,
    'confidence', confidence,
    'samples_count', samples_count,
    'match_type', 'exact'
  )
  INTO v_exact_match
  FROM public.discovery_hints
  WHERE provider_slug = p_provider
    AND program_key = p_program
    AND form_fingerprint = p_fingerprint
    AND stage = p_stage
  ORDER BY confidence DESC, samples_count DESC
  LIMIT 1;
  
  IF v_exact_match IS NOT NULL THEN
    RETURN v_exact_match;
  END IF;
  
  -- Try close match using similarity
  v_fingerprint_length := length(p_fingerprint);
  
  SELECT jsonb_build_object(
    'provider', provider_slug,
    'program', program_key,
    'stage', stage,
    'fingerprint', form_fingerprint,
    'hints', hints,
    'confidence', confidence * 0.9, -- Penalize non-exact match
    'samples_count', samples_count,
    'match_type', 'similar'
  )
  INTO v_close_match
  FROM public.discovery_hints
  WHERE provider_slug = p_provider
    AND program_key = p_program
    AND stage = p_stage
    AND abs(length(form_fingerprint) - v_fingerprint_length) <= 10 -- Pre-filter by length
    AND (
      -- Calculate similarity (1 - normalized Levenshtein distance)
      1.0 - (levenshtein(form_fingerprint, p_fingerprint)::real / GREATEST(length(form_fingerprint), v_fingerprint_length))
    ) >= p_similarity_threshold
  ORDER BY 
    (1.0 - (levenshtein(form_fingerprint, p_fingerprint)::real / GREATEST(length(form_fingerprint), v_fingerprint_length))) DESC,
    confidence DESC,
    samples_count DESC
  LIMIT 1;
  
  IF v_close_match IS NOT NULL THEN
    RETURN v_close_match;
  END IF;
  
  -- No match found
  RETURN '{}'::jsonb;
END;
$$;
```

**2. Use in serial discovery** (`mcp_server/lib/serial_field_discovery.ts`):
```typescript
export async function discoverFieldsSerially(...) {
  // ... existing setup ...
  
  // Try to get warm hints with fallback
  let warmHints: WarmHints | null = null;
  
  if (fingerprint) {
    const { data, error } = await supabase.rpc('get_hints_with_fallback', {
      p_provider: provider,
      p_program: programKey,
      p_fingerprint: fingerprint,
      p_stage: stage
    });
    
    if (data && data.hints) {
      warmHints = data.hints;
      const matchType = data.match_type || 'exact';
      console.log(`[SerialDiscovery] Using ${matchType} match hints (confidence: ${data.confidence})`);
    }
  }
  
  // ... continue with discovery ...
}
```

### Testing
- Generate fingerprint for a form
- Manually tweak 1-2 characters in DB
- Verify discovery still finds \"similar\" hints
- Confirm confidence is penalized appropriately

---

## Implementation Order

1. **✅ Priority 2 (Events)** - Implemented - Gives immediate visibility into what's slow
2. **Priority 3 (Blockers)** - Makes failures actionable
3. **Priority 1 (Field Keys)** - Cleanup/consistency pass
4. **Priority 4 (Fingerprints)** - Resilience improvement

---

## Rollback Plan

All changes are additive:
- **Events**: Remove `emitEvent` calls, no data loss
- **Blockers**: Old code ignores empty array
- **Field keys**: Old keys still work, new keys preferred
- **Fingerprints**: Falls back to empty hints if function fails

---

## Success Metrics

- **Events**: Can see stage-by-stage timing in logs ✅
- **Blockers**: Users see actionable error messages
- **Field Keys**: All new discoveries use namespaced keys
- **Fingerprints**: Discovery success rate increases for \"close match\" scenarios

---

## Notes

- All enhancements are **non-breaking** and work alongside existing code
- Each priority can be implemented independently
- Changes are designed to improve observability, consistency, and resilience
- MCP-compatible architecture is maintained throughout
