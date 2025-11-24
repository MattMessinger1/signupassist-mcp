# Railway Deployment Guide

## 🧪 Testing Mode: Disable Auto-Deploy

**During live testing or AI Orchestrator tuning, prevent Railway from auto-deploying on every git push.**

### Quick Toggle (Railway Dashboard)
1. Go to Railway dashboard: https://railway.app
2. Select your `signupassist-mcp-production` service
3. Navigate to **Settings** → **Deployments** tab
4. Toggle **OFF** the **"Auto Deploy on Git Push"** option
5. ✅ Railway will now only deploy when you manually click "Deploy"

### When to Disable Auto-Deploy
- During live testing sessions
- When tuning AI Orchestrator prompts or flows
- When making rapid iterative changes
- When you need a stable environment for QA

### When to Re-Enable Auto-Deploy
- After testing is complete
- For production deployments
- When you want continuous deployment

### Environment Variable Control (Optional)
Add this to your Railway environment variables:
```
RAILWAY_AUTO_DEPLOY=false
```

This serves as documentation for the current deployment mode.

---

## 🏗️ Force Clean Build (No Cache)

**Use when encountering stale cache issues or module resolution errors.**

### Quick Command
```bash
npm run rebuild:clean
git add .
git commit -m "force clean Railway build $(date +%Y%m%d-%H%M%S)"
git push origin main
```

### When to Use Force Clean Build
- Module not found errors (e.g., `/app/dist/mcp_server/lib/openaiHelpers`)
- Stale cached files causing incorrect behavior
- After major refactoring or file renames
- Build artifacts from previous versions interfering

See [docs/FORCE_CLEAN_BUILD.md](./docs/FORCE_CLEAN_BUILD.md) for detailed instructions.

---

## Quick Fix for CORS Issue

The CORS headers have been updated in `mcp_server/index.ts` to include `X-Mandate-JWS`. To deploy this fix to Railway:

### Step 1: Commit and Push
```bash
git add mcp_server/index.ts package.production.json
git commit -m "fix: Add X-Mandate-JWS to CORS headers"
git push
```

### Step 2: Trigger Railway Rebuild

**Option A: Via Railway Dashboard (Recommended)**
1. Go to Railway dashboard: https://railway.app
2. Select your `signupassist-mcp-production` service
3. Click **"Deployments"** tab
4. Click **"Redeploy"** on the latest deployment
5. ✅ Check **"Clear build cache"** option
6. Click **"Redeploy"** button

**Option B: Via Railway CLI**
```bash
railway up --service signupassist-mcp-production
```

### Step 3: Verify Deployment

**Check Build Logs:**
Look for these lines in Railway build logs:
```
RUN npx tsc -p tsconfig.mcp.json
✓ TypeScript compilation successful
```

**Check Runtime Logs:**
After deployment, you should see:
```
[STARTUP] MCP HTTP Server listening on port 8080
[HEALTH] check received
```

**Test the Fix:**
1. Go to `/chat-test` in your app
2. Send a test message
3. Check browser console - the CORS error should be gone
4. Check Railway logs for: `[ROUTE] /orchestrator/chat hit`

## Railway Configuration

### Build Command
Railway uses the Dockerfile which automatically:
1. Compiles TypeScript: `npx tsc -p tsconfig.mcp.json`
2. Builds frontend: `npm run build:frontend`
3. Copies built files to `dist/`

### Start Command
```
npm run mcp:start
```
(This runs `node dist/mcp_server/index.js`)

### Environment Variables
Ensure these are set in Railway:
- `OPENAI_API_KEY` - Your OpenAI API key
- `OPENAI_MODEL` - (optional) Defaults to gpt-4o
- `SUPABASE_URL` - Your Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
- `BROWSERBASE_API_KEY` - Your Browserbase API key
- `BROWSERBASE_PROJECT_ID` - Your Browserbase project ID

## Troubleshooting

### CORS Still Failing After Deploy
1. **Hard refresh browser**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. **Check Railway logs** for the actual running code version
3. **Verify deployment timestamp** matches your commit time
4. **Clear Railway build cache** and redeploy

### TypeScript Compilation Errors
If the build fails with TypeScript errors:
1. Check Railway build logs for specific error messages
2. Run locally: `npm run build:backend`
3. Fix any type errors before pushing

### Server Not Starting
1. Check Railway logs for startup errors
2. Verify `dist/mcp_server/index.js` exists in deployment
3. Check that all dependencies are in `dependencies` (not `devDependencies`)

### Frontend Not Loading
1. Verify `dist/client` folder exists in deployment
2. Check Dockerfile is copying frontend build: `COPY --from=builder /app/dist/client ./dist/client`
3. Ensure Vite build completed successfully in build logs

### Error: Cannot find tsconfig.*.json

**Symptom**:
```
error during build:
[vite:build-html] parsing /app/tsconfig.node.json failed: Error: ENOENT
ERROR: failed to build: failed to solve: process "/bin/sh -c npx vite build" did not complete successfully: exit code: 1
```

**Cause**: Dockerfile not copying all TypeScript config files. This project uses multiple `tsconfig` files that reference each other (see [docs/TYPESCRIPT_CONFIGS.md](./docs/TYPESCRIPT_CONFIGS.md)).

**Fix**: Verify Dockerfile contains the wildcard copy:
```dockerfile
COPY tsconfig*.json ./
```

**Verify in Railway Build Logs**:
Look for this line during the build:
```
COPY tsconfig*.json ./
```

If missing, the Dockerfile needs the long-term fix (see [docs/TYPESCRIPT_CONFIGS.md](./docs/TYPESCRIPT_CONFIGS.md)).

## Current CORS Configuration

After this fix, the server allows these headers:
```javascript
'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mandate-JWS, X-Mandate-Id'
```

This enables the frontend to send mandate data securely via the `X-Mandate-JWS` header.
