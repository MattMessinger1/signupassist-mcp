# ============= BUILD STAGE =============
FROM node:20-alpine AS builder

# Force rebuild toggle — updated automatically by Lovable or CLI
# Last rebuild: 2025-11-04 20:25:00 UTC - Increased token limits to 5K/10K
ARG BUILD_TAG=20251104-202500
LABEL build-tag=$BUILD_TAG

WORKDIR /app

# Skip Playwright browser downloads to speed up build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN echo "🏗️ Building with BUILD_TAG=$BUILD_TAG"

# Copy all package files
COPY package.production.json package.json
COPY package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configs and source for BACKEND
COPY tsconfig.json tsconfig.mcp.json ./
COPY mcp_server ./mcp_server
COPY providers ./providers
COPY mcp ./mcp

# --- Ensure full lib coverage ---
COPY mcp_server/lib ./mcp_server/lib
COPY mcp_server/types.ts ./mcp_server/

# Clear any cached dist folder and ensure fresh compile
RUN rm -rf dist && mkdir -p dist

# Pre-deploy type and import verification
RUN npx tsc -p tsconfig.mcp.json --noEmit

# Build backend TypeScript to dist/ (clean build)
RUN rm -rf dist && npx tsc -p tsconfig.mcp.json

# Check deployment mode
RUN if [ "$RAILWAY_AUTO_DEPLOY" = "false" ]; then \
      echo "🧪 Auto-deploy disabled for testing mode"; \
    else \
      echo "🚀 Auto-deploy enabled for production"; \
    fi

# Verify AIOrchestrator was built
RUN ls -la dist/mcp_server/ai/ || echo "⚠️ AI folder not built"

# Copy frontend source and configs for FRONTEND BUILD
COPY src ./src
COPY index.html ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY components.json ./
COPY public ./public

# Build frontend (Vite production bundle)
RUN npm run build:frontend

# ============= RUNTIME STAGE =============
FROM node:20-alpine

WORKDIR /app

# Copy production package.json
COPY package.production.json package.json

# Copy node_modules from builder stage and prune dev dependencies
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --production

# Copy built backend code from builder stage
COPY --from=builder /app/dist ./dist
COPY mcp ./mcp

# Copy built frontend static files from builder stage
COPY --from=builder /app/dist/client ./dist/client

# Expose correct port (matches code default)
EXPOSE 8080

# Start server
CMD ["npm", "run", "mcp:start"]