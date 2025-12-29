# Smoke Tests

Quick validation tests for the **API-first** ChatGPT app flow (no scraping).

## Overview

These smoke tests verify the end-to-end **API-only** flow:

1. **Manifest** - `/.well-known/chatgpt-apps-manifest.json` is reachable and valid
2. **Program Discovery** - `bookeo.find_programs` returns programs for `aim-design`
3. **Required Fields** - `bookeo.discover_required_fields` returns `program_questions`
4. **Canonical Chat** - `signupassist.chat` returns `Step X/5 — …` headers
5. **No Legacy Providers** - `scp.*` tools are not registered

## Prerequisites

### Environment Variables

Set these in your environment:

```bash
# MCP Server
MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app
MCP_ACCESS_TOKEN=your_mcp_access_token

# Environment
NODE_ENV=development
```

### Required Secrets

Ensure these are configured in your environment:
- `OPENAI_API_KEY` - Optional. Only needed for ambiguous input classification; API-first flow works without it.

## Running the Tests

### Run All Smoke Tests
```bash
./node_modules/.bin/tsx scripts/smokeApiOnly.ts
```

## Expected Results

### Expected output ✅
```
[smoke] ✅ manifest ok
[smoke] ✅ bookeo.find_programs ok
[smoke] ✅ bookeo.discover_required_fields ok
[smoke] ✅ signupassist.chat (step 1) ok
[smoke] ✅ signupassist.chat (follow-up) ok
[smoke] ✅ scp.* tools absent
[smoke] ✅ ALL API-ONLY SMOKE TESTS PASSED
```

## Interpreting Failures

### Tool call 401/403
- **Root cause**: missing/invalid `MCP_ACCESS_TOKEN` for production `/tools/call`.
### `bookeo.find_programs` returns 0 programs
- **Root cause**: `cached_provider_feed` not populated for `aim-design` or Supabase creds missing on the server.
### `signupassist.chat` fails
- **Root cause**: `OPENAI_API_KEY` missing *and* the input falls into the orchestrator’s LLM fallback path. Try clearer input (“AIM Design classes”) or configure the key.

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
