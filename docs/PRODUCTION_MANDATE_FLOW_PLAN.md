# Production-Ready Mandate & Registration Flow Implementation Plan

**Status:** HOLD - Wait until Discovery Questions work is finalized  
**Last Updated:** 2025-10-08  
**Owner:** SignupAssist Team

---

## Executive Summary

This plan implements a production-ready, two-mandate authorization system with precise timing control, session persistence, and comprehensive audit trails. The work is broken into **6 manageable phases** that can be implemented incrementally without breaking existing functionality.

### Core Architecture Principles

1. **Two-Mandate Pattern:**
   - **Discovery Mandate** (read-only, $0, auto-created): `scp:read:listings` - Used during Plan Builder
   - **Execution Mandate** (write, $X cap, user-signed): `scp:login`, `scp:enroll`, `scp:pay` - Used at registration time

2. **Session Reuse:** Discovery creates an authenticated browser session → saved → reused at execution time (no re-login needed)

3. **Timing Precision:** Pre-warm sequence runs T-5min before opening → verifies login → pre-fills form → submits at T=0

4. **Auditability:** Every tool call, mandate verification, session state, and payment is logged with tamper-proof hashing

---

## Phase 1: Session Persistence Foundation ✅ (ALREADY IMPLEMENTED)

**Status:** Complete - Verify only  
**Files involved:** `mcp_server/lib/session.ts`, `supabase/migrations/`

### What exists:
- ✅ `browser_sessions` table with encrypted session data
- ✅ `saveSessionState()`, `restoreSessionState()`, `clearSessionState()` functions
- ✅ `SESSION_CACHE_ENABLED` environment variable flag
- ✅ `generateSessionKey(userId, credentialId, orgRef)` utility

### Verification checklist:
- [ ] Confirm `browser_sessions` table has RLS policies for service role
- [ ] Test session save/restore with a real discovery job
- [ ] Verify 24hr expiration cleanup works

**Estimated time:** 1 hour (verification only)  
**Breaking changes:** None

---

## Phase 2: Discovery Mandate Auto-Creation ✅ (ALREADY IMPLEMENTED)

**Status:** Complete - Verify only  
**Files involved:** `supabase/functions/discover-fields-interactive/index.ts`

### What exists:
- ✅ Auto-creates `scp:read:listings` mandate during discovery (lines 217-264)
- ✅ JWS signing with `MANDATE_SIGNING_KEY`
- ✅ Inserts into `mandates` table with 24hr expiry
- ✅ Passes `mandate_id` to MCP tool calls for audit trail

### Verification checklist:
- [ ] Check that discovery jobs create mandates in DB
- [ ] Verify `audit_events` table captures discovery tool calls
- [ ] Confirm mandates expire after 24hr

**Estimated time:** 1 hour (verification only)  
**Breaking changes:** None

---

## Phase 3: Save Session After Discovery (NEW WORK)

**Status:** Not implemented  
**Dependencies:** Phase 1 & 2 verified

### Changes required:

#### 3.1: Update `discover-fields-interactive/index.ts`

**Location:** After successful MCP tool call (line ~300)

```typescript
// After result = await invokeMCPTool("scp.discover_required_fields", ...)

// ✅ Save browser session for reuse at execution time
if (result?.session_ref) {
  console.log(`[Job ${jobId}] Saving session state for reuse...`);
  
  const sessionKey = `session:${user.id}:${credential_id}:${program_ref}`;
  
  // Store session metadata in discovery_jobs
  await supabase.from("discovery_jobs").update({
    metadata: {
      ...result.metadata,
      session_key: sessionKey,
      session_saved_at: new Date().toISOString()
    }
  }).eq("id", jobId);
  
  console.log(`[Job ${jobId}] ✓ Session saved with key: ${sessionKey}`);
}
```

**Type changes:** None (metadata is already `jsonb`)

#### 3.2: Update MCP `scp.discover_required_fields` tool

**Location:** `mcp_server/providers/skiclubpro.ts` (or wherever discovery tool is implemented)

**Add after successful login:**

```typescript
import { saveSessionState, generateSessionKey } from '../lib/session.js';

// After successful login in discovery
const sessionKey = generateSessionKey(userId, credentialId, orgRef);
await saveSessionState(page, sessionKey);
console.log(`[Discovery] Session saved for future reuse: ${sessionKey}`);
```

**Type changes:** None

### Testing:
- [ ] Run discovery job → verify `browser_sessions` table has entry
- [ ] Check `discovery_jobs.metadata` contains `session_key`
- [ ] Manually call `restoreSessionState()` to verify cookies work

**Estimated time:** 3-4 hours  
**Breaking changes:** None (additive only)

---

## Phase 4: User-Facing Language Update (NEW WORK)

**Status:** Not implemented  
**Dependencies:** None (can be done in parallel)

### Changes required:

#### 4.1: Update `MandateSummary.tsx`

**Location:** Lines 136-149 (CardHeader)

```tsx
<CardHeader className="flex flex-row items-center justify-between">
  <div>
    <CardTitle>Signup Readiness Authorization</CardTitle>
    <CardDescription>
      Confirm what you authorize us to do for this registration.
      <span className="block mt-1 text-xs text-muted-foreground">
        (Technically called a "mandate" in our agentic system)
      </span>
    </CardDescription>
  </div>
  {/* ... tooltip ... */}
</CardHeader>
```

#### 4.2: Update consent text

**Location:** `src/lib/prompts.ts` (create if doesn't exist)

```typescript
export const prompts = {
  ui: {
    review: {
      consent: (maxAmount: string, orgRef: string) => [
        `I authorize SignupAssist to sign in to ${orgRef} using my stored credentials.`,
        `I authorize registration form submission on my behalf at the exact opening time.`,
        `I set a payment cap of ${maxAmount} and understand SignupAssist will STOP if the cost exceeds this limit.`,
        `I understand a $20 success fee will be charged ONLY if SignupAssist successfully secures a spot.`,
        `I understand my payment method will be charged automatically when registration succeeds.`,
        `I have reviewed the authorization details and agree to the terms of service.`
      ]
    }
  }
};
```

**Type changes:** Update `prompts` export if it's typed

### Testing:
- [ ] Visual inspection of updated UI
- [ ] User comprehension test (internal team review)

**Estimated time:** 2 hours  
**Breaking changes:** None (UI text only)

---

## Phase 5: Pre-Warm Scheduler (NEW WORK - CRITICAL)

**Status:** Not implemented  
**Dependencies:** Phase 3 complete

### 5.1: Create `signup_readiness` table

**New migration:** `supabase/migrations/YYYYMMDDHHMMSS_create_signup_readiness.sql`

```sql
CREATE TABLE public.signup_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Pre-warm status
  status TEXT NOT NULL DEFAULT 'pending',
  -- Values: 'pending', 'warming', 'ready', 'failed'
  
  -- Session restoration
  session_key TEXT,
  session_restored_at TIMESTAMPTZ,
  
  -- Login verification
  login_verified BOOLEAN DEFAULT false,
  login_verified_at TIMESTAMPTZ,
  
  -- Form pre-fill
  form_prefilled BOOLEAN DEFAULT false,
  form_prefilled_at TIMESTAMPTZ,
  
  -- Ready state
  ready_at TIMESTAMPTZ,
  ready_until TIMESTAMPTZ,
  
  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_signup_readiness_plan_id ON public.signup_readiness(plan_id);
CREATE INDEX idx_signup_readiness_user_id ON public.signup_readiness(user_id);
CREATE INDEX idx_signup_readiness_status ON public.signup_readiness(status);

-- RLS policies
ALTER TABLE public.signup_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own readiness status"
  ON public.signup_readiness FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access"
  ON public.signup_readiness FOR ALL
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_signup_readiness_updated_at
  BEFORE UPDATE ON public.signup_readiness
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

**Type changes:** Add to `src/integrations/supabase/types.ts`

### 5.2: Create `pre-warm-signup` edge function

**New file:** `supabase/functions/pre-warm-signup/index.ts`

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { plan_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get plan details
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select(`
        id,
        user_id,
        program_ref,
        provider,
        mandate_id,
        meta,
        opens_at
      `)
      .eq('id', plan_id)
      .single();

    if (planError || !plan) throw new Error('Plan not found');

    // Create or update readiness record
    const { data: readiness, error: readinessError } = await supabase
      .from('signup_readiness')
      .upsert({
        plan_id: plan.id,
        user_id: plan.user_id,
        status: 'warming'
      })
      .select()
      .single();

    if (readinessError) throw new Error(`Failed to create readiness: ${readinessError.message}`);

    console.log(`[PreWarm] Starting pre-warm for plan ${plan_id}`);

    try {
      // Step 1: Restore session from discovery
      const sessionKey = plan.meta?.discovery_session_key;
      if (!sessionKey) {
        throw new Error('No discovery session key found in plan metadata');
      }

      console.log(`[PreWarm] Restoring session: ${sessionKey}`);
      
      // Call MCP tool to restore session and verify login
      const restoreResult = await invokeMCPTool('scp.restore_and_verify_session', {
        session_key: sessionKey,
        program_ref: plan.program_ref,
        mandate_id: plan.mandate_id
      }, {
        mandate_id: plan.mandate_id,
        plan_execution_id: null
      });

      if (!restoreResult.login_verified) {
        throw new Error('Login verification failed during pre-warm');
      }

      await supabase
        .from('signup_readiness')
        .update({
          session_restored_at: new Date().toISOString(),
          login_verified: true,
          login_verified_at: new Date().toISOString()
        })
        .eq('id', readiness.id);

      console.log(`[PreWarm] ✓ Session restored and login verified`);

      // Step 2: Navigate to program and pre-fill form (but don't submit)
      console.log(`[PreWarm] Pre-filling registration form...`);
      
      const prefillResult = await invokeMCPTool('scp.prefill_registration', {
        session_ref: restoreResult.session_ref,
        program_ref: plan.program_ref,
        answers: plan.meta?.answers || {},
        submit: false // CRITICAL: Don't submit yet!
      }, {
        mandate_id: plan.mandate_id,
        plan_execution_id: null
      });

      await supabase
        .from('signup_readiness')
        .update({
          form_prefilled: true,
          form_prefilled_at: new Date().toISOString(),
          status: 'ready',
          ready_at: new Date().toISOString(),
          ready_until: new Date(Date.now() + 10 * 60 * 1000).toISOString() // Valid for 10min
        })
        .eq('id', readiness.id);

      console.log(`[PreWarm] ✓ Form pre-filled. Ready for execution at T=0`);

      return new Response(
        JSON.stringify({
          success: true,
          readiness_id: readiness.id,
          status: 'ready',
          message: 'Pre-warm completed successfully'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      console.error(`[PreWarm] Failed:`, error);
      
      await supabase
        .from('signup_readiness')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          retry_count: (readiness?.retry_count || 0) + 1
        })
        .eq('id', readiness.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[PreWarm] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

**Type changes:** None (uses service role)

### 5.3: Create scheduler trigger

**New migration:** `supabase/migrations/YYYYMMDDHHMMSS_add_prewarm_scheduler.sql`

```sql
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule pre-warm to run every minute (will check which plans need warming)
SELECT cron.schedule(
  'prewarm-signup-jobs',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/pre-warm-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('plan_id', p.id)
    )
  FROM public.plans p
  WHERE p.status = 'scheduled'
    AND p.opens_at > now()
    AND p.opens_at <= now() + interval '5 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.signup_readiness sr
      WHERE sr.plan_id = p.id AND sr.status IN ('ready', 'warming')
    );
  $$
);
```

**Environment setup required:**
```sql
-- Set in Supabase dashboard or via migration
ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project.supabase.co';
ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key';
```

**Type changes:** None

### Testing:
- [ ] Create a plan with `opens_at` = now() + 4 minutes
- [ ] Wait 1 minute → verify `pre-warm-signup` was called
- [ ] Check `signup_readiness` table has `status='ready'`
- [ ] Verify session was restored from `browser_sessions`
- [ ] Check `audit_events` logs the pre-warm tool calls

**Estimated time:** 8-10 hours (most complex phase)  
**Breaking changes:** None (new functionality)

---

## Phase 6: Execute-At-Time Trigger (NEW WORK - CRITICAL)

**Status:** Not implemented  
**Dependencies:** Phase 5 complete

### 6.1: Create `execute-at-time` edge function

**New file:** `supabase/functions/execute-at-time/index.ts`

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { plan_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get plan + readiness status
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select(`
        id,
        user_id,
        program_ref,
        provider,
        mandate_id,
        meta,
        opens_at,
        status
      `)
      .eq('id', plan_id)
      .single();

    if (planError || !plan) throw new Error('Plan not found');
    if (plan.status !== 'scheduled') throw new Error(`Plan status is ${plan.status}, expected 'scheduled'`);

    // Verify readiness
    const { data: readiness } = await supabase
      .from('signup_readiness')
      .select('*')
      .eq('plan_id', plan_id)
      .eq('status', 'ready')
      .single();

    if (!readiness || !readiness.form_prefilled) {
      throw new Error('Plan not ready for execution (pre-warm not complete)');
    }

    console.log(`[Execute] Starting execution for plan ${plan_id} at T=0`);

    // Update plan status to running
    await supabase
      .from('plans')
      .update({ status: 'running' })
      .eq('id', plan_id);

    // Create plan execution record
    const { data: planExecution, error: execError } = await supabase
      .from('plan_executions')
      .insert({
        plan_id: plan.id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (execError) throw new Error(`Failed to create plan execution: ${execError.message}`);

    console.log(`[Execute] Plan execution created: ${planExecution.id}`);

    // CRITICAL: Submit the pre-filled form NOW (at T=0)
    const submitResult = await invokeMCPTool('scp.submit_prefilled_form', {
      session_ref: readiness.session_ref || plan.meta?.session_ref,
      program_ref: plan.program_ref
    }, {
      mandate_id: plan.mandate_id,
      plan_execution_id: planExecution.id
    });

    if (!submitResult.success) {
      throw new Error(`Form submission failed: ${submitResult.error}`);
    }

    console.log(`[Execute] ✓ Form submitted successfully`);

    // Continue with payment processing (existing logic from mcp-executor)
    // ... (reuse code from mcp-executor/index.ts lines 318-346)

    return new Response(
      JSON.stringify({
        success: true,
        plan_execution_id: planExecution.id,
        message: 'Execution started at T=0'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Execute] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

**Type changes:** None

### 6.2: Create execution scheduler

**New migration:** `supabase/migrations/YYYYMMDDHHMMSS_add_execution_scheduler.sql`

```sql
-- Schedule execution to run every 10 seconds (for precise timing)
SELECT cron.schedule(
  'execute-at-time-jobs',
  '*/10 * * * * *', -- Every 10 seconds (requires pg_cron 1.4+)
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/execute-at-time',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('plan_id', p.id)
    )
  FROM public.plans p
  WHERE p.status = 'scheduled'
    AND p.opens_at <= now() + interval '10 seconds'
    AND EXISTS (
      SELECT 1 FROM public.signup_readiness sr
      WHERE sr.plan_id = p.id AND sr.status = 'ready'
    );
  $$
);
```

**Type changes:** None

### Testing:
- [ ] Create plan with `opens_at` = now() + 3 minutes
- [ ] Wait for pre-warm to complete (T-2min)
- [ ] Verify execution triggers at T=0 (±10 seconds)
- [ ] Check `plan_executions` table has entry
- [ ] Verify form was submitted (not just pre-filled)
- [ ] Confirm audit trail captures submission

**Estimated time:** 6-8 hours  
**Breaking changes:** None

---

## Phase 7: MCP Tool Updates (NEW WORK)

**Status:** Not implemented  
**Dependencies:** Phase 3-6 complete

### New MCP tools required:

#### 7.1: `scp.restore_and_verify_session`

**Purpose:** Restore session from cache and verify login still works

**Implementation:** `mcp_server/providers/skiclubpro.ts`

```typescript
export async function restoreAndVerifySession(args: {
  session_key: string;
  program_ref: string;
  mandate_id: string;
}) {
  const page = await launchBrowserbaseSession();
  
  // Restore session
  const restored = await restoreSessionState(page, args.session_key);
  if (!restored) {
    throw new Error('Failed to restore session - may have expired');
  }
  
  // Navigate to account page to verify login
  await page.goto(`https://${orgRef}.skiclubpro.team/account`);
  
  // Check for login indicators
  const isLoggedIn = await page.locator('[data-testid="user-menu"]').isVisible();
  
  if (!isLoggedIn) {
    throw new Error('Session restored but login verification failed');
  }
  
  return {
    success: true,
    login_verified: true,
    session_ref: generateSessionRef()
  };
}
```

#### 7.2: `scp.prefill_registration`

**Purpose:** Navigate to program, fill form, but DON'T submit

```typescript
export async function prefillRegistration(args: {
  session_ref: string;
  program_ref: string;
  answers: Record<string, any>;
  submit: boolean;
}) {
  const page = getSessionPage(args.session_ref);
  
  // Navigate to registration form
  await page.goto(`https://${orgRef}.skiclubpro.team/programs/${args.program_ref}/register`);
  
  // Fill all form fields
  for (const [fieldId, value] of Object.entries(args.answers)) {
    await fillField(page, fieldId, value);
  }
  
  // CRITICAL: Only submit if explicitly requested
  if (args.submit) {
    await page.click('button[type="submit"]');
    await page.waitForURL(/confirmation/);
  }
  
  return {
    success: true,
    form_filled: true,
    submitted: args.submit
  };
}
```

#### 7.3: `scp.submit_prefilled_form`

**Purpose:** Submit an already-filled form (called at T=0)

```typescript
export async function submitPrefilledForm(args: {
  session_ref: string;
  program_ref: string;
}) {
  const page = getSessionPage(args.session_ref);
  
  // Form should already be filled from prefill step
  // Just click submit button
  await page.click('button[type="submit"]');
  
  // Wait for confirmation
  await page.waitForURL(/confirmation/, { timeout: 30000 });
  
  const confirmationText = await page.locator('.confirmation-number').textContent();
  
  return {
    success: true,
    confirmation_ref: confirmationText,
    submitted_at: new Date().toISOString()
  };
}
```

**Type changes:** Add to `mcp_server/providers/types.ts`

### Testing:
- [ ] Unit test each new MCP tool in isolation
- [ ] Integration test: discovery → save session → restore → pre-fill → submit
- [ ] Verify audit trail logs all tool calls

**Estimated time:** 10-12 hours  
**Breaking changes:** None (new tools)

---

## Summary & Rollout Strategy

### Total Estimated Time: 35-40 hours

### Rollout Order:
1. **Immediate (0 days):** Verify Phase 1 & 2 (already implemented)
2. **After Discovery finalized (+3 days):** Implement Phase 3 (session save)
3. **+5 days:** Implement Phase 4 (UI language)
4. **+8 days:** Implement Phase 7 (MCP tools)
5. **+12 days:** Implement Phase 5 (pre-warm scheduler)
6. **+15 days:** Implement Phase 6 (execution scheduler)
7. **+18 days:** End-to-end testing with real Ski Club Pro

### Type Safety Guarantees:

All database table changes will automatically generate TypeScript types via Supabase CLI:

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

No manual type editing needed!

### Audit Trail Coverage:

Every step logs to one or more tables:
- `mandates`: JWS tokens, scopes, caps
- `audit_events`: MCP tool calls with hashes
- `browser_sessions`: Cached session states
- `signup_readiness`: Pre-warm status
- `plan_executions`: Final results
- `evidence_assets`: Screenshots, HTML
- `charges`: Stripe payments

### Breaking Change Risk: **ZERO**

All phases are additive:
- New tables (don't touch existing)
- New edge functions (don't modify existing)
- New MCP tools (backward compatible with colon notation)
- New UI text (doesn't change functionality)

---

## References

### Key Files:
- `mcp_server/lib/session.ts` - Session persistence utilities
- `supabase/functions/discover-fields-interactive/index.ts` - Discovery mandate creation
- `supabase/functions/mcp-executor/index.ts` - MCP tool invocation
- `mcp_server/middleware/audit.ts` - Audit logging

### Database Tables:
- `mandates` - Authorization tokens (JWS)
- `audit_events` - Tamper-proof event log
- `browser_sessions` - Encrypted session cache
- `signup_readiness` - Pre-warm status tracking (NEW)
- `plan_executions` - Execution results
- `evidence_assets` - Screenshots & HTML
- `charges` - Payment records

### Version History:
- 2025-10-08: Initial plan created
- Status: ON HOLD pending Discovery Questions finalization
