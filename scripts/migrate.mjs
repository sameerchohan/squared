// Standalone migration runner, executed as a one-off ECS task before a new
// app revision rolls out. Kept separate from the server so a deploy fails
// loudly on a bad migration instead of every task racing to apply it at boot.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  // RDS requires TLS; the bundled CA set validates it. Set
  // PGSSLMODE=disable for local docker-compose.
  ssl:
    process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
});

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
