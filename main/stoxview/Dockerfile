FROM node:22-slim

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (need devDeps for build)
RUN npm ci

# Copy source
COPY . .

# Set API base for Aetherus integration (Caddy proxies /stoxview-api/* -> this container)
ENV VITE_API_BASE=/stoxview-api

# Build frontend + server
RUN npm run build

# Production: only need the built output
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
