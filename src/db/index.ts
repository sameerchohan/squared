import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// `new Pool()` does not open a connection — sockets are created on first
// query — so this module stays importable without a database. That keeps
// `next build` and CI free of placeholder credentials. A missing or wrong
// DATABASE_URL surfaces through /api/health, which the load balancer uses to
// replace the task and roll a bad deploy back.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // RDS requires TLS. PGSSLMODE=disable opts out for local docker-compose.
  ssl:
    process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// A pool error (an idle connection dropped by RDS, a failover) must not take
// the process down; pg reconnects on the next query.
pool.on("error", (error) => {
  console.error("Postgres pool error:", error.message);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
