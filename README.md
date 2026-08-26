# Squared

Expense splitting with real money movement. Users form groups, log shared expenses (equal, exact-amount, or percentage splits), and settle net balances through actual Stripe Connect transfers — not a "mark as paid" checkbox.

> Work in progress. Full architecture writeup coming once the settlement flow lands.

## Stack

Next.js (App Router) + TypeScript · Tailwind · PostgreSQL + Drizzle ORM · Stripe Connect · Vitest · AWS (RDS, ECS/Fargate)

## Run locally

```bash
cp .env.example .env    # fill in JWT_SECRET and Stripe test keys
docker compose up -d    # local Postgres 16
npm install
npm run db:migrate      # apply SQL migrations from drizzle/
npm run dev
```

```bash
npm test                # Vitest
npm run db:generate     # regenerate migrations after editing src/db/schema.ts
```
