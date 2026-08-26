import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";

export const GET = apiHandler(async () => {
  const userId = await requireUserId();

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      stripeOnboardingStatus: users.stripeOnboardingStatus,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    // Valid token for a user that no longer exists.
    throw new ApiError(401, "Not signed in");
  }
  return Response.json({ user });
});
