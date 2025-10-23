FROM node:20-alpine
WORKDIR /app

# Railway builds dist/ before Docker, just copy everything
COPY package.production.json package.json
COPY package-lock.json ./
RUN npm ci --production

COPY dist ./dist
COPY mcp ./mcp

EXPOSE 4000
CMD ["npm", "run", "mcp:start"]