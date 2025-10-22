# Use Node LTS
FROM node:20-alpine

WORKDIR /app

# Copy production package.json for minimal dependencies
COPY package.production.json package.json
COPY package-lock.json ./

# Fast, deterministic production install
RUN npm ci --production

# Copy pre-built dist folder (build locally before deploy)
COPY dist ./dist
COPY mcp ./mcp

# Expose port for local run (Railway sets $PORT)
EXPOSE 4000

# Start in production mode (listens on $PORT internally)
CMD ["npm", "run", "mcp:start"]