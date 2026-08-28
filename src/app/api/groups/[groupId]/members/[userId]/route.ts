import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses, groupMembers, groups, users } from "@/db/schema";
import { formatCents } from "@/lib/format";
import { canRemoveMember } from "@/lib/membership-rules";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";
import { groupNetBalances } from "@/server/group-integrity";

/**
 * Removes a member, or leaves the group when removing yourself.
 *
 * Two guards, both about not destroying history: a member carrying a balance
 * can't be removed, because their debt would vanish along with them; and a
 * member who appears on any expense can't be removed either, since the
 * foreign key from expenses.paid_by would orphan the record.
 */
export const DELETE = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/members/[userId]">) => {
    const actorId = await requireUserId();
    const { groupId, userId } = await ctx.params;
    await requireGroupMember(actorId, groupId);

    const [group] = await db
      .select({ createdBy: groups.createdBy })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group) throw new ApiError(404, "Group not found");

    const leavingSelf = actorId === userId;

    const [membership] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      )
      .limit(1);
    if (!membership) throw new ApiError(404, "That person isn't in this group.");

    const [[{ value: memberCount }], [{ value: paidCount }], net] = await Promise.all([
      db
        .select({ value: count() })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId)),
      db
        .select({ value: count() })
        .from(expenses)
        .where(and(eq(expenses.groupId, groupId), eq(expenses.paidBy, userId))),
      groupNetBalances(groupId),
    ]);

    const balance = net.get(userId) ?? 0;
    const check = canRemoveMember({
      actorId,
      targetId: userId,
      groupCreatedBy: group.createdBy,
      targetNetCents: balance,
      targetPaidExpenseCount: paidCount,
      memberCount,
    });

    if (!check.ok) {
      // The shared rule decides; this only makes the message specific.
      if (balance !== 0) {
        const [person] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const who = leavingSelf ? "You" : (person?.name ?? "That member");
        const verb = leavingSelf
          ? balance > 0
            ? "are owed"
            : "owe"
          : balance > 0
            ? "is owed"
            : "owes";
        throw new ApiError(
          409,
          `${who} ${verb} ${formatCents(Math.abs(balance))} in this group. Settle up first.`
        );
      }
      throw new ApiError(
        check.reason.startsWith("Only the group's creator") ? 403 : 409,
        check.reason
      );
    }

    await db
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      );

    return Response.json({ ok: true, left: leavingSelf });
  }
);
