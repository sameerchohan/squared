import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";

const addMemberSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
});

export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/members">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const { email } = addMemberSchema.parse(await req.json());

    const [invitee] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!invitee) {
      throw new ApiError(404, "No account exists with that email");
    }

    // Adding someone twice is a no-op, not an error.
    await db
      .insert(groupMembers)
      .values({ groupId, userId: invitee.id })
      .onConflictDoNothing();

    return Response.json({ member: invitee }, { status: 201 });
  }
);
