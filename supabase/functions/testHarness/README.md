# Test Harness Edge Function

End-to-end test harness for the credential login flow using the mock SkiClubPro provider.

## Purpose

This edge function tests the complete login flow including:
- Credential checking
- Browserbase session creation
- Automated login via MCP server
- 2FA handling
- Credential storage
- Audit logging

## Prerequisites

1. Mock provider running at `http://localhost:4321`
2. Required Supabase secrets configured:
   - `BROWSERBASE_API_KEY`
   - `BROWSERBASE_PROJECT_ID`
   - `MCP_SERVER_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Local Testing

### Start the mock provider first:
```bash
cd mock-provider
npm install
npm start
```

### Start Supabase locally:
```bash
supabase start
```

### Serve the test harness:
```bash
supabase functions serve testHarness
```

The function will be available at:
```
http://localhost:54321/functions/v1/testHarness
```

## Test Cases

### Test 1: No credential exists (first login)
```bash
curl -X POST http://localhost:54321/functions/v1/testHarness \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-123",
    "provider_id": "skiclubpro",
    "org_ref": "mock-org"
  }'
```

Expected response:
```json
{
  "status": "login_success",
  "message": "Login simulated and credential saved ✅",
  "credential_id": "...",
  "browserbase_session": "...",
  "browserbase_url": "https://www.browserbase.com/sessions/...",
  "test_data": {
    "email": "parent@example.com",
    "provider": "skiclubpro",
    "org_ref": "mock-org"
  }
}
```

### Test 2: Credential already exists
Run the same curl command again:

Expected response:
```json
{
  "status": "connected",
  "message": "✅ You're already connected to skiclubpro!",
  "credential_id": "..."
}
```

### Test 3: 2FA flow
The mock provider is configured with 2FA enabled. The harness will detect this and return:

```json
{
  "status": "requires_2fa",
  "message": "🔐 2FA challenge detected. Code: 654321",
  "session_id": "...",
  "browserbase_url": "...",
  "next_step": "Automated 2FA handling would occur here"
}
```

## Debugging

### View function logs:
```bash
supabase logs functions testHarness
```

### Check stored credentials:
```sql
SELECT * FROM stored_credentials WHERE user_id = 'test-user-123';
```

### Check audit logs:
```sql
SELECT * FROM audit_events WHERE user_id = 'test-user-123' ORDER BY created_at DESC;
```

## Architecture

The test harness:
1. Uses Supabase client for all database operations (no raw SQL)
2. Leverages existing shared utilities (`auditLogin`, `browserbaseClient`)
3. Follows proper CORS and security patterns
4. Integrates with the MCP server for actual browser automation
5. Maintains full audit trail

## Mock Provider Integration

The harness connects to the mock provider at `localhost:4321` which simulates:
- Login form at `/user/login`
- 2FA challenge at `/twofactor` (code: 654321)
- Success dashboard at `/dashboard`

Test credentials:
- Email: `parent@example.com`
- Password: `password123`
- 2FA Code: `654321`
