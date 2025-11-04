# Testing Mode: Prevent Auto-Deploy During QA

## Quick Reference

### Enable Testing Mode (Disable Auto-Deploy)

**Railway Dashboard (Recommended):**
1. Go to https://railway.app → Your Project
2. Settings → Deployments
3. Toggle **OFF** "Auto Deploy on Git Push"
4. ✅ Done! Railway now only deploys on manual trigger

**Environment Variable (Optional):**
```bash
# Add in Railway environment variables
RAILWAY_AUTO_DEPLOY=false
```

### When to Use Testing Mode

✅ **Use Testing Mode When:**
- Running live QA sessions
- Tuning AI Orchestrator prompts and flows
- Making rapid iterative changes
- Need stable environment for debugging
- Testing with real users
- Performance testing or load testing

❌ **Don't Use Testing Mode When:**
- In production environment
- Want continuous deployment
- No active testing happening
- Collaborating with team (they need latest changes)

### Re-Enable Production Mode

**Railway Dashboard:**
1. Settings → Deployments
2. Toggle **ON** "Auto Deploy on Git Push"
3. Remove `RAILWAY_AUTO_DEPLOY` env var (if set)

---

## How It Works

### Railway Auto-Deploy Behavior

**With Auto-Deploy ON (Production Mode):**
```
Git Push → GitHub → Railway Webhook → Automatic Build & Deploy
```

**With Auto-Deploy OFF (Testing Mode):**
```
Git Push → GitHub → Railway (no action)
Manual Click in Railway Dashboard → Build & Deploy
```

### Build-Time Indicators

The Dockerfile and railway.json include checks that log the current mode:

**Testing Mode:**
```
🧪 Auto-deploy disabled for testing mode
```

**Production Mode:**
```
🚀 Auto-deploy enabled for production
```

Check your Railway build logs to see which mode is active.

---

## Best Practices

### During Testing Sessions

1. **Start of Session:**
   - Disable auto-deploy in Railway
   - Set `RAILWAY_AUTO_DEPLOY=false` (optional)
   - Deploy once manually to get latest code
   - Notify team about testing mode

2. **During Session:**
   - Make changes locally/in Lovable
   - Commit and push to GitHub (changes saved but not deployed)
   - Only deploy manually when you want to test specific changes
   - Take notes of what works/doesn't work

3. **End of Session:**
   - Re-enable auto-deploy
   - Remove `RAILWAY_AUTO_DEPLOY` env var
   - Deploy final working version
   - Document findings

### Multi-Developer Teams

If multiple developers are testing:
- Use separate Railway services for each developer/branch
- Or coordinate testing windows in a shared calendar
- Or use feature branches with separate Railway environments

### Emergency Production Deploy

If you need to deploy urgently while in testing mode:
1. Go to Railway Dashboard
2. Click "Deploy" button
3. No need to toggle auto-deploy back on

---

## Troubleshooting

### "Why isn't my code deploying?"
Check if auto-deploy is disabled in Railway Settings → Deployments.

### "How do I deploy my latest changes?"
1. Railway Dashboard → Select Service
2. Deployments Tab → Click "Deploy" button
3. Or re-enable auto-deploy and push to GitHub

### "Can I test locally instead?"
Yes! Recommended for rapid iteration:
```bash
npm run mcp:http  # Run MCP server locally
npm run dev       # Run frontend locally
```

---

## Environment Variables Reference

| Variable | Purpose | When Set |
|----------|---------|----------|
| `RAILWAY_AUTO_DEPLOY=false` | Document testing mode | During QA sessions |
| `RAILWAY_AUTO_DEPLOY=true` or unset | Document production mode | Normal operations |

Note: This variable is for documentation only. The actual auto-deploy toggle is controlled in Railway Dashboard Settings.
