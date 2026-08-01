# --- VK AI Labs Insurance Provider API ---
# Multi-stage build: install deps + generate Prisma client, then a lean runtime.

# 1) Dependencies + Prisma client generation
FROM node:20-alpine AS deps
WORKDIR /app
# OpenSSL is needed so Prisma detects the correct engine target (openssl-3.0.x).
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# 2) Runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma needs OpenSSL at runtime on Alpine.
RUN apk add --no-cache openssl

# Bring in installed node_modules (incl. generated Prisma client) and app source.
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 4100

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
