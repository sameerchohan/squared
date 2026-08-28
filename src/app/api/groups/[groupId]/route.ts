import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";

export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group) {
      throw new ApiError(404, "Group not found");
    }

    const members = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        stripeOnboardingStatus: users.stripeOnboardingStatus,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);

    return Response.json({ group, members });
  }
);

const renameSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const PATCH = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const [group] = await db
      .select({ createdBy: groups.createdBy })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group) throw new ApiError(404, "Group not found");
    if (group.createdBy !== userId) {
      throw new ApiError(403, "Only the group's creator can rename it.");
    }

    const { name } = renameSchema.parse(await req.json());
    const [updated] = await db
      .update(groups)
      .set({ name })
      .where(eq(groups.id, groupId))
      .returning();

    return Response.json({ group: updated });
  }
);
