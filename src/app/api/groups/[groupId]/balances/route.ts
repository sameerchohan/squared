import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  expenseShares,
  groupMembers,
  settlements,
  users,
} from "@/db/schema";
import { computeNetBalances, simplifyDebts } from "@/lib/balances";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler } from "@/server/errors";

export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/balances">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const shareRows = await db
      .select({
        paidBy: expenses.paidBy,
        userId: expenseShares.userId,
        owedCents: expenseShares.owedCents,
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(eq(expenses.groupId, groupId));

    // Pending and processing settlements count too: money already on its way
    // must not be requested twice. Only failed ones put the debt back.
    const settlementRows = await db
      .select({
        fromUser: settlements.fromUser,
        toUser: settlements.toUser,
        amountCents: settlements.amountCents,
      })
      .from(settlements)
      .where(
        and(eq(settlements.groupId, groupId), ne(settlements.status, "failed"))
      );

    // computeNetBalances only needs (payer, sharer, cents) triples, so each
    // share row can stand alone as a one-share expense.
    const net = computeNetBalances(
      shareRows.map((row) => ({
        paidBy: row.paidBy,
        shares: [{ userId: row.userId, owedCents: row.owedCents }],
      })),
      settlementRows
    );
    const suggestedTransfers = simplifyDebts(net);

    const members = await db
      .select({ id: users.id, name: users.name })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);

    return Response.json({
      balances: members.map((m) => ({
        userId: m.id,
        name: m.name,
        netCents: net.get(m.id) ?? 0,
      })),
      suggestedTransfers,
    });
  }
);
