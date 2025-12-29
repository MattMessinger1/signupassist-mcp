# Build Instructions

## Overview

This document outlines the build process, type checking, and deployment workflow for the SignupAssist MCP server.

## Prerequisites

- Node.js 20.x
- npm or compatible package manager
- TypeScript 5.x

## Build Commands

### Full Build
Compiles TypeScript to JavaScript and outputs to `dist/` directory:

```bash
npm run build
```

This runs `tsc -p tsconfig.mcp.json` which:
- Type checks all files in `mcp_server/`, `providers/`, `core/`
- Compiles to ES2020 target
- Outputs to `dist/` directory
- Fails on type errors (`noEmitOnError: true`)

### Type Check Only (No Compilation)
Validates types without emitting files (faster for CI/CD):

```bash
npm run build:check
```

**Note**: This script needs to be added to `package.json`:
```json
{
  "scripts": {
    "build:check": "tsc -p tsconfig.mcp.json --noEmit"
  }
}
```

## TypeScript Configuration

### tsconfig.mcp.json
Production build configuration with CI-friendly settings:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": ".",
    
    // CI-Friendly Settings (ENABLED)
    "skipLibCheck": true,                        // Skip type checking of .d.ts files (prevents CI breakages)
    "noErrorTruncation": true,                   // Full error messages in logs
    "forceConsistentCasingInFileNames": true,    // Cross-platform compatibility
    
    // Strict Settings (DISABLED - Enable incrementally)
    // See docs/INCREMENTAL_STRICT_MODE.md for migration plan
    "strict": false,                             // ~35 type errors need fixing first
    
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "noEmitOnError": true                        // Fail build on type errors
  },
  "include": [
    "mcp_server/**/*",
    "providers/**/*",
    "core/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "mcp_server/tests",
    "**/*.test.ts",
    "**/*.test.tsx"
  ]
}
```

### Key Settings Explained

#### `skipLibCheck: true` ✅
Skips type checking of declaration files (`.d.ts`) from `node_modules`.

**Why**: Prevents CI breakages from third-party library type changes (e.g., Playwright, Browserbase).

#### `noErrorTruncation: true` ✅
Displays full error messages without truncation.

**Why**: Makes Railway logs and CI output more readable for debugging.

#### `strict: false` ⏸️
Disables all strict type-checking options temporarily.

**Why**: Enabling strict mode revealed 35 type errors in existing code. These need to be fixed incrementally before enabling strict mode. See [INCREMENTAL_STRICT_MODE.md](docs/INCREMENTAL_STRICT_MODE.md) for the migration plan.

#### `noEmitOnError: true`
Prevents emitting JavaScript files if type errors exist.

**Why**: Ensures only type-safe code is deployed.

## Build Workflow

### Local Development
```bash
# Install dependencies
npm install

# Type check (fast)
npm run build:check

# Full build (compiles)
npm run build

# Start server
npm start
```

### Pre-commit Validation
Add to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
echo "Running type check..."
npm run build:check
if [ $? -ne 0 ]; then
  echo "❌ Type check failed. Commit aborted."
  exit 1
fi
echo "✅ Type check passed."
```

Make executable:
```bash
chmod +x .git/hooks/pre-commit
```

### CI/CD Pipeline

#### GitHub Actions
```yaml
name: Build & Deploy
on:
  push:
    branches: [main]
  pull_request:

jobs:
  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build:check
      
  build:
    name: Build
    needs: typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist/
```

#### Railway Deployment
Railway automatically:
1. Detects `package.json` and runs `npm install`
2. Executes `npm run build` (via `prestart` script)
3. Starts server with `npm start`

**Dockerfile** (if using Docker):
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build
RUN npm run build

# Start
CMD ["npm", "start"]
```

## Common Build Issues

### Type Error: Cannot find module
**Symptom**: `TS2307: Cannot find module '../types'`

**Fix**: Ensure type imports use correct paths:
```typescript
// ✅ Correct
import { SessionContext } from '../types';

// ❌ Wrong
import { SessionContext } from './providers/types'; // Deleted file
```

### Build Passes Locally but Fails in CI
**Symptom**: Types pass on your machine but fail on Railway/GitHub Actions

**Cause**: Local `node_modules` cache has different versions

**Fix**:
```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build:check
```

### External Library Type Errors
**Symptom**: `Error in node_modules/...`

**Fix**: We run with `skipLibCheck: true` to avoid third‑party type noise. If this still occurs, pin/update the offending dependency and regenerate `package-lock.json`.

### Truncated Error Messages
**Symptom**: `... and 50 more errors`

**Fix**: Already handled by `noErrorTruncation: true`. Full errors will be shown.

## Smoke Testing

After building, run smoke tests to validate functionality:

```bash
# Build first
npm run build

# Run smoke tests
npm run test:smoke
```

See [mcp_server/tests/README.smoke.md](mcp_server/tests/README.smoke.md) for details.

## Production Deployment Checklist

- [ ] Run `npm run build:check` locally
- [ ] Run `npm run build` successfully
- [ ] Run smoke tests (`npm run test:smoke`)
- [ ] Verify environment variables are set (see `.env.example`)
- [ ] Check Railway logs for startup success
- [ ] Verify MCP health endpoint: `GET /health`
- [ ] Test critical flows in production

## Related Documentation

- [TYPE_SYSTEM.md](docs/TYPE_SYSTEM.md) - Type architecture
- [RUNBOOK_EXPECTED_LOGS.md](docs/RUNBOOK_EXPECTED_LOGS.md) - Expected log milestones
- [README.md](README.md) - Project overview

## Support

For build issues:
1. Check this documentation
2. Review Railway logs
3. Search GitHub issues
4. Contact the team via Slack/Discord
