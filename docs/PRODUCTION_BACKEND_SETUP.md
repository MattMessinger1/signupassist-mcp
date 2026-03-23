# Production Backend Setup Guide

This document outlines the production-ready backend infrastructure implemented for SignupAssist.

## ✅ Completed Phases

### Phase 1: Audit Trail Infrastructure ✅

**What:** Every user action is logged to `mandate_audit` table for compliance and transparency.

**Implementation:**
- `mandate_audit` table with RLS policies
- `mcp_server/lib/auditLogger.ts` - Centralized audit logging
- `AIOrchestrator.handleAction()` - Logs all card actions
- API-first provider integrations use server-side API keys

**Logged Actions:**
- `action_select_provider` - Provider selection
- `action_connect_account` - Account connection initiated
- `action_select_program` - Program selection
- `registration_completed` - Final registration submission

**View Audit Logs:**
- Go to `/mandates-audit` page
- Click "Audit Trail" tab
- See all user actions with timestamps, metadata, and providers

---

### Phase 2: Session Persistence ✅

**What:** Session context survives server restarts by syncing to Supabase.

**Implementation:**
- `agentic_checkout_sessions` table with 24-hour TTL
- `mcp_server/lib/sessionPersistence.ts` - Database sync layer
- `AIOrchestrator.getContext()` - Loads from DB if not in memory
- `AIOrchestrator.updateContext()` - Saves to DB automatically
- `cleanup_expired_checkout_sessions()` - Database function for cleanup
- `supabase/functions/cleanup-sessions/index.ts` - Cron job edge function

**Session Lifecycle:**
1. User starts conversation → session created in memory
2. Every context update → synced to Supabase
3. Server restart → session loaded from DB on next message
4. After 24 hours → session auto-deleted by cleanup job

**Testing Session Persistence:**
```bash
# 1. Start conversation in ChatTestHarness
# 2. Restart MCP server
# 3. Send another message
# 4. Session context should be preserved
```

---

### Phase 3: Real MCP Tool Integration ✅

**What:** Replace mock data with real provider interactions via MCP HTTP endpoint.

**Implementation:**
- `AIOrchestrator.callTool()` - Calls MCP server via HTTP
- Environment variable: `USE_REAL_MCP=true` to enable
- Environment variable: `MCP_SERVER_URL` (default: `http://localhost:8080`)
- 30-second timeout on all MCP calls
- Automatic fallback to mock tools if MCP unavailable

**Supported Tools:**
| Internal Tool | MCP Tool Name | Purpose |
|--------------|---------------|---------|
| `search_provider` | Provider search / org resolution | Find providers by name/location |
| `find_programs` | `bookeo.find_programs` | List available programs |
| `check_prerequisites` | `bookeo.test_connection` | Verify API readiness |
| `discover_fields` | `bookeo.discover_required_fields` | Get registration form fields |
| `submit_registration` | `bookeo.confirm_booking` | Confirm booking / registration |

**Environment Variables:**
```bash
# Railway/Production
USE_REAL_MCP=true
MCP_SERVER_URL=https://your-mcp-server.railway.app

# Local Development
USE_REAL_MCP=false  # Uses mock tools
```

---

### Phase 4: Error Recovery & Resilience ✅

**What:** Graceful error handling with retry logic and user-friendly messages.

**Implementation:**
- `withRetry()` method - Exponential backoff (max 3 retries)
- 30-second timeout on MCP tool calls
- Network error detection with friendly messages
- Automatic fallback to mock tools during development

**Error Handling Examples:**

| Error Type | User Message | Action |
|-----------|-------------|--------|
| Network timeout | "This is taking longer than expected. Please try again." | Retry button |
| Expired JWT | "Your session expired. Please log in again." | Redirect to `/auth` |
| MCP unavailable | Falls back to mock tools | Continues flow |
| Google API error | "Search service temporarily unavailable. Please try again shortly." | Retry button |

---

## 📋 Testing Checklist

### Phase 1: Audit Trail
- [ ] Complete a full signup flow in ChatTestHarness
- [ ] Go to `/mandates-audit` → "Audit Trail" tab
- [ ] Verify all actions are logged:
  - [ ] Provider selection
  - [ ] Program selection
  - [ ] Registration completed
- [ ] Check timestamps are accurate
- [ ] Verify metadata contains sessionId, provider, org_ref

### Phase 2: Session Persistence
- [ ] Start conversation in ChatTestHarness
- [ ] Select provider, connect account
- [ ] Check Supabase `agentic_checkout_sessions` table - session exists
- [ ] Restart MCP server (Railway: redeploy)
- [ ] Send another message
- [ ] Verify context is preserved (provider still selected)
- [ ] Wait 24 hours → session auto-deleted

### Phase 3: MCP Integration
- [ ] Set `USE_REAL_MCP=true` in Railway env vars
- [ ] Search for "AIM Design"
- [ ] Verify real MCP is called (check logs: `[MCP] Calling real tool`)
- [ ] Test timeout: Set `MCP_SERVER_URL` to invalid URL
- [ ] Verify friendly error message shown
- [ ] Set `USE_REAL_MCP=false` → verify mock tools work

### Phase 4: Error Recovery
- [ ] Disconnect internet → verify network error message
- [ ] Set invalid MCP URL → verify retry logic works
- [ ] Log out → trigger action → verify session expiry message
- [ ] Timeout test: Add delay to MCP server → verify 30s timeout

---

## 🚀 Deployment Configuration

### Railway Environment Variables

```bash
# Required for all phases
SUPABASE_URL=https://jpcrphdevmvzcfgokgym.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_ANON_KEY=<your-anon-key>

# Phase 3: MCP Integration
USE_REAL_MCP=true
MCP_SERVER_URL=https://your-mcp-server.railway.app

# Provider APIs
BOOKEO_API_KEY=<your-bookeo-api-key>
BOOKEO_SECRET_KEY=<your-bookeo-secret-key>

# Optional
OPENAI_API_KEY=<your-key>
GOOGLE_PLACES_API_KEY=<your-key>
```

### Supabase Edge Functions Config

Update `supabase/config.toml`:

```toml
[functions.cleanup-sessions]
verify_jwt = false  # Public cron job

[functions.cred-get]
verify_jwt = true  # Requires authentication
```

### Cron Job Setup (Optional)

Schedule `cleanup-sessions` to run daily:

```sql
select cron.schedule(
  'cleanup-expired-sessions',
  '0 2 * * *', -- 2 AM daily
  $$
  select net.http_post(
    url:='https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/cleanup-sessions',
    headers:='{"Content-Type": "application/json"}'::jsonb
  ) as request_id;
  $$
);
```

---

## 🔍 Monitoring & Debugging

### Check Audit Logs
```sql
-- Recent audit logs
SELECT * FROM mandate_audit 
ORDER BY created_at DESC 
LIMIT 50;

-- Logs by action type
SELECT action, COUNT(*) 
FROM mandate_audit 
GROUP BY action;

-- Credential access logs
SELECT * FROM mandate_audit 
WHERE action = 'credentials_accessed' 
ORDER BY created_at DESC;
```

### Check Active Sessions
```sql
-- Active sessions (not expired)
SELECT id, provider_id, user_id, created_at, expires_at 
FROM agentic_checkout_sessions 
WHERE expires_at > now();

-- Sessions by age
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE expires_at > now()) as active,
  COUNT(*) FILTER (WHERE expires_at <= now()) as expired
FROM agentic_checkout_sessions;
```

### MCP Server Logs
```bash
# Railway logs
railway logs --tail

# Look for:
[MCP] Calling real tool: scp.search_providers
[MCP] Tool scp.search_providers succeeded
[MCP] Tool scp.search_providers failed: timeout
```

---

## 🎯 Production Readiness Score

| Phase | Status | Production-Ready? |
|-------|--------|-------------------|
| 1. Audit Trail | ✅ Complete | ✅ Yes |
| 2. Session Persistence | ✅ Complete | ✅ Yes |
| 3. MCP Integration | ✅ Complete | ⚠️  Needs `USE_REAL_MCP=true` |
| 4. Error Recovery | ✅ Complete | ✅ Yes |
| 5. Testing | 🟡 Pending | ⏳ Run checklist |

**Overall:** Backend is production-ready pending final testing. Set `USE_REAL_MCP=true` in Railway when ready for real provider interactions.

---

## 📚 Related Documentation

- [Mandate Audit Trail](/docs/FUTURE_BUILD_AUDIT_DEFENSE.md)
- [Chat Test Harness User Guide](/docs/CHAT_TEST_HARNESS_USER_GUIDE.md)
- [Production Mandate Flow Plan](/docs/PRODUCTION_MANDATE_FLOW_PLAN.md)
