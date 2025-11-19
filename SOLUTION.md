# SOLUTION: Stop Continuous Browserbase Session Creation

## Root Cause Identified ✅

The `launch-browserbase` edge function is being called via **direct HTTP POST** requests:
```
POST https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/launch-browserbase
```

Source analytics show 20+ calls in the last hour, all returning 200/429 status codes.

## Most Likely Culprit

**Railway MCP Server** might be:
1. Using OLD deployed code that still calls the edge function
2. OR has a fallback mechanism that calls the edge function when env vars are missing

## Immediate Fix Required

### Option 1: Delete the Edge Function (RECOMMENDED)
Since nothing should be calling it anymore, delete it entirely:

```bash
# Delete the edge function directory
rm -rf supabase/functions/launch-browserbase
```

This will force any remaining calls to fail, revealing who's calling it.

### Option 2: Restart Railway Service
Force Railway to reload with latest code + env vars:

1. Go to Railway dashboard
2. Select `signupassist-mcp-production` service  
3. Click "Settings" → "Restart"
4. Wait 2 minutes for deployment

### Option 3: Add Rate Limiting (TEMPORARY FIX)
Modify the edge function to reject most calls:

```typescript
// At the top of launch-browserbase/index.ts
const MAX_SESSIONS_PER_HOUR = 3;
const callLog = new Map();

// In the handler
const now = Date.now();
const caller = req.headers.get('x-forwarded-for') || 'unknown';
const lastCall = callLog.get(caller) || 0;

if (now - lastCall < 60 * 60 * 1000 / MAX_SESSIONS_PER_HOUR) {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded' }),
    { status: 429, headers: corsHeaders }
  );
}
callLog.set(caller, now);
```

## Verification Steps

After applying fix:
1. Wait 5 minutes
2. Check Browserbase dashboard → Sessions tab
3. Verify no new sessions are created
4. Check edge function logs → should show no new calls

## Next Actions

**CHOOSE ONE**:
- [ ] Delete `launch-browserbase` edge function entirely
- [ ] Restart Railway service to force code reload
- [ ] Add rate limiting as temporary measure

Then monitor for 10 minutes to confirm sessions stop.
