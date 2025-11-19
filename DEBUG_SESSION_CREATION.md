# Debug: Continuous Browserbase Session Creation

## Problem Statement
Even after disabling cron jobs, `launch-browserbase` edge function continues to create sessions.

## Evidence
- **Timestamp**: 2025-11-19T20:29:04.847Z (AFTER cron disable)
- **UserAgent**: `Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.69.22)` (proves it's Supabase edge function)
- **Referer**: `unknown`
- **Authorization**: `present`

## Investigation Results

### ✅ Cron Jobs - DISABLED
```sql
SELECT jobname FROM cron.job
-- Result: []  (no active cron jobs)
```

### ✅ Edge Functions - NO DIRECT CALLS
- No edge functions use `functions.invoke('launch-browserbase')`
- All edge functions checked ✅

### ✅ Railway MCP Server - USING API DIRECTLY
- `mcp_server/lib/browserbase-skiclubpro.ts` calls Browserbase API directly
- Does NOT call `launch-browserbase` edge function ✅

### ❓ Remaining Mystery
**Who is calling `launch-browserbase`?**

## Next Steps

1. **Check if user clicked "Refresh Cache" button** - this would trigger `refresh-feed` → Railway → potential session creation
2. **Check Railway deployment** - ensure it's running the latest code with env vars
3. **Delete or rate-limit the edge function** - if nothing should call it, remove it
4. **Monitor for 10 minutes** - see if sessions stop after Railway restarts

## Hypothesis
The `launch-browserbase` edge function might be:
- Called by external health checks / monitoring
- Called by old Railway code (if not restarted yet)
- Called by a forgotten integration or webhook

## Recommended Fix
**Option A**: Delete `launch-browserbase` edge function entirely (safest)
**Option B**: Add strict rate limiting (1 call per hour max)
**Option C**: Change function to require a secret token that only Railway knows
