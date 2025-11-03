# Type System Architecture

## Single Source of Truth

All TypeScript types are centrally defined in `mcp_server/types.ts` and re-exported from `mcp_server/index.ts`. This eliminates type drift and ensures consistency across the entire codebase.

## Design Principles

### 1. Centralized Definitions
**Rule**: Never define types in multiple locations. All canonical types live in `mcp_server/types.ts`.

```typescript
// ✅ CORRECT - Import from canonical source
import { SessionContext, ProviderResponse } from '../types';

// ❌ WRONG - Local type definitions
interface SessionContext { ... } // Duplicates canonical definition
```

### 2. Consistent Imports
**Rule**: Always import types from `mcp_server/types` or `mcp_server` (barrel export).

```typescript
// ✅ CORRECT - Direct import
import { ProviderResponse, Child } from '../types.js';

// ✅ CORRECT - Barrel export (for external consumers)
import { ProviderResponse } from 'mcp_server';

// ❌ WRONG - Old/deleted paths
import { ProviderResponse } from './providers/types.js'; // Path no longer exists
```

## Core Type Definitions

### SessionContext
Tracks user state, credentials, and provider information throughout the orchestration flow.

```typescript
interface SessionContext {
  userLocation?: { lat: number; lng: number };
  user_jwt?: string;
  provider?: { name: string; orgRef: string; source?: string; city?: string; state?: string };
  providerSearchResults?: any[];
  credential_id?: string;
  provider_cookies?: any[];
  loginCompleted?: boolean;
  step?: number;
  session_token?: string;      // Browserbase session token (PACK-01)
  discovery_retry_count?: number;
  mandate_jws?: string;         // Mandate JWT (PACK-07)
  mandate_id?: string;
  children?: Child[];
}
```

### ProviderResponse<T>
Standard response format for all provider tools (SkiClubPro, Shopify, Jackrabbit, etc.).

```typescript
interface ProviderResponse<T = any> extends Record<string, any> {
  success: boolean;
  login_status?: 'success' | 'failed';
  session_token?: string;       // For session reuse (PACK-01, PACK-05)
  data?: T;                     // Generic tool-specific data
  programs?: any[];             // Programs discovered
  programs_by_theme?: Record<string, any[]>; // Grouped programs (PACK-05)
  meta?: ToolMetadata;          // AI guidance
  ui?: {
    cards?: UICard[];
    message?: string;
  };
  error?: ParentFriendlyError | string;
  message?: string;
  timeout?: boolean;
  timestamp?: string;
}
```

**Usage Example:**
```typescript
async function findPrograms(args: any): Promise<ProviderResponse<ProgramData[]>> {
  return {
    success: true,
    session_token: 'token-123',
    programs: [...],
    programs_by_theme: {
      'Lessons & Classes': [...],
      'Camps & Clinics': [...]
    },
    timestamp: new Date().toISOString()
  };
}
```

### Child
Represents a child entity for family registration.

```typescript
interface Child {
  id: string;
  name: string;
  birthdate?: string;
}
```

## Metadata & UI Types

### ToolMetadata
Provides AI tone and UX guidance hints for orchestrator responses.

```typescript
interface ToolMetadata {
  tone_hints?: string;        // e.g., "Emphasize age ranges"
  security_note?: string;     // e.g., "Credentials never stored"
  next_actions?: string[];    // e.g., ["select_program", "view_details"]
  confidence?: 'high' | 'medium' | 'low';
  prompt_version?: string;    // e.g., "v1.0.0"
}
```

### UICard
Specification for consistent UI card rendering in frontend.

```typescript
interface UICard {
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: 'accent' | 'outline';
  }>;
}
```

### ParentFriendlyError
Parent-facing error structure with clear recovery guidance.

```typescript
interface ParentFriendlyError {
  display: string;      // User-friendly message
  recovery: string;     // Clear next step
  severity: 'low' | 'medium' | 'high';
  code?: string;        // Internal reference
}
```

## TypeScript Configuration

### Strict Mode Enabled
The project uses `strict: true` to catch type errors early:

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,           // Prevents CI breakages from external types
    "noErrorTruncation": true,      // Full error messages in logs
    "forceConsistentCasingInFileNames": true
  }
}
```

### Build Validation
Pre-deploy type checking prevents runtime errors:

```bash
# Type check without emitting files
npm run build:check

# Full build with type checking
npm run build
```

**Note**: Add this to `package.json` (file is currently read-only):
```json
{
  "scripts": {
    "build:check": "tsc -p tsconfig.mcp.json --noEmit"
  }
}
```

## Migration Guide

### Converting from Old Type Locations

If you encounter imports from deleted type locations, update them:

```typescript
// ❌ OLD - These paths no longer exist
import { ProviderResponse } from './providers/types';
import { SessionContext } from '../ai/AIOrchestrator';

// ✅ NEW - Use canonical source
import { ProviderResponse, SessionContext } from '../types';
```

### Adding New Types

When adding new types, always add them to `mcp_server/types.ts`:

```typescript
// mcp_server/types.ts

/**
 * New type documentation
 */
export interface MyNewType {
  field: string;
}
```

They will automatically be available via the barrel export:

```typescript
import { MyNewType } from '../types';
// or
import { MyNewType } from 'mcp_server';
```

## Best Practices

### DO ✅
- Define all types in `mcp_server/types.ts`
- Import from canonical source (`../types` or `mcp_server`)
- Use JSDoc comments to document types
- Use generic types for flexible APIs (`ProviderResponse<T>`)
- Run `npm run build:check` before committing

### DON'T ❌
- Create duplicate type definitions across files
- Import from old/deleted type locations
- Define types inline when a canonical version exists
- Skip type checking in CI/CD pipelines
- Use `any` when specific types are available

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Type Check
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build:check
```

### Pre-commit Hook
```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run build:check || exit 1
```

## Related Documentation

- [RUNBOOK_EXPECTED_LOGS.md](./RUNBOOK_EXPECTED_LOGS.md) - Expected log milestones
- [SESSION_MANAGEMENT.md](./SESSION_MANAGEMENT.md) - Session architecture
- [PRODUCTION_MANDATE_FLOW_PLAN.md](./PRODUCTION_MANDATE_FLOW_PLAN.md) - Mandate types
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) - Official docs
