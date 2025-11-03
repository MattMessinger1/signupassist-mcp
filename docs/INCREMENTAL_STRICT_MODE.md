# Incremental Strict Mode Migration Plan

**Current Status**: `strict: false` (35 type errors need fixing before enabling)  
**Goal**: Enable `strict: true` incrementally to catch bugs while maintaining deployability

## Why Strict Mode?

Strict TypeScript catches bugs at compile time:
- **Null safety**: Prevents `Cannot read property of null/undefined` errors
- **Type safety**: Eliminates implicit `any` types
- **Better IDE support**: More accurate autocomplete and refactoring

## Current Type Errors Blocking Strict Mode

From Railway build logs (2025-11-03):

### Category 1: Unknown Error Types (13 errors)
**Issue**: `error` is of type 'unknown' in catch blocks

```typescript
// ❌ Current (breaks with strict)
catch (error) {
  console.error('Error:', error.message); // error is 'unknown'
}

// ✅ Fix with type assertion
catch (error) {
  const err = error as Error;
  console.error('Error:', err.message);
}

// ✅ Better: Type guard
catch (error) {
  if (error instanceof Error) {
    console.error('Error:', error.message);
  } else {
    console.error('Unknown error:', error);
  }
}
```

**Files affected**:
- `mcp_server/lib/browserbase-skiclubpro.ts` (2 errors)
- `mcp_server/lib/credentials.ts` (2 errors)
- `mcp_server/lib/evidence.ts` (1 error)
- `mcp_server/lib/serial_field_discovery.ts` (6 errors)
- `mcp_server/middleware/audit.ts` (1 error)
- `mcp_server/providers/skiclubpro.ts` (5 errors)

### Category 2: Null Safety (6 errors)
**Issue**: Variables/properties possibly null

```typescript
// ❌ Current (breaks with strict)
const text = element.textContent.trim(); // textContent could be null

// ✅ Fix with null check
const text = element.textContent?.trim() ?? '';

// ✅ Fix with guard
if (element.textContent) {
  const text = element.textContent.trim();
}
```

**Files affected**:
- `mcp_server/lib/formHelpers.ts` (1 error)
- `mcp_server/lib/guardrails.ts` (1 error)
- `mcp_server/lib/serial_field_discovery.ts` (1 error)
- `mcp_server/lib/unified_discovery.ts` (2 errors)
- `mcp_server/ai/AIOrchestrator.ts` (1 error - null vs undefined)

### Category 3: Implicit Any (3 errors)
**Issue**: Parameters without type annotations

```typescript
// ❌ Current (breaks with strict)
.filter(l => l.length > 0) // 'l' implicitly has 'any' type

// ✅ Fix with explicit type
.filter((l: string) => l.length > 0)
```

**Files affected**:
- `mcp_server/config/providers/skiclubpro/prereqs.ts` (1 error)
- `mcp_server/providers/skiclubpro.ts` (2 errors)

### Category 4: Type Mismatches (4 errors)
**Issue**: Type incompatibilities

```typescript
// Example from AIOrchestrator.ts(830,52)
// Passing string where SessionContext expected
```

**Files affected**:
- `mcp_server/ai/AIOrchestrator.ts` (4 errors)
- `mcp_server/lib/login.ts` (1 error - wrong arg count)
- `mcp_server/providers/skiclubpro.ts` (2 errors - type mismatches)

### Category 5: Index Signatures (1 error)
**Issue**: Dynamic object access without index signature

```typescript
// ❌ Current
const programs = allPrograms[orgRef]; // No index signature

// ✅ Fix with type assertion or index signature
const programs = allPrograms[orgRef as keyof typeof allPrograms];
```

**Files affected**:
- `mcp_server/providers/skiclubpro.ts` (1 error)

## Migration Strategy

### Phase 1: Enable Individual Strict Flags (Recommended)
Enable strict checks one at a time, fixing errors incrementally:

```json
{
  "compilerOptions": {
    "strict": false,
    // Enable one at a time:
    "noImplicitAny": true,        // Step 1: Fix implicit any (3 errors)
    "strictNullChecks": false,    // Step 2: Fix null checks (6 errors) 
    "strictFunctionTypes": false, // Step 3: Fix function types
    // ... enable others gradually
  }
}
```

**Advantage**: Small, focused PRs. Each can be tested independently.

### Phase 2: Fix by File Priority
Fix errors in order of risk/importance:

**High Priority** (core functionality):
1. `mcp_server/ai/AIOrchestrator.ts` (4 errors) - Orchestration logic
2. `mcp_server/providers/skiclubpro.ts` (10 errors) - Provider tools
3. `mcp_server/lib/login.ts` (1 error) - Authentication

**Medium Priority** (discovery/data flow):
4. `mcp_server/lib/serial_field_discovery.ts` (6 errors)
5. `mcp_server/lib/unified_discovery.ts` (2 errors)
6. `mcp_server/lib/credentials.ts` (2 errors)

**Lower Priority** (utilities):
7. `mcp_server/lib/browserbase-skiclubpro.ts` (2 errors)
8. `mcp_server/lib/formHelpers.ts` (1 error)
9. `mcp_server/lib/guardrails.ts` (1 error)
10. `mcp_server/lib/evidence.ts` (1 error)
11. `mcp_server/middleware/audit.ts` (1 error)
12. `mcp_server/config/providers/skiclubpro/prereqs.ts` (1 error)

### Phase 3: Enable Full Strict Mode
Once all errors fixed:

```json
{
  "compilerOptions": {
    "strict": true, // ✅ All strict checks enabled
  }
}
```

## Quick Fix Examples

### Pattern 1: Error Type Assertions
```typescript
// Find all: catch (error)
// Replace pattern:
catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[context] Error:', err.message);
}
```

### Pattern 2: Null Safety with Optional Chaining
```typescript
// Find: .textContent.trim()
// Replace:
.textContent?.trim() ?? ''

// Find: element.innerText.toLowerCase()
// Replace:
element.innerText?.toLowerCase() ?? ''
```

### Pattern 3: Type Parameters
```typescript
// Find: .filter(x => ...)
// Replace:
.filter((x: string) => ...)

// Or use inference:
const lines: string[] = text.split('\n');
lines.filter(x => x.length > 0); // x inferred as string
```

## Automated Migration Tools

### Step 1: Install ts-migrate
```bash
npm install -D ts-migrate
```

### Step 2: Run on target directory
```bash
npx ts-migrate migrate mcp_server/lib/
```

**What it does**:
- Adds `@ts-ignore` comments (temporary)
- Suggests type fixes
- Preserves code functionality

### Step 3: Incrementally remove @ts-ignore
Review and fix each `@ts-ignore` one by one.

## Testing Strategy

After each fix batch:

1. **Type check**: `npm run build:check`
2. **Compile**: `npm run build`
3. **Unit tests**: `npm test`
4. **Smoke tests**: `npm run test:smoke`
5. **Deploy to staging**: Verify no runtime errors

## Current Configuration (Safe for Production)

```json
{
  "compilerOptions": {
    "strict": false,                             // Disabled until errors fixed
    "skipLibCheck": true,                        // ✅ Keeps CI stable
    "noErrorTruncation": true,                   // ✅ Readable logs
    "forceConsistentCasingInFileNames": true,    // ✅ Cross-platform
    "noEmitOnError": true                        // ✅ Fail on real errors
  }
}
```

**Benefits we kept**:
- ✅ Single source of truth for types (`mcp_server/types.ts`)
- ✅ Centralized imports (no drift)
- ✅ CI-friendly (`skipLibCheck`)
- ✅ Readable error logs (`noErrorTruncation`)

**What we disabled temporarily**:
- ⏸️ Strict null checks
- ⏸️ No implicit any
- ⏸️ Strict function types
- ⏸️ Strict property initialization

## Timeline Estimate

### Optimistic (focused effort)
- **Phase 1** (noImplicitAny): 1-2 hours
- **Phase 2** (strictNullChecks): 2-3 hours  
- **Phase 3** (remaining): 1 hour
- **Testing/deployment**: 1 hour
- **Total**: ~1 day

### Realistic (incremental PRs)
- **Week 1**: Fix high priority files (orchestrator, providers)
- **Week 2**: Fix medium priority (discovery, credentials)
- **Week 3**: Fix lower priority (utilities)
- **Week 4**: Enable full strict mode

## Monitoring

After enabling strict mode, monitor for:
- Build time increases (should be minimal)
- False positive errors (adjust tsconfig if needed)
- Developer feedback (too noisy? adjust)

## Related Documentation

- [TYPE_SYSTEM.md](./TYPE_SYSTEM.md) - Type architecture
- [BUILD_INSTRUCTIONS.md](../BUILD_INSTRUCTIONS.md) - Build process
- [RUNBOOK_EXPECTED_LOGS.md](./RUNBOOK_EXPECTED_LOGS.md) - Expected logs

## References

- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict)
- [ts-migrate Tool](https://github.com/airbnb/ts-migrate)
- [Incremental TypeScript Migration](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html)
