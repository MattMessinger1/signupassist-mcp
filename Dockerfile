# ============= BUILD STAGE =============
FROM node:20-alpine AS builder

WORKDIR /app

# Skip Playwright browser downloads to speed up build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

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

# Build backend TypeScript to dist/
RUN npx tsc -p tsconfig.mcp.json

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