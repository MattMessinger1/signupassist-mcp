# Use Node LTS
FROM node:20-alpine

WORKDIR /app

# Faster installs by copying manifests first
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build MCP (TS -> JS in dist/)
RUN npm run mcp:build

# Expose port for local run (Railway sets $PORT)
EXPOSE 4000

# Start in production mode (listens on $PORT internally)
CMD ["npm", "run", "mcp:start"]