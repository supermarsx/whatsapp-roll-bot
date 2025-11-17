# Multi-stage Dockerfile for whatsapp-roll-bot

# Builder stage: install dev deps and compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including dev deps required for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Final runtime stage: install only production deps and copy build output
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy built app from builder
COPY --from=builder /app/dist ./dist

# Create directories for persistent runtime data
RUN mkdir -p /app/data /app/logs /app/auth /app/sessions
VOLUME ["/app/data", "/app/logs", "/app/auth", "/app/sessions"]

# Default working directory and command
WORKDIR /app

# By default run the built bot. Use docker-compose's `command:` or `environment:`
# to pass flags like `--use-pairing-code` or `--qr-only` when necessary.
CMD ["node", "dist/bot.js"]
