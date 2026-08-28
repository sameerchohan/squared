import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { expenses, expenseShares, settlements } from "@/db/schema";
import { computeNetBalances } from "@/lib/balances";

/**
 * The net position of every member of a group, computed the same way the
 * balances endpoint computes it. Removing someone mid-debt would silently
 * destroy the record of what they owe, so membership changes are gated on
 * this rather than on trust.
 */
export async function groupNetBalances(groupId: string) {
  const shareRows = await db
    .select({
      paidBy: expenses.paidBy,
      userId: expenseShares.userId,
      owedCents: expenseShares.owedCents,
    })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
    .where(eq(expenses.groupId, groupId));

  const settlementRows = await db
    .select({
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      amountCents: settlements.amountCents,
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), ne(settlements.status, "failed")));

  return computeNetBalances(
    shareRows.map((row) => ({
      paidBy: row.paidBy,
      shares: [{ userId: row.userId, owedCents: row.owedCents }],
    })),
    settlementRows
  );
}
