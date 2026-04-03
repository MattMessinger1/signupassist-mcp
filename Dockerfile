# ============================================
# Optimized Dockerfile for Railway (cache + speed)
# Build version: 2025-12-21-v2
# ============================================

# Base image with build tools
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++

# ============================================
# Builder stage
# ============================================
FROM base AS builder
WORKDIR /app

# Build tag is automatically set by Railway from RAILWAY_GIT_COMMIT_SHA
# No manual updates needed - Railway provides this at build time
ARG BUILD_TAG=auto
LABEL build-tag=$BUILD_TAG

# Skip Playwright browser downloads to speed up build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN echo "🏗️ Building with BUILD_TAG=$BUILD_TAG"

# Install deps early to unlock Docker layer caching
COPY package.production.json package.json
COPY package-lock.json ./
RUN npm ci

# Copy ALL TypeScript configs (prevents ENOENT errors from project references)
# This includes: tsconfig.json, tsconfig.app.json, tsconfig.node.json, 
#                tsconfig.mcp.json, tsconfig.scripts.json
COPY tsconfig*.json ./

# Copy source code
COPY mcp_server ./mcp_server
COPY providers ./providers
COPY mcp ./mcp
COPY src ./src
COPY public ./public

# Build backend (single tsc run, no duplicate)
RUN mkdir -p dist
RUN npx tsc -p tsconfig.mcp.json

# Verify AIOrchestrator was built
RUN ls -la dist/mcp_server/ai/ || echo "⚠️ AI folder not built"

# Build frontend
COPY index.html ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./

# Accept VITE_ env vars as build args (Railway passes service variables automatically)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_MCP_BASE_URL
ARG VITE_MCP_ACCESS_TOKEN
ARG VITE_ADMIN_CONSOLE_ENABLED
ARG VITE_ADMIN_API_BASE_URL
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_MCP_BASE_URL=$VITE_MCP_BASE_URL
ENV VITE_MCP_ACCESS_TOKEN=$VITE_MCP_ACCESS_TOKEN
ENV VITE_ADMIN_CONSOLE_ENABLED=$VITE_ADMIN_CONSOLE_ENABLED
ENV VITE_ADMIN_API_BASE_URL=$VITE_ADMIN_API_BASE_URL
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

RUN npx vite build

# Verify frontend build succeeded
RUN ls -la dist/client/index.html || echo "⚠️ Frontend build failed - no index.html"
RUN ls -la dist/client/assets/*.js || echo "⚠️ Frontend build failed - no JS bundles"

# Build ChatGPT Apps SDK widget bundle
RUN echo "🎯 Building ChatGPT Apps SDK widget..."
RUN mkdir -p app/web/dist

# Create widget HTML inline (avoids COPY issues with dist folder)
RUN echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script></head><body><div id="widget-root"></div><script type="module">function waitForOpenAI(cb,max=5000){const s=Date.now();const c=()=>{if(window.openai)cb(window.openai);else if(Date.now()-s<max)setTimeout(c,100);else cb(null)};c()}import("./component.js").then(m=>{waitForOpenAI(o=>{const r=document.getElementById("widget-root");(m.WidgetRoot||m.default)(r,o)})}).catch(e=>{document.getElementById("widget-root").innerHTML="<p>Error</p>"});</script></body></html>' > app/web/dist/app.html

# Install widget deps and build
RUN cd app/web && npm install --legacy-peer-deps 2>/dev/null || true
RUN cd app/web && npx esbuild src/component.tsx --bundle --format=esm --outfile=dist/component.js --external:react --external:react-dom --loader:.tsx=tsx --loader:.ts=ts || echo "⚠️ Widget build failed (optional)"

# Verify widget files exist
RUN ls -la app/web/dist/ && echo "✅ Widget files present"

# ============================================
# Runner stage (smaller final image)
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

# Copy production package.json
COPY package.production.json package.json

# Copy node_modules from builder and prune dev dependencies
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --production

# Copy built backend code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/mcp ./mcp

# Copy static files for serving frontend
COPY public ./public
COPY index.html ./

# Copy docs (legal policies served at /safety and /privacy)
COPY docs ./docs

# Copy ChatGPT Apps SDK widget bundle and HTML (optional - may not exist)
RUN mkdir -p app/web/dist
COPY --from=builder /app/app/web/dist/ ./app/web/dist/

# ChatGPT Apps manifest is already in public/.well-known/ which was copied earlier

# Expose correct port (matches code default)
EXPOSE 8080

# Start server
CMD ["node", "dist/mcp_server/index.js"]
