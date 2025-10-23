# ============= BUILD STAGE =============
FROM node:20-alpine AS builder

WORKDIR /app

# Copy all package files
COPY package.production.json package.json
COPY package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configs and source
COPY tsconfig.json tsconfig.mcp.json ./
COPY mcp_server ./mcp_server
COPY mcp ./mcp

# Build TypeScript to dist/
RUN npx tsc -p tsconfig.mcp.json

# ============= RUNTIME STAGE =============
FROM node:20-alpine

WORKDIR /app

# Copy production package.json
COPY package.production.json package.json
COPY package-lock.json ./

# Install ONLY production dependencies (fast, no playwright/typescript)
RUN npm ci --production

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist
COPY mcp ./mcp

# Expose port
EXPOSE 4000

# Start server
CMD ["npm", "run", "mcp:start"]