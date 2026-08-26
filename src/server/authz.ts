import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import { ApiError } from "./errors";

/**
 * Every group-scoped route goes through this: a user can only see or act on
 * a group they belong to. Non-members get a 404 rather than a 403 so the
 * existence of other people's groups isn't leaked.
 */
export async function requireGroupMember(
  userId: string,
  groupId: string
): Promise<void> {
  const [membership] = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
    )
    .limit(1);

  if (!membership) {
    throw new ApiError(404, "Group not found");
  }
}
