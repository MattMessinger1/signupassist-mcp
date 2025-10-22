# Use Node LTS
FROM node:20-alpine

WORKDIR /app

# Install TypeScript globally for build step
RUN npm install -g typescript tsx

# Copy production package.json for minimal dependencies
COPY package.production.json package.json
COPY package-lock.json ./

# Fast, deterministic production install
RUN npm ci --production

# Install TypeScript as dev dependency for build
RUN npm install --save-dev typescript @types/node

# Copy source files
COPY mcp_server ./mcp_server
COPY mcp ./mcp
COPY tsconfig.mcp.json ./

# Build TypeScript to dist/
RUN npx tsc -p tsconfig.mcp.json

# Expose port for local run (Railway sets $PORT)
EXPOSE 4000

# Start in production mode (listens on $PORT internally)
CMD ["npm", "run", "mcp:start"]