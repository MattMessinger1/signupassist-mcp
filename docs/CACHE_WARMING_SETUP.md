# Phase 3: Authenticated Cache Warming Setup

This document describes how to set up and use the authenticated cache warming system with system mandates.

## Overview

The `warm-cache-authenticated` edge function uses:
- **SYSTEM_MANDATE_JWS**: Authorizes system-level operations
- **SCP_SERVICE_CRED_ID**: References the system credential for authentication
- **CRED_SEAL_KEY**: Decrypts stored credentials securely

This enables automated, authenticated cache population without user interaction.

## Prerequisites

All prerequisites from Phase 1 should be complete:
- ✅ `SYSTEM_MANDATE_JWS` secret configured
- ✅ `SCP_SERVICE_CRED_ID` secret configured
- ✅ System user with stored credentials exists
- ✅ `CRED_SEAL_KEY` secret configured

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cache Warming Flow                        │
└─────────────────────────────────────────────────────────────┘

1. Cron Job triggers → warm-cache-authenticated
                         ↓
2. Retrieve SYSTEM_MANDATE_JWS (authorizes operation)
                         ↓
3. Fetch SCP_SERVICE_CRED_ID → stored_credentials
                         ↓
4. Decrypt credentials using CRED_SEAL_KEY
                         ↓
5. Call MCP server with:
   - System credentials (email/password)
   - System mandate (X-Mandate-JWS header)
                         ↓
6. MCP authenticates & scrapes programs
                         ↓
7. Cache populated in cached_programs table
                         ↓
8. Audit logs written to mandate_audit table
```

## Testing the Function

### Manual Test

Call the function directly via Supabase dashboard or CLI:

```bash
# Test for specific org and category
curl -X POST https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/warm-cache-authenticated \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "org_ref": "blackhawk-ski-club",
    "category": "lessons",
    "force_refresh": true
  }'
```

### Using Test Script

```bash
npm run test:cache-warming
# or
npx tsx scripts/testCacheWarming.ts
```

### Expected Response

```json
{
  "success": true,
  "timestamp": "2025-01-13T18:55:00.000Z",
  "summary": {
    "total": 4,
    "success": 4,
    "failed": 0
  },
  "results": [
    {
      "org_ref": "blackhawk-ski-club",
      "category": "lessons",
      "status": "success"
    },
    {
      "org_ref": "blackhawk-ski-club",
      "category": "teams",
      "status": "success"
    }
  ]
}
```

## Setting Up Automated Cache Warming

### Option 1: Supabase Cron (Recommended)

Create a cron job in Supabase to run the cache warming daily:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily cache warming at 2 AM
SELECT cron.schedule(
  'daily-cache-warming',
  '0 2 * * *', -- 2 AM every day
  $$
  SELECT
    net.http_post(
      url := 'https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/warm-cache-authenticated',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

### Option 2: External Cron Service

Use services like:
- GitHub Actions (`.github/workflows/cache-warming.yml`)
- Vercel Cron
- Railway Cron
- Cloud Scheduler (GCP/AWS)

Example GitHub Actions workflow:

```yaml
name: Cache Warming
on:
  schedule:
    - cron: '0 2 * * *' # 2 AM daily
  workflow_dispatch: # Manual trigger

jobs:
  warm-cache:
    runs-on: ubuntu-latest
    steps:
      - name: Warm Cache
        run: |
          curl -X POST https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/warm-cache-authenticated \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

## Monitoring and Audit Trail

### View Audit Logs

Check the `mandate_audit` table for all cache warming operations:

```sql
SELECT 
  created_at,
  action,
  org_ref,
  metadata->>'programs_discovered' as programs,
  metadata->>'duration_ms' as duration_ms,
  metadata->>'error' as error
FROM mandate_audit
WHERE action LIKE 'cache_warm_%'
ORDER BY created_at DESC
LIMIT 20;
```

### View in MandatesAudit Page

Navigate to `/mandates` in the app and go to the "Audit Trail" tab to see all cache warming operations with filtering and sorting.

## Troubleshooting

### Error: "SYSTEM_MANDATE_JWS not configured"

**Solution**: Complete Phase 1 to create and store the system mandate.

```bash
# Re-run Phase 1 setup
curl -X POST https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/create-system-mandate \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{
    "user_id": "add95fb0-f94f-4c88-99f1-313d7099579b",
    "scopes": ["scp:authenticate", "scp:discover:fields", "scp:find_programs"],
    "valid_duration_minutes": 10080
  }'
```

Then add the returned `mandate_jws` to Supabase secrets as `SYSTEM_MANDATE_JWS`.

### Error: "SCP_SERVICE_CRED_ID not configured"

**Solution**: Ensure the system credential is stored and the ID is in secrets.

```bash
# Check if system credential exists
curl https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/setup-system-user \
  -H "Content-Type: application/json" \
  -d '{"action": "check"}'
```

### Error: "Failed to decrypt credentials"

**Solution**: Verify `CRED_SEAL_KEY` is correctly set in Supabase secrets.

### MCP Server Errors

If the MCP server returns errors:
1. Check MCP_SERVER_URL and MCP_ACCESS_TOKEN are configured
2. Verify the MCP server is running (Railway deployment)
3. Check MCP server logs for authentication issues

## Security Considerations

### Mandate Expiration

System mandates expire after 7 days by default. You'll need to:
1. Monitor mandate expiration
2. Regenerate mandates before expiry
3. Update the `SYSTEM_MANDATE_JWS` secret

### Credential Rotation

Periodically rotate system credentials:
1. Update password in provider system
2. Re-store credentials using `setup-system-user` function
3. Verify new credential ID matches `SCP_SERVICE_CRED_ID`

### Audit Compliance

All operations are logged in `mandate_audit` with:
- Timestamp
- Organization
- Success/failure status
- Error details (if failed)
- Programs discovered count
- Duration

## Performance Optimization

### Batch Size

The function processes multiple org/category combinations. Adjust based on:
- Provider rate limits
- Cache freshness requirements
- System load

### Scheduling

Choose cron timing based on:
- Registration opening times (warm cache before peak)
- Off-peak hours (2-4 AM recommended)
- Time zone considerations

### Parallel Execution

For multiple orgs, consider:
- Separate cron jobs per org
- Staggered execution (5-10 min apart)
- Rate limiting to avoid overwhelming providers

## Next Steps (Phase 4)

Phase 4 will focus on:
- Real-time cache invalidation
- Webhook-based cache updates
- Advanced monitoring and alerting
- Multi-provider support
