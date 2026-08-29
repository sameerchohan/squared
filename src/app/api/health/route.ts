import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Load balancer health check. Verifies the database is actually reachable
 * rather than merely that the process is up, so a task with a broken
 * connection is replaced instead of silently serving errors.
 *
 * The reason is coarse on purpose. "not_configured" versus "unreachable" is
 * the difference between a deploy that was never given its environment and
 * one whose database is down — worth hours during a rollout — while neither
 * discloses a hostname, a credential, or a driver error to an unauthenticated
 * caller. The underlying error is logged, never returned.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    console.error("Health check: DATABASE_URL is not set");
    return Response.json(
      { status: "unhealthy", reason: "not_configured" },
      { status: 503 }
    );
  }

  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error(
      "Health check: database unreachable —",
      error instanceof Error ? error.message : error
    );
    return Response.json(
      { status: "unhealthy", reason: "unreachable" },
      { status: 503 }
    );
  }
}
