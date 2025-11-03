# Runbook: Expected Log Milestones

This document defines what "good" looks like in logs for a successful authentication and program discovery flow. If any milestone is missing, it indicates where the issue is occurring.

## Overview

A successful flow consists of two main phases:
1. **Login Phase** - Authentication and session establishment
2. **Orchestrator Phase** - Session reuse and program discovery

## Login Phase Success Markers

### 1. Anti-Bot Detection
```
[antibot] antibot_key ready (len=XX)
```
- **What it means**: Drupal Anti-Bot JavaScript challenge detected and extracted
- **Why it matters**: Required for form submission on SkiClubPro sites
- **Missing?**: Check `mcp_server/lib/antibot.ts` and ensure the page loaded completely

### 2. Token Stabilization
```
[antibot] Drupal tokens stable
```
- **What it means**: CSRF tokens stopped rotating, safe to proceed
- **Why it matters**: Prevents "token mismatch" errors during login
- **Missing?**: May need to wait longer or check for JavaScript errors on page

### 3. Fast-Path Authentication
```
[login] Fast-path auth detection started → probing /registration
```
- **What it means**: PACK-04 readiness check - testing if already logged in
- **Why it matters**: Avoids unnecessary login attempts
- **Missing?**: Check `mcp_server/providers/utils/skiclubproReadiness.ts`

### 4. Session Token Generation ⚠️ CRITICAL
```
login_status: 'success' + session_token: <token-value>
```
- **What it means**: Login succeeded and session token generated
- **Expected**: `session_token` must be a non-undefined string value
- **Why it matters**: This token enables session reuse in orchestrator
- **Missing or undefined?**: 
  - Check `mcp_server/providers/skiclubpro.ts` login flow
  - Verify token generation after login success
  - Ensure `storeSession()` is called with valid token

## Orchestrator Phase Success Markers

### 1. Session Token Reuse
```
[orchestrator] Reusing existing session_token; skipping login
```
- **What it means**: Orchestrator detected valid session token from login phase
- **Why it matters**: Prevents redundant login, improves performance
- **Missing?**: 
  - Session token wasn't passed from login to orchestrator
  - Check mandate/context passing in `mcp_server/ai/AIOrchestrator.ts`

### 2. Programs Discovery Success
```
scp.find_programs → ✅ Reused saved session (no login)
```
- **What it means**: PACK-05 successfully restored session and scraped programs
- **Why it matters**: Confirms session persistence works end-to-end
- **Missing?**: 
  - Check `mcp_server/providers/skiclubpro.ts` find_programs implementation
  - Verify `getSession()` and session restoration logic

### 3. Three-Pass Extractor Execution
```
[scp.find_programs] PACK-05: Running programs-only extractor
[scp.find_programs] ✅ PACK-05: Extracted X programs
[scp.find_programs] PACK-05: Grouping programs by theme
[scp.find_programs] ✅ PACK-05: Grouped into themes: [...]
```
- **What it means**: AI-powered extraction completed successfully
- **Why it matters**: Core functionality of program discovery
- **Missing?**: 
  - Check OpenAI API key configuration
  - Verify `mcp_server/lib/threePassExtractor.programs.ts`

### 4. UI Confirmation
```
Assistant message: "✅ I sorted the programs by theme…" with cards
```
- **What it means**: Frontend received and rendered programs
- **Why it matters**: End-to-end success confirmation
- **Missing?**: 
  - Check frontend response parsing
  - Verify `src/lib/chatFlowOrchestrator.ts`

## Anti-Patterns (What You Should NOT See)

### ❌ Missing Credentials Error
```
[handleAutoProgramDiscovery] Missing credential_id and session_token
```
- **What it means**: Orchestrator didn't receive session token from login
- **Root cause**: Token not generated or not passed through mandate/context
- **Fix**: Ensure login phase sets and returns session_token

### ❌ Undefined Session Token
```
session_token: undefined
```
- **What it means**: Token variable exists but has no value
- **Root cause**: Token generation logic not called or failed silently
- **Fix**: Add logging to token generation, verify `generateToken()` call

### ❌ Multiple Login Attempts
```
[scp.login] Attempting login...
[scp.login] Attempting login... (again)
```
- **What it means**: Session reuse failed, fallback to fresh login
- **Root cause**: Session token invalid, expired, or not found in cache
- **Fix**: Check session cache TTL and storage persistence

### ❌ Mandate Verification Failures
```
[audit] ❌ Mandate verification failed
Mandate verification failed: No mandate provided
```
- **What it means**: Required mandate not found in context
- **Root cause**: PACK-07 dev fallback not configured or mandate not passed
- **Fix**: 
  - Set `DEV_MANDATE_JWS` environment variable for development
  - Ensure mandate_jws passed in tool arguments

## Environment Variables Checklist

For successful operation, verify these are set:

### Required for Login & Discovery
- `OPENAI_API_KEY` - Three-pass extractor AI models
- `BROWSERBASE_API_KEY` - Browser automation
- `BROWSERBASE_PROJECT_ID` - Browserbase project
- `MANDATE_SIGNING_KEY` - Mandate creation/verification

### Optional Performance Tuning
- `SKICLUBPRO_READY_TIMEOUT_MS` - Page readiness timeout (default: 6500)
- `SKICLUBPRO_READY_MAX_RELOADS` - Max reload attempts (default: 2)
- `SESSION_CACHE_TTL_MS` - Session cache duration (default: 300000)
- `SKICLUBPRO_BLOCK_ANALYTICS_ON_LISTING` - Block analytics (default: false)

### Development Safety
- `DEV_MANDATE_JWS` - Fallback mandate for dev (PACK-07)
- `NODE_ENV` - Set to "development" to enable dev fallbacks

## Debugging Workflow

When logs don't match expected milestones:

1. **Identify the phase**: Is it failing in login or orchestrator?
2. **Find the last success marker**: What was the last milestone logged?
3. **Check the next expected milestone**: What should have happened next?
4. **Review the corresponding pack**: 
   - PACK-01: Session restoration (`mcp_server/lib/session.ts`)
   - PACK-04: Page readiness (`mcp_server/providers/utils/skiclubproReadiness.ts`)
   - PACK-05: Programs extraction (`mcp_server/providers/skiclubpro.ts`)
   - PACK-06: Three-pass AI extractor (`mcp_server/lib/threePassExtractor.programs.ts`)
   - PACK-07: Mandate fallback (`mcp_server/middleware/audit.ts`)
   - PACK-08: Analytics blocking (`mcp_server/providers/skiclubpro.ts`)

## Related Documentation

- [Session Management](./SESSION_MANAGEMENT.md)
- [Orchestrator Card Flow](./ORCHESTRATOR_CARD_FLOW.md)
- [Program Discovery Prompts](./PROGRAM_DISCOVERY_PROMPTS.md)
- [Production Mandate Flow Plan](./PRODUCTION_MANDATE_FLOW_PLAN.md)
