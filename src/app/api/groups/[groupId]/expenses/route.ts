import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, expenseShares, groupMembers } from "@/db/schema";
import { computeShares } from "@/lib/splits";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";

const createExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  // Defaults to the signed-in user; letting it be set supports "Alice paid
  // but Bob is logging it".
  paidBy: z.uuid().optional(),
  split: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("equal"),
      participants: z.array(z.uuid()).min(1),
    }),
    z.object({
      type: z.literal("exact"),
      shares: z
        .array(
          z.object({
            userId: z.uuid(),
            amountCents: z.number().int().nonnegative(),
          })
        )
        .min(1),
    }),
    z.object({
      type: z.literal("percentage"),
      shares: z
        .array(
          z.object({ userId: z.uuid(), percent: z.number().nonnegative() })
        )
        .min(1),
    }),
  ]),
});

export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/expenses">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const body = createExpenseSchema.parse(await req.json());
    const paidBy = body.paidBy ?? userId;

    // Everyone the money touches must belong to this group.
    const memberRows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    const memberIds = new Set(memberRows.map((m) => m.userId));

    const participantIds =
      body.split.type === "equal"
        ? body.split.participants
        : body.split.shares.map((s) => s.userId);
    for (const id of [paidBy, ...participantIds]) {
      if (!memberIds.has(id)) {
        throw new ApiError(400, "All participants must be group members");
      }
    }

    const shares = computeShares(body.amountCents, body.split);

    const expense = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(expenses)
        .values({
          groupId,
          paidBy,
          description: body.description,
          amountCents: body.amountCents,
          splitType: body.split.type,
        })
        .returning();
      await tx.insert(expenseShares).values(
        shares.map((s) => ({
          expenseId: created.id,
          userId: s.userId,
          owedCents: s.owedCents,
        }))
      );
      return created;
    });

    return Response.json({ expense, shares }, { status: 201 });
  }
);

export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/expenses">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const expenseRows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.createdAt));

    const shareRows =
      expenseRows.length === 0
        ? []
        : await db
            .select()
            .from(expenseShares)
            .where(
              inArray(
                expenseShares.expenseId,
                expenseRows.map((e) => e.id)
              )
            );

    const sharesByExpense = new Map<
      string,
      { userId: string; owedCents: number }[]
    >();
    for (const share of shareRows) {
      const list = sharesByExpense.get(share.expenseId) ?? [];
      list.push({ userId: share.userId, owedCents: share.owedCents });
      sharesByExpense.set(share.expenseId, list);
    }

    return Response.json({
      expenses: expenseRows.map((e) => ({
        ...e,
        shares: sharesByExpense.get(e.id) ?? [],
      })),
    });
  }
);
