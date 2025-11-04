# Force Clean Build in Railway (No Cache)

## When to Use This

Use a forced clean build when you encounter:
- `Cannot find module '/app/dist/mcp_server/lib/openaiHelpers'` errors
- Stale cached files causing incorrect API calls (old `response_format` vs `text.format`)
- Build artifacts from previous versions interfering with new code
- Mysterious runtime errors that don't match your current source code
- After major refactoring or file renames

## Quick Command

From your terminal or Lovable action panel:

```bash
npm run rebuild:clean
git add .
git commit -m "force clean Railway build $(date +%Y%m%d-%H%M%S)"
git push origin main
```

**What this does:**
1. Deletes `dist/` and `node_modules/` locally
2. Reinstalls all dependencies from scratch
3. Compiles TypeScript fresh
4. Commits with a timestamped message
5. Railway detects the new BUILD_TAG and rebuilds from clean state

---

## How It Works

### BUILD_TAG System

The Dockerfile includes a build argument that changes with each forced rebuild:

```dockerfile
ARG BUILD_TAG=initial
LABEL build-tag=$BUILD_TAG
RUN echo "🏗️ Building with BUILD_TAG=$BUILD_TAG"
```

When you commit any change after running `rebuild:clean`, Railway sees a new layer hash and rebuilds without using cached `dist/` or `node_modules/`.

### Rebuild Script

The `rebuild:clean` script in `package.production.json`:

```json
"rebuild:clean": "rm -rf dist node_modules && npm ci && npx tsc -p tsconfig.mcp.json && echo '✅ Clean build complete — ready for Railway redeploy.'"
```

This ensures you're committing with a known-good local build state.

---

## Railway Dashboard Alternative

If you can't access the command line:

### Option A: Clear Build Cache
1. Go to Railway Dashboard → Your Service
2. Deployments Tab → Latest Deployment
3. Click **"Redeploy"**
4. ✅ Check **"Clear build cache"**
5. Click **"Redeploy"** button

### Option B: Trigger Rebuild from Settings
1. Railway Dashboard → Settings
2. Click **"Force Redeploy"**
3. Railway will rebuild without using cached layers

---

## Verification

After the rebuild completes, check Railway logs for:

### Expected Build Output
```
🏗️ Building with BUILD_TAG=20250106-143022
✅ TypeScript compilation successful
✅ Clean build complete
[STARTUP] MCP HTTP Server listening on port 8080
```

### Expected Module Resolution
```
✅ dist/mcp_server/lib/openaiHelpers.js exists
✅ All imports resolve correctly
```

If you still see module errors after a forced clean build, check:
1. **Import paths** - All relative imports should end in `.js` for ESM
2. **File names** - Ensure no typos in import statements
3. **tsconfig.mcp.json** - Verify `outDir` is set to `dist/`

---

## Troubleshooting

### "npm run rebuild:clean fails locally"
- Check you have write permissions in the project directory
- Try running with sudo if on Linux/Mac: `sudo npm run rebuild:clean`
- On Windows, run terminal as Administrator

### "Railway still using cached build"
- Verify you committed and pushed after running `rebuild:clean`
- Check Railway deployment logs show new BUILD_TAG timestamp
- Try Railway Dashboard → Force Redeploy with cache clearing

### "Module still not found after clean build"
- Check the actual file exists: `ls -la mcp_server/lib/openaiHelpers.ts`
- Verify import statement ends in `.js`: `import { x } from "./openaiHelpers.js"`
- Check Dockerfile copies the file: `COPY mcp_server/lib ./mcp_server/lib`

---

## Best Practices

### Before Major Deploys
Run a clean build to ensure:
- No stale artifacts
- All imports resolve
- TypeScript compiles without errors
- Fresh node_modules

### After Refactoring
Always use clean build after:
- Renaming files or moving them
- Changing import/export structures
- Updating major dependencies
- Switching between Responses API and Chat Completions

### Testing Clean Builds Locally
Before pushing to Railway:
```bash
npm run rebuild:clean
npm run mcp:start  # Test locally
# If it works, commit and push
```

---

## Automated Clean Build

### GitHub Actions Integration

Add to `.github/workflows/deploy.yml`:

```yaml
- name: Force clean build on major changes
  if: contains(github.event.head_commit.message, '[force-clean]')
  run: |
    rm -rf dist node_modules
    npm ci
    npx tsc -p tsconfig.mcp.json
```

Then trigger with:
```bash
git commit -m "fix: update OpenAI helpers [force-clean]"
```

---

## Related Documentation

- [RAILWAY_DEPLOY.md](../RAILWAY_DEPLOY.md) - General Railway deployment guide
- [TESTING_MODE.md](./TESTING_MODE.md) - Disable auto-deploy during testing
- [Dockerfile](../Dockerfile) - Build configuration
