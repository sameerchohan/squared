import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseGuestShares, expenses, expenseShares, groups } from "@/db/schema";
import { canModifyExpense } from "@/lib/expense-rules";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";
import { resolveSplit, splitSchema } from "@/server/expense-split";

const updateSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(99_999_999),
  paidBy: z.uuid(),
  split: splitSchema,
});

/**
 * Loads an expense the caller is allowed to change. The permission rule
 * itself lives in canModifyExpense so it is unit-testable and so the UI can
 * apply exactly the same test when deciding which rows get edit controls.
 *
 * The group is joined rather than fetched separately: the owner check needs
 * groups.created_by, and one query keeps the authorization decision from
 * being made against two reads that could disagree.
 */
async function loadEditableExpense(
  userId: string,
  groupId: string,
  expenseId: string
) {
  await requireGroupMember(userId, groupId);

  const [row] = await db
    .select({ expense: expenses, groupCreatedBy: groups.createdBy })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!row) {
    throw new ApiError(404, "Expense not found");
  }

  const allowed = canModifyExpense({
    actorId: userId,
    expensePaidBy: row.expense.paidBy,
    groupCreatedBy: row.groupCreatedBy,
  });
  if (!allowed.ok) {
    throw new ApiError(403, allowed.reason);
  }
  return row.expense;
}

export const PATCH = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/expenses/[expenseId]">) => {
    const userId = await requireUserId();
    const { groupId, expenseId } = await ctx.params;
    await loadEditableExpense(userId, groupId, expenseId);

    const body = updateSchema.parse(await req.json());

    const { shares, guests, splitType, amountCents, itemization } =
      await resolveSplit(
      groupId,
      body.paidBy,
      body.amountCents,
      body.split
    );
    const total = amountCents ?? body.amountCents;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(expenses)
        .set({
          description: body.description,
          amountCents: total,
          paidBy: body.paidBy,
          splitType,
          // Cleared when an expense stops being itemised, so a stale breakdown
          // can never be reopened against amounts that have since changed.
          itemization: itemization ?? null,
        })
        .where(eq(expenses.id, expenseId))
        .returning();

      // Shares are replaced wholesale rather than diffed: the split type may
      // have changed entirely, and a stale row would silently skew balances.
      await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
      await tx.insert(expenseShares).values(
        shares.map((s) => ({
          expenseId,
          userId: s.userId,
          owedCents: s.owedCents,
          shareCount: s.shareCount,
          coveredBy: s.coveredBy,
        }))
      );

      // Guests go the same way: who was counted can change with the split, and
      // a leftover row would keep charging a sponsor for someone who left.
      await tx
        .delete(expenseGuestShares)
        .where(eq(expenseGuestShares.expenseId, expenseId));
      if (guests.length > 0) {
        await tx.insert(expenseGuestShares).values(
          guests.map((g) => ({
            expenseId,
            guestId: g.guestId,
            sponsorUserId: g.sponsorUserId,
          }))
        );
      }
      return row;
    });

    return Response.json({ expense: updated, shares, guests });
  }
);

export const DELETE = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/expenses/[expenseId]">) => {
    const userId = await requireUserId();
    const { groupId, expenseId } = await ctx.params;
    await loadEditableExpense(userId, groupId, expenseId);

    // expense_shares cascades from the expense, so balances recompute on the
    // next read with no orphaned rows left behind.
    await db.delete(expenses).where(eq(expenses.id, expenseId));

    return Response.json({ ok: true });
  }
);
