# Smoke Tests

Quick validation tests for authentication and program discovery flow.

## Overview

Three critical smoke tests that verify the end-to-end flow:

1. **Happy Path** - Full login → program discovery with session token
2. **Session Reuse** - Verify session persistence and reuse works
3. **Mandate Fallback** - Dev environment mandate bypass (PACK-07)

## Prerequisites

### Environment Variables

Create a `.env.test` file or set these in your environment:

```bash
# MCP Server
MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app
MCP_ACCESS_TOKEN=your_mcp_access_token

# Test Credentials (use test account)
TEST_CREDENTIAL_ID=uuid-of-test-credential
TEST_USER_JWT=jwt-token-for-test-user

# Mandates
TEST_MANDATE_JWS=test-mandate-jws-token
DEV_MANDATE_JWS=dev-fallback-mandate-jws

# Environment
NODE_ENV=development
```

### Required Secrets

Ensure these are configured in your environment:
- `OPENAI_API_KEY` - For three-pass extractor
- `BROWSERBASE_API_KEY` - For browser automation
- `BROWSERBASE_PROJECT_ID` - Browserbase project
- `MANDATE_SIGNING_KEY` - For mandate verification

## Running the Tests

### Run All Smoke Tests
```bash
npm run test:smoke
```

### Run Individual Tests
```bash
# Happy path only
npx playwright test smoke.test.ts -g "Happy Path"

# Session reuse only
npx playwright test smoke.test.ts -g "Session Reuse"

# Mandate fallback only
npx playwright test smoke.test.ts -g "Mandate Friction"
```

### Run with Verbose Logging
```bash
npx playwright test smoke.test.ts --reporter=list
```

## Expected Results

### Test 1: Happy Path ✅
```
Step 1: Calling scp.login...
✅ Session token generated: [token-value]

Step 2: Calling scp.find_programs with session_token...
✅ Programs grouped into themes: Lessons & Classes, Camps & Clinics, ...

✅ SMOKE TEST 1 PASSED
```

### Test 2: Session Reuse ✅
```
Step 1: Initial login to obtain session_token...
✅ Session token obtained: [token-value]

Step 2: Calling scp.find_programs (1st time)...
✅ First call: 15 programs extracted

Step 3: Calling scp.find_programs (2nd time - should reuse session)...
✅ Second call: 15 programs extracted
✅ Session reuse verified: Same results without re-login

✅ SMOKE TEST 2 PASSED
```

### Test 3: Mandate Fallback ✅
```
Step 1: Attempting login WITHOUT mandate_jws...
✅ Dev fallback worked: session_token = [token-value]

Step 2: Calling scp.find_programs WITHOUT mandate_jws...
✅ Programs discovered without explicit mandate: 15 programs

✅ SMOKE TEST 3 PASSED
```

## Interpreting Failures

### Test 1 Failure: "session_token is undefined"
- **Root Cause**: Token not generated after login
- **Fix**: Check `mcp_server/providers/skiclubpro.ts` login flow
- **Reference**: See RUNBOOK_EXPECTED_LOGS.md - Login Phase Success Markers

### Test 2 Failure: "Re-login occurred"
- **Root Cause**: Session cache expired or not found
- **Fix**: Check `SESSION_CACHE_TTL_MS` and session storage
- **Reference**: PACK-01 session restoration logic

### Test 3 Failure: "Mandate verification failed"
- **Root Cause**: `DEV_MANDATE_JWS` not configured or invalid
- **Fix**: Set `DEV_MANDATE_JWS` in environment
- **Reference**: PACK-07 mandate fallback implementation

## Troubleshooting

### No Programs Returned
1. Check OpenAI API key is configured
2. Verify Browserbase credentials
3. Check `/registration` page loads correctly
4. Review three-pass extractor logs

### Session Token Undefined
1. Verify login success before checking token
2. Check `generateToken()` is called
3. Verify `storeSession()` is invoked
4. Review session persistence logs

### Mandate Errors in Dev
1. Ensure `NODE_ENV !== 'production'`
2. Set `DEV_MANDATE_JWS` environment variable
3. Check PACK-07 implementation in `mcp_server/middleware/audit.ts`

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/smoke-tests.yml
name: Smoke Tests
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run test:smoke
        env:
          MCP_SERVER_URL: ${{ secrets.MCP_SERVER_URL }}
          MCP_ACCESS_TOKEN: ${{ secrets.MCP_ACCESS_TOKEN }}
          DEV_MANDATE_JWS: ${{ secrets.DEV_MANDATE_JWS }}
```

## Related Documentation

- [RUNBOOK_EXPECTED_LOGS.md](../../docs/RUNBOOK_EXPECTED_LOGS.md) - Expected log milestones
- [SESSION_MANAGEMENT.md](../../docs/SESSION_MANAGEMENT.md) - Session architecture
- [PRODUCTION_MANDATE_FLOW_PLAN.md](../../docs/PRODUCTION_MANDATE_FLOW_PLAN.md) - Mandate flow
