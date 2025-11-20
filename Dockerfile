# ============================================
# Optimized Dockerfile for Railway (cache + speed)
# ============================================

# Base image with build tools
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++

# ============================================
# Builder stage
# ============================================
FROM base AS builder
WORKDIR /app

# Force rebuild toggle — updated automatically by Lovable or CLI
# Last rebuild: 2025-11-20 - Align with Railway deployment b9e7276
ARG BUILD_TAG=b9e7276
LABEL build-tag=$BUILD_TAG

# Skip Playwright browser downloads to speed up build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN echo "🏗️ Building with BUILD_TAG=$BUILD_TAG"

# Install deps early to unlock Docker layer caching
COPY package.production.json package.json
COPY package-lock.json ./
RUN npm ci

# Copy TypeScript configs
COPY tsconfig.json tsconfig.json
COPY tsconfig.mcp.json tsconfig.mcp.json

# Copy source code
COPY mcp_server ./mcp_server
COPY providers ./providers
COPY mcp ./mcp
COPY src ./src

# Build backend (single tsc run, no duplicate)
RUN mkdir -p dist
RUN npx tsc -p tsconfig.mcp.json

# Verify AIOrchestrator was built
RUN ls -la dist/mcp_server/ai/ || echo "⚠️ AI folder not built"

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

# Expose correct port (matches code default)
EXPOSE 8080

# Start server
CMD ["node", "dist/mcp_server/index.js"]
