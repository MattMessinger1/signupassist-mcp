# Audit Trail Defense System - Future Build

## 🚧 Status: Deferred Until Workflow Stabilizes

**Last Updated:** 2025-01-03  
**Decision:** Defer implementation until core workflow is more established  
**Reason:** Workflow is still evolving rapidly; premature hardening would require constant rework

---

## 📋 Context

As of Phase 3 completion, we have a comprehensive audit trail:
- Every login is logged to `audit_events` table
- Plan creation triggers mandate issuance
- Tool calls pass `mandate_id`, `plan_id`, `plan_execution_id` through the entire chain

However, as the workflow evolves (new tools, providers, flows), there's risk of breaking the audit chain.

---

## ⚠️ The Problem: Workflow Changes Can Break Audit Trail

### Scenarios where audit breaks:

1. **Add new tool** → No audit if you forget to pass context
2. **Change tool flow** → Old audit logs become misleading  
3. **Add new provider** → Login audit doesn't capture provider-specific signals
4. **Refactor frontend** → Mandate creation might get skipped

### Example Breaking Change:
```typescript
// Developer adds new tool but forgets audit context
export async function newTool(args: any) {
  // ❌ No mandate_id, plan_id, plan_execution_id passed
  const result = await performSensitiveOperation();
  return result;
}
```

**Result:** Operation succeeds but creates no audit trail → compliance violation

---

## ✅ Solution: Defense-in-Depth Strategy

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Defense Layer 1: Type Safety              │
│              (Compile-time enforcement via TS types)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Defense Layer 2: Runtime Guards             │
│            (Validate audit context at entry points)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                Defense Layer 3: Centralized Wrapper          │
│           (All auditable ops go through withAudit())         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│               Defense Layer 4: Database Constraints          │
│              (PostgreSQL triggers catch violations)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Defense Layer 1: Type Safety (Immediate - Low Effort)

### Goal
Make audit context **required** in TypeScript types so the compiler enforces it.

### Implementation

**File:** `mcp_server/providers/types.ts`

```typescript
/**
 * Shared types for all MCP providers
 */

/**
 * Standard audit context that MUST be passed through every tool call
 * to maintain the audit chain
 */
export interface ToolContext {
  mandate_id: string;        // ✅ Required, not optional
  plan_id: string;           // ✅ Required
  plan_execution_id: string; // ✅ Required
  user_id: string;           // ✅ Required
  toolName: string;          // ✅ Required
  session_token?: string;    // Optional (for session reuse)
}

/**
 * Standard arguments for all provider tools
 */
export interface ToolArgs {
  auditContext: ToolContext;  // ✅ Make this required
  // ... other provider-specific args
}

/**
 * Standard response format for all provider tools
 */
export interface ProviderResponse<T = any> {
  login_status: 'success' | 'failed';
  data?: T;
  error?: string;
  timestamp?: string;
}
```

### Impact
✅ Any new tool handler that forgets audit context will **fail to compile**  
✅ Prevents accidental omissions during rapid development

---

## 🔒 Defense Layer 2: Runtime Validation (Immediate - Medium Effort)

### Goal
Add validation guards at the entry point of every sensitive operation.

### Implementation

**File:** `mcp_server/lib/auditGuards.ts` (new file)

```typescript
/**
 * Runtime validation for audit context
 * Ensures operations fail fast with clear errors if audit chain is broken
 */

export interface AuditContext {
  mandate_id: string;
  plan_id: string;
  plan_execution_id: string;
  user_id: string;
  toolName: string;
  session_token?: string;
}

/**
 * Validates that all required audit context is present
 * @throws Error with detailed message if any field is missing
 */
export function requireAuditContext(args: any, operation: string): AuditContext {
  const { mandate_id, plan_id, plan_execution_id, user_id, toolName } = args;
  
  const missing: string[] = [];
  if (!mandate_id) missing.push('mandate_id');
  if (!plan_id) missing.push('plan_id');
  if (!plan_execution_id) missing.push('plan_execution_id');
  if (!user_id) missing.push('user_id');
  if (!toolName) missing.push('toolName');
  
  if (missing.length > 0) {
    throw new Error(
      `🚨 AUDIT VIOLATION: ${operation} called without complete audit context.\n` +
      `Missing fields: ${missing.join(', ')}\n` +
      `This operation cannot proceed without proper audit tracking.\n` +
      `Check that the frontend is passing mandate_id, plan_id, and plan_execution_id.`
    );
  }
  
  return {
    mandate_id,
    plan_id,
    plan_execution_id,
    user_id,
    toolName,
    session_token: args.session_token
  };
}

/**
 * Validates that a mandate has the required scope
 */
export function requireScope(
  mandateScopes: string[],
  requiredScope: string,
  operation: string
): void {
  if (!mandateScopes.includes(requiredScope)) {
    throw new Error(
      `🚨 AUTHORIZATION VIOLATION: ${operation} requires scope '${requiredScope}'.\n` +
      `Mandate has scopes: ${mandateScopes.join(', ')}\n` +
      `This operation is not authorized by the current mandate.`
    );
  }
}
```

**File:** `mcp_server/lib/browserbase.ts` (update)

```typescript
import { requireAuditContext } from './auditGuards.ts';
import type { LoginOpts } from './login.ts';

export async function performSkiClubProLogin(
  session: BrowserbaseSession,
  credentials: any,
  orgRef: string,
  opts: LoginOpts = {}
): Promise<boolean> {
  // 🛡️ Guard: Reject if audit context missing
  const auditContext = requireAuditContext(opts, 'performSkiClubProLogin');
  
  console.log(`[Audit Guard] ✅ Validated audit context for login:`, {
    mandate_id: auditContext.mandate_id,
    plan_id: auditContext.plan_id,
    tool: auditContext.toolName
  });
  
  // ... rest of login logic unchanged
}
```

### Impact
✅ Operations **fail fast** with clear error messages if audit context is missing  
✅ Errors are caught in development/testing, not production  
✅ Minimal code changes (just add guard at function entry)

---

## 🎯 Defense Layer 3: Centralized Audit Wrapper (Short-term - High Effort)

### Goal
Create a single function that all auditable operations must go through.

### Implementation

**File:** `mcp_server/lib/auditWrapper.ts` (new file)

```typescript
import { supabase } from './supabase.ts';

export interface AuditOperation {
  name: string;
  type: 'login' | 'tool_call' | 'plan_creation';
  context: {
    mandate_id: string;
    plan_id: string;
    plan_execution_id: string;
    user_id: string;
    toolName: string;
  };
  provider?: string;
  org_ref?: string;
}

/**
 * Wraps an auditable operation to ensure it's logged
 * 
 * @example
 * const loggedIn = await withAudit(
 *   { name: 'skiclubpro_login', type: 'login', context: auditContext },
 *   async () => await performSkiClubProLogin(session, creds, orgRef, opts)
 * );
 */
export async function withAudit<T>(
  operation: AuditOperation,
  handler: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  // Start audit record
  const { data: auditRecord, error: auditError } = await supabase
    .from('audit_events')
    .insert({
      event_type: operation.type,
      tool: operation.name,
      provider: operation.provider,
      org_ref: operation.org_ref,
      mandate_id: operation.context.mandate_id,
      plan_id: operation.context.plan_id,
      plan_execution_id: operation.context.plan_execution_id,
      user_id: operation.context.user_id,
      started_at: new Date().toISOString(),
      details: { toolName: operation.context.toolName }
    })
    .select()
    .single();
  
  if (auditError) {
    console.error(`[Audit] Failed to create audit record:`, auditError);
    throw new Error(`Cannot proceed without audit record: ${auditError.message}`);
  }
  
  const auditId = auditRecord.id;
  
  try {
    // Execute the actual operation
    const result = await handler();
    
    // Mark audit as successful
    await supabase
      .from('audit_events')
      .update({
        finished_at: new Date().toISOString(),
        result: 'success',
        details: {
          ...auditRecord.details,
          timing: { ms: Date.now() - startTime }
        }
      })
      .eq('id', auditId);
    
    console.log(`[Audit] ✅ ${operation.name} succeeded (${Date.now() - startTime}ms)`);
    return result;
    
  } catch (error) {
    // Mark audit as failed
    await supabase
      .from('audit_events')
      .update({
        finished_at: new Date().toISOString(),
        result: 'failure',
        details: {
          ...auditRecord.details,
          error: error instanceof Error ? error.message : String(error),
          timing: { ms: Date.now() - startTime }
        }
      })
      .eq('id', auditId);
    
    console.error(`[Audit] ❌ ${operation.name} failed (${Date.now() - startTime}ms):`, error);
    throw error;
  }
}
```

**Usage Example:**

```typescript
// In mcp_server/providers/skiclubpro.ts
export async function scpLogin(args: any): Promise<ProviderResponse> {
  const auditContext = requireAuditContext(args, 'scpLogin');
  
  return withAudit(
    {
      name: 'scp.login',
      type: 'login',
      context: auditContext,
      provider: 'skiclubpro',
      org_ref: args.org_ref
    },
    async () => {
      // Actual login logic
      const session = await launchBrowserbaseSession();
      const creds = await lookupCredentials(args.credential_id);
      const success = await performSkiClubProLogin(session, creds, args.org_ref, args);
      
      return {
        login_status: success ? 'success' : 'failed',
        data: { org_ref: args.org_ref },
        timestamp: new Date().toISOString()
      };
    }
  );
}
```

### Impact
✅ **Impossible** to perform auditable operations without creating an audit record  
✅ Consistent audit format across all operations  
✅ Centralized timing and error handling

---

## 🗄️ Defense Layer 4: Database Constraints (Immediate - Low Effort)

### Goal
Add database-level checks to catch audit violations.

### Implementation

**SQL Migration:**

```sql
-- Function: Warn if a plan has no associated login audit
CREATE OR REPLACE FUNCTION check_plan_has_audit() RETURNS trigger AS $$
BEGIN
  -- Give it 5 seconds for the audit to be created
  PERFORM pg_sleep(5);
  
  IF NOT EXISTS (
    SELECT 1 FROM audit_events 
    WHERE plan_id = NEW.id 
    AND event_type = 'provider_login'
  ) THEN
    RAISE WARNING 'Plan % has no associated login audit event', NEW.id;
    -- Optionally: RAISE EXCEPTION to reject the insert
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_plan_audit
  AFTER INSERT ON plans
  FOR EACH ROW
  EXECUTE FUNCTION check_plan_has_audit();

-- Function: Warn if a mandate has no scope
CREATE OR REPLACE FUNCTION check_mandate_has_scope() RETURNS trigger AS $$
BEGIN
  IF NEW.scope IS NULL OR array_length(NEW.scope, 1) IS NULL THEN
    RAISE EXCEPTION 'Mandate % has empty scope array', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_mandate_scope
  BEFORE INSERT OR UPDATE ON mandates
  FOR EACH ROW
  EXECUTE FUNCTION check_mandate_has_scope();

-- Function: Warn if login audit has no mandate
CREATE OR REPLACE FUNCTION check_login_has_mandate() RETURNS trigger AS $$
BEGIN
  IF NEW.event_type = 'provider_login' AND NEW.mandate_id IS NULL THEN
    RAISE WARNING 'Login audit event % has no mandate_id', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_login_mandate
  BEFORE INSERT ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION check_login_has_mandate();
```

### Impact
✅ Database **warns** (or rejects) when audit chain is broken  
✅ Catches violations even if application logic is bypassed  
✅ Can be enabled/disabled without code changes

---

## 📋 Workflow Change Checklist

Before making workflow changes, verify:

### ✅ 1. Does this change add a new tool?

- [ ] Tool handler includes `auditContext` parameter
- [ ] Tool calls `requireAuditContext()` guard
- [ ] Frontend passes `mandate_id`, `plan_id`, `plan_execution_id`
- [ ] Update `ToolArgs` interface if needed

### ✅ 2. Does this change modify login flow?

- [ ] `performSkiClubProLogin` still receives audit context
- [ ] `auditLogin.ts` captures new provider-specific signals
- [ ] Update `LoginAuditDetails` interface if needed

### ✅ 3. Does this change alter plan creation?

- [ ] `create-plan` still creates `audit_events` record
- [ ] Mandate creation happens **before** any sensitive operations
- [ ] Frontend waits for plan/mandate creation before proceeding

### ✅ 4. Does this change add a new provider?

- [ ] Update `LoginAuditDetails` interface with provider-specific verification
- [ ] Add provider to `audit_events.provider` enum
- [ ] Implement provider-specific login verification signals

---

## 📊 Monitoring & Alerting

### Query: Find plans without login audits

```sql
-- Orphaned plans (created but never executed)
SELECT 
  p.id as orphaned_plan_id,
  p.created_at,
  p.program_ref,
  p.user_id,
  p.status
FROM plans p
LEFT JOIN audit_events ae 
  ON ae.plan_id = p.id 
  AND ae.event_type = 'provider_login'
WHERE ae.id IS NULL
  AND p.created_at > now() - interval '7 days'
ORDER BY p.created_at DESC;
```

### Query: Find logins without mandates

```sql
-- Login attempts without proper authorization
SELECT 
  ae.id as orphaned_audit_id,
  ae.started_at,
  ae.tool,
  ae.provider,
  ae.org_ref,
  ae.result
FROM audit_events ae
WHERE ae.event_type = 'provider_login'
  AND ae.mandate_id IS NULL
  AND ae.started_at > now() - interval '7 days'
ORDER BY ae.started_at DESC;
```

### Query: Find mandates without scopes

```sql
-- Mandates that don't specify what they authorize
SELECT 
  m.id,
  m.created_at,
  m.provider,
  m.scope,
  m.status
FROM mandates m
WHERE (m.scope IS NULL OR array_length(m.scope, 1) IS NULL)
  AND m.created_at > now() - interval '7 days'
ORDER BY m.created_at DESC;
```

### Query: Audit chain integrity report

```sql
-- Complete audit chain: Plan → Mandate → Login → Execution
SELECT 
  p.id as plan_id,
  p.program_ref,
  p.status as plan_status,
  m.id as mandate_id,
  m.scope as mandate_scopes,
  ae.id as audit_id,
  ae.result as login_result,
  ae.details->'verification'->>'verified' as login_verified,
  pe.id as execution_id,
  pe.result as execution_result
FROM plans p
LEFT JOIN mandates m ON m.user_id = p.user_id 
  AND m.program_ref = p.program_ref
LEFT JOIN audit_events ae ON ae.plan_id = p.id 
  AND ae.mandate_id = m.id
LEFT JOIN plan_executions pe ON pe.plan_id = p.id
WHERE p.created_at > now() - interval '24 hours'
ORDER BY p.created_at DESC;
```

### Recommended Monitoring

Set up a **daily cron job** to run these queries and alert if:
- More than 5 orphaned plans in past 24 hours
- Any login without mandate in past 24 hours
- Any mandate without scope (should be blocked by trigger)

---

## 🎯 Implementation Roadmap

### Phase 1: Immediate (Do Now)
**Effort:** 2-4 hours  
**Risk:** Low

1. ✅ Add `requireAuditContext()` guards to:
   - `performSkiClubProLogin` in `mcp_server/lib/browserbase.ts`
   - All tool handlers in `mcp_server/providers/skiclubpro.ts`

2. ✅ Add database constraints:
   - `check_plan_has_audit()` trigger
   - `check_mandate_has_scope()` trigger
   - `check_login_has_mandate()` trigger

3. ✅ Set up monitoring queries as Supabase scheduled function

### Phase 2: Short-term (Next Sprint)
**Effort:** 1-2 days  
**Risk:** Medium (requires refactoring)

1. Create `auditWrapper.ts` with `withAudit()` function
2. Refactor all tool handlers to use `withAudit()`
3. Update `ToolContext` and `ToolArgs` to make audit fields required
4. Add daily alerting for audit gap queries

### Phase 3: Long-term (Future)
**Effort:** 3-5 days  
**Risk:** Low (UI-only)

1. Build UI to visualize audit chain integrity
2. Create admin dashboard showing:
   - Orphaned plans
   - Failed logins
   - Mandate usage stats
3. Add automated tests that verify audit context is passed
4. Document audit architecture in developer onboarding

---

## 📚 References

### Key Files
- `mcp_server/providers/types.ts` - Shared types
- `mcp_server/lib/browserbase.ts` - Login implementation
- `mcp_server/lib/auditLogin.ts` - Audit logging
- `mcp_server/middleware/audit.ts` - Tool call auditing
- `src/components/ProgramBrowser.tsx` - Frontend mandate creation
- `src/components/PrereqsPanel.tsx` - Frontend mandate creation
- `supabase/functions/create-plan/index.ts` - Plan creation
- `supabase/functions/mandate-issue/index.ts` - Mandate issuance

### Database Tables
- `audit_events` - All audit logs
- `plans` - User intent to register
- `mandates` - Authorization grants
- `plan_executions` - Execution results

---

## 🔄 Version History

- **2025-01-03** - Initial document created (Phase 3 complete, deferred defense implementation)

---

**When to return to this document:**
- After 10+ successful plan executions in production
- When workflow changes slow down (< 1 breaking change per week)
- Before scaling to multiple providers (high compliance risk)
- When onboarding new developers (need guardrails)
