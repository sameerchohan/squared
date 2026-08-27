import { sql } from "drizzle-orm";
import { db } from "@/db";

// Load balancer health check. Verifies the database is actually reachable
// rather than just that the process is up, so a task with a broken DB
// connection is replaced instead of silently serving errors.
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ status: "ok" });
  } catch {
    // Deliberately opaque: health checks are unauthenticated.
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
