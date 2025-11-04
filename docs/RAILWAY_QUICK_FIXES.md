# Railway Quick Fix Reference Card

Quick reference for common Railway deployment issues and their fixes.

## 🔧 Fix #1: OpenAI API Parameter Errors

**Symptoms:**
- `Invalid parameter: temperature` errors
- `Invalid parameter: max_tokens` errors  
- Responses API vs Chat Completions confusion

**Solution:**
All fixed! The codebase now uses:
- `buildOpenAIBody()` helper that correctly branches by `apiFamily`
- Responses API: `text: { format: { type: "json" } }`
- Chat Completions: `response_format: { type: "json_object" }`
- Temperature guard for models that don't support it

**Verification:**
```bash
npx tsx scripts/testOpenAISmokeTest.ts
```

See: [mcp_server/lib/openaiHelpers.ts](../mcp_server/lib/openaiHelpers.ts)

---

## 🔧 Fix #2: Module Not Found Errors

**Symptoms:**
- `Cannot find module '/app/dist/mcp_server/lib/openaiHelpers'`
- `Error [ERR_MODULE_NOT_FOUND]`

**Solution:**
All imports now use `.js` extension for ESM compatibility:
```typescript
// ✅ Correct
import { helper } from "./openaiHelpers.js"

// ❌ Wrong
import { helper } from "./openaiHelpers"
```

**Files Fixed:**
- `mcp_server/lib/oai.ts`
- `mcp_server/lib/openaiHelpers.test.ts`
- `mcp_server/startup/openaiSmokeTest.ts`
- `mcp_server/ai/AIOrchestrator.ts`
- `mcp_server/lib/threePassExtractor.programs.ts`

**Dockerfile Improvements:**
- Explicit `COPY mcp_server/lib ./mcp_server/lib`
- Pre-deploy type checking: `npx tsc --noEmit`
- Guaranteed clean builds: `rm -rf dist && npx tsc`

---

## 🔧 Fix #3: Force Clean Build (No Cache)

**Symptoms:**
- Stale cached files causing errors
- Module resolution works locally but fails on Railway
- Old code running despite new commits

**Quick Command:**
```bash
npm run rebuild:clean
git add . && git commit -m "force clean build $(date +%Y%m%d-%H%M%S)" && git push
```

**Or use helper script:**
```bash
bash scripts/force-clean-build.sh
```

**What It Does:**
1. Deletes `dist/` and `node_modules/`
2. Reinstalls dependencies fresh
3. Compiles TypeScript from scratch
4. Commits with BUILD_TAG timestamp
5. Railway sees new layer and rebuilds without cache

**Dockerfile BUILD_TAG:**
```dockerfile
ARG BUILD_TAG=initial
LABEL build-tag=$BUILD_TAG
RUN echo "🏗️ Building with BUILD_TAG=$BUILD_TAG"
```

See: [docs/FORCE_CLEAN_BUILD.md](./FORCE_CLEAN_BUILD.md)

---

## 🧪 Testing Mode: Disable Auto-Deploy

**Use When:**
- Running live testing sessions
- Tuning AI Orchestrator
- Need stable environment for QA
- Making rapid iterative changes

**Quick Toggle:**
1. Railway Dashboard → Settings → Deployments
2. Toggle **OFF** "Auto Deploy on Git Push"
3. ✅ Railway only deploys on manual trigger

**Re-enable for Production:**
Toggle back **ON** when testing complete

See: [docs/TESTING_MODE.md](./TESTING_MODE.md)

---

## 🔍 Verification Checklist

After deploying fixes, verify:

### ✅ Build Logs
```
🏗️ Building with BUILD_TAG=20250106-143022
🔍 Verifying types and imports...
✅ TypeScript compilation successful
```

### ✅ Runtime Logs  
```
[STARTUP] MCP HTTP Server listening on port 8080
✅ OpenAI smoke test: Responses API ✓
✅ OpenAI smoke test: Chat Completions ✓
```

### ✅ Module Resolution
```
✅ dist/mcp_server/lib/openaiHelpers.js exists
✅ All imports resolve correctly
```

### ✅ API Calls Work
```
[ROUTE] /orchestrator/chat hit
✅ OpenAI call successful
✅ No CORS errors
```

---

## 📚 Related Documentation

| Document | Purpose |
|----------|---------|
| [RAILWAY_DEPLOY.md](../RAILWAY_DEPLOY.md) | Complete deployment guide |
| [FORCE_CLEAN_BUILD.md](./FORCE_CLEAN_BUILD.md) | Detailed clean build instructions |
| [TESTING_MODE.md](./TESTING_MODE.md) | Testing workflow guide |
| [Dockerfile](../Dockerfile) | Build configuration |

---

## 🆘 Still Having Issues?

### Try in this order:

1. **Force Clean Build**
   ```bash
   npm run rebuild:clean
   git add . && git commit -m "force clean build" && git push
   ```

2. **Clear Railway Build Cache**
   - Railway Dashboard → Deployments → Redeploy
   - ✅ Check "Clear build cache"

3. **Check Railway Logs**
   - Look for BUILD_TAG timestamp
   - Verify no module errors
   - Check OpenAI smoke test results

4. **Verify Locally First**
   ```bash
   rm -rf dist node_modules
   npm ci
   npx tsc -p tsconfig.mcp.json
   npm run mcp:start
   ```

5. **Check Environment Variables**
   - `OPENAI_API_KEY` set?
   - `RAILWAY_AUTO_DEPLOY` correct?
   - All required env vars present?

---

## 🚀 Quick Deploy Workflow

### For Normal Changes
```bash
git add .
git commit -m "feat: your change"
git push
# Railway auto-deploys (if enabled)
```

### For Major Refactoring  
```bash
npm run rebuild:clean
git add .
git commit -m "refactor: your change [force-clean]"
git push
# Railway rebuilds from clean state
```

### For Testing Sessions
```bash
# 1. Disable auto-deploy in Railway Dashboard
# 2. Make changes and commit
git add . && git commit -m "test: changes" && git push
# 3. Manually deploy when ready
# 4. Re-enable auto-deploy when done
```

---

**Last Updated:** 2025-01-06  
**Lovable Project:** SignupAssist MCP
