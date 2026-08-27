# syntax=docker/dockerfile:1

# ---- deps: install with the lockfile, cached until package files change ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the Next.js standalone server ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No database or secrets are needed to build: src/db/index.ts constructs its
# pool lazily, so nothing connects at import time.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: only the traced server output and migration tooling ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user; a container escape shouldn't start as root.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# The standalone bundle carries its own traced node_modules (pg included).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migration tooling: drizzle-orm has no runtime dependencies of its own, and
# pg is already traced into the standalone bundle, so this is all the
# migration task needs.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --chown=nextjs:nodejs drizzle ./drizzle
COPY --chown=nextjs:nodejs scripts/migrate.mjs ./scripts/migrate.mjs

USER nextjs
EXPOSE 3000

# Migrations run as a separate one-off task before rollout:
#   docker run --rm <image> node scripts/migrate.mjs
CMD ["node", "server.js"]
