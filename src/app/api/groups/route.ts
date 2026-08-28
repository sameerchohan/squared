import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  expenses,
  expenseShares,
  groupMembers,
  groups,
  settlements,
} from "@/db/schema";
import { computeNetBalances } from "@/lib/balances";
import { requireUserId } from "@/server/auth";
import { apiHandler } from "@/server/errors";

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const POST = apiHandler(async (req) => {
  const userId = await requireUserId();
  const { name } = createGroupSchema.parse(await req.json());

  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groups)
      .values({ name, createdBy: userId })
      .returning();
    await tx.insert(groupMembers).values({ groupId: created.id, userId });
    return created;
  });

  return Response.json({ group }, { status: 201 });
});

export const GET = apiHandler(async () => {
  const userId = await requireUserId();

  const myGroupIds = db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));

  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      memberCount: sql<number>`count(*)::int`,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(inArray(groups.id, myGroupIds))
    .groupBy(groups.id)
    .orderBy(groups.createdAt);

  if (rows.length === 0) {
    return Response.json({ groups: [] });
  }

  // The caller's net position in each group. Fetched in two queries for all
  // groups at once rather than per group, then run through the same pure
  // balance function the group page uses, so a total can never disagree with
  // the detail it summarises.
  const groupIds = rows.map((g) => g.id);

  const shareRows = await db
    .select({
      groupId: expenses.groupId,
      paidBy: expenses.paidBy,
      userId: expenseShares.userId,
      owedCents: expenseShares.owedCents,
    })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
    .where(inArray(expenses.groupId, groupIds));

  const settlementRows = await db
    .select({
      groupId: settlements.groupId,
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      amountCents: settlements.amountCents,
    })
    .from(settlements)
    .where(
      and(
        inArray(settlements.groupId, groupIds),
        ne(settlements.status, "failed")
      )
    );

  const netByGroup = new Map<string, number>();
  for (const groupId of groupIds) {
    const net = computeNetBalances(
      shareRows
        .filter((r) => r.groupId === groupId)
        .map((r) => ({
          paidBy: r.paidBy,
          shares: [{ userId: r.userId, owedCents: r.owedCents }],
        })),
      settlementRows.filter((s) => s.groupId === groupId)
    );
    netByGroup.set(groupId, net.get(userId) ?? 0);
  }

  return Response.json({
    groups: rows.map((g) => ({ ...g, netCents: netByGroup.get(g.id) ?? 0 })),
  });
});
