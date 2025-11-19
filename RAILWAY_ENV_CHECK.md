# Railway Environment Variables Checklist

## Required Variables for MCP Server

The MCP server needs these environment variables to call Browserbase API directly (without edge function):

1. **BROWSERBASE_API_KEY**
   - Value: Your Browserbase API key (starts with `bb_`)
   - Location: Railway → signupassist-mcp-production → Variables

2. **BROWSERBASE_PROJECT_ID**  
   - Value: `d22bbfff-eb6e-4175-a288-5e22949bf116`
   - Location: Railway → signupassist-mcp-production → Variables

## ⚠️ CRITICAL: Railway Restart Required ⚠️

**The Railway service MUST be restarted after adding env vars!**

### Steps to Restart Railway:

1. Go to https://railway.app
2. Select your `signupassist-mcp-production` service
3. Click "Variables" tab
4. Verify BOTH variables are present:
   - `BROWSERBASE_API_KEY` (value starts with `bb_`)
   - `BROWSERBASE_PROJECT_ID` = `d22bbfff-eb6e-4175-a288-5e22949bf116`
5. **CRITICAL**: Click the "⋮" menu (three dots) → "Restart Service"
6. Wait 3-5 minutes for the service to fully restart and stabilize
7. Check deployment logs to confirm env vars are loaded

## Why This is Necessary

Without these env vars in Railway:
- The MCP server cannot call Browserbase API directly
- Falls back to calling `launch-browserbase` edge function
- Creates sessions continuously

With env vars set + restart:
- MCP server calls Browserbase API directly
- No edge function calls
- No automatic session creation

## If Sessions Still Start After Restart

Run this command to see Railway logs and verify env vars are loaded:

```bash
# Check if env vars are present in logs
railway logs --service signupassist-mcp-production | grep BROWSERBASE
```

You should see:
```
BROWSERBASE_API_KEY: bb_****
BROWSERBASE_PROJECT_ID: d22b****
```
