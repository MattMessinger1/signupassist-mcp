# Test Harness Edge Function

Smoke test for Bookeo API connectivity and optional test credential storage.

## Purpose

- Verifies `MCP_SERVER_URL` can reach the MCP server and run `bookeo.test_connection`
- Optionally inserts a placeholder row in `stored_credentials` when the API check succeeds
- Writes audit entries via `auditLogin`

## Prerequisites

Supabase secrets:

- `MCP_SERVER_URL`
- `MCP_ACCESS_TOKEN` (if your MCP server requires `Authorization`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Bookeo credentials are configured on the **Railway MCP server** (`BOOKEO_API_KEY` / `BOOKEO_SECRET_KEY`), not in this function.

## Local testing

```bash
supabase functions serve testHarness
```

Invoke:

```bash
curl -X POST http://localhost:54321/functions/v1/testHarness \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-123",
    "provider_id": "bookeo",
    "org_ref": "aim-design"
  }'
```

### Expected (first run)

```json
{
  "status": "login_success",
  "message": "Bookeo API reachable and test credential saved ✅",
  "credential_id": "...",
  "test_data": { "provider": "bookeo", "org_ref": "aim-design" }
}
```

### Expected (credential already exists)

```json
{
  "status": "connected",
  "message": "✅ You're already connected to bookeo!",
  "credential_id": "..."
}
```

## Debugging

```bash
supabase functions logs testHarness
```

```sql
SELECT * FROM stored_credentials WHERE user_id = 'test-user-123';
```

## Architecture

1. Supabase service client for `stored_credentials` and audits  
2. HTTP `POST` to `${MCP_SERVER_URL}/tools/call` with `bookeo.test_connection`  
3. No browser automation — API-only  
