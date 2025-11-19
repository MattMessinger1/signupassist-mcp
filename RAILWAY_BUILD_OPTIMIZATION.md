# Railway Build Optimization Checklist

This document outlines the optimizations applied to speed up Railway builds for the MCP server.

## ✅ Code-Level Optimizations (Already Applied)

- **Multi-stage Dockerfile**: Separate builder and runner stages for smaller final image
- **Early dependency installation**: `package.production.json` copied first to enable Docker layer caching
- **Incremental TypeScript compilation**: `tsconfig.mcp.json` uses `incremental: true` with `.tsbuildinfo`
- **Single TypeScript build**: Removed duplicate `tsc --noEmit` + `tsc` runs
- **Optimized .dockerignore**: Excludes `node_modules`, `dist`, `.git`, and log files

## ⚙️ Railway Dashboard Settings (Manual Configuration Required)

### 1. Change Build Region
**Location**: Project Settings → General → Region

- ✅ **Recommended**: `us-central1` or `us-east1`
- ❌ **Avoid**: `us-east4` (known slow for Docker pulls)

### 2. Verify Build Type
**Location**: Project Settings → Builds → Build Method

- ✅ **Required**: "Dockerfile"
- ❌ **Not**: "Nixpacks" (slower, less control)

### 3. Enable Build Caching
**Location**: Project Settings → Builds

- ✅ **Enable**: "Cache builds" toggle
- This preserves Docker layer cache between builds, dramatically speeding up rebuilds when only source code changes

### 4. Verify Environment Variables
Ensure these are set in Railway:

- `WORKER_SERVICE_TOKEN` - For secure worker authentication
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `OPENAI_API_KEY` - OpenAI API key (from Supabase secrets)
- `CRED_SEAL_KEY` - Credential encryption key

## 📊 Expected Build Times

| Stage | Before Optimization | After Optimization |
|-------|-------------------|-------------------|
| Docker layer cache (no changes) | 3-4 min | **30-60 sec** |
| Source code changes only | 3-4 min | **1-2 min** |
| Dependency changes | 3-4 min | **2-3 min** |
| Clean build (no cache) | 5-6 min | **3-4 min** |

## 🔍 Verification

After applying Railway dashboard settings:

1. Trigger a build and check logs for:
   ```
   --> CACHED [builder 3/10] COPY package.production.json package.json
   --> CACHED [builder 4/10] RUN npm ci
   ```

2. Subsequent builds with only source changes should show:
   ```
   --> Using cache
   --> CACHED [builder 1/10] FROM node:20-alpine
   ```

3. Final image size should be ~150-200MB (runner stage only includes production dependencies)

## 🚀 Additional Speed Tips

- **Push during off-peak hours**: Railway's Docker registry is faster during US late night / early morning
- **Batch commits**: Multiple small commits trigger multiple builds; batch related changes
- **Use Railway CLI for testing**: `railway up` lets you test builds locally before pushing
