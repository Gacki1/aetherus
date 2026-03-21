FROM node:22-slim

# Install Chromium for TR login (puppeteer-core uses system Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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
