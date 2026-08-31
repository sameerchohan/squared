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
ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1
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

# Migration and seed tooling: drizzle-orm has no runtime dependencies of its
# own, and pg is already traced into the standalone bundle. bcryptjs is not —
# Next bundles it into the compiled server output, so nothing is left in
# node_modules for a standalone script to import. It is dependency-free and
# 140 KB, so copying it costs nothing and keeps the seed task runnable.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --chown=nextjs:nodejs drizzle ./drizzle
COPY --chown=nextjs:nodejs scripts/migrate.mjs ./scripts/migrate.mjs

# Seeding runs as a one-off task against a fresh database, using the same
# task definition as migrations with an overridden command.
COPY --chown=nextjs:nodejs scripts/seed.mjs ./scripts/seed.mjs

USER nextjs
EXPOSE 3000

# Migrations run as a separate one-off task before rollout:
#   docker run --rm <image> node scripts/migrate.mjs
CMD ["node", "server.js"]
