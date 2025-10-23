# Use Node LTS
FROM node:20-alpine

WORKDIR /app

# Copy production package.json with build dependencies
COPY package.production.json package.json
COPY package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configs
COPY tsconfig.json ./
COPY tsconfig.mcp.json ./

# Copy source files
COPY mcp_server ./mcp_server
COPY mcp ./mcp

# Build TypeScript to dist/
RUN npx tsc -p tsconfig.mcp.json

# Remove devDependencies after build to keep image small
RUN npm prune --production

# Expose port for local run (Railway sets $PORT)
EXPOSE 4000

# Start in production mode (listens on $PORT internally)
CMD ["npm", "run", "mcp:start"]