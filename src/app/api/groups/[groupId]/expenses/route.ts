import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  expenseGuestShares,
  expenses,
  expenseShares,
  groupGuests,
} from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { resolveSplit, splitSchema } from "@/server/expense-split";

const createExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  // Same ceiling the edit route enforces, so an expense cannot be created
  // in a shape it could never be corrected into.
  amountCents: z.number().int().positive().max(99_999_999),
  // Defaults to the signed-in user; letting it be set supports "Alice paid
  // but Bob is logging it".
  paidBy: z.uuid().optional(),
  split: splitSchema,
});

export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/expenses">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const body = createExpenseSchema.parse(await req.json());
    const paidBy = body.paidBy ?? userId;

    const { shares, guests, splitType, amountCents, itemization } =
      await resolveSplit(
      groupId,
      paidBy,
      body.amountCents,
      body.split
    );
    // An itemised bill adds itself up on the server, so what the browser
    // thought the total was never gets stored.
    const total = amountCents ?? body.amountCents;

    const expense = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(expenses)
        .values({
          groupId,
          paidBy,
          description: body.description,
          amountCents: total,
          splitType,
          itemization,
        })
        .returning();
      await tx.insert(expenseShares).values(
        shares.map((s) => ({
          expenseId: created.id,
          userId: s.userId,
          owedCents: s.owedCents,
          shareCount: s.shareCount,
          coveredBy: s.coveredBy,
        }))
      );
      if (guests.length > 0) {
        await tx.insert(expenseGuestShares).values(
          guests.map((g) => ({
            expenseId: created.id,
            guestId: g.guestId,
            sponsorUserId: g.sponsorUserId,
          }))
        );
      }
      return created;
    });

    return Response.json({ expense, shares, guests }, { status: 201 });
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

    const expenseIds = expenseRows.map((e) => e.id);

    const shareRows =
      expenseIds.length === 0
        ? []
        : await db
            .select()
            .from(expenseShares)
            .where(inArray(expenseShares.expenseId, expenseIds));

    // Guest names are joined in rather than stored on the share, so renaming a
    // guest fixes every expense they appear in at once.
    const guestRows =
      expenseIds.length === 0
        ? []
        : await db
            .select({
              expenseId: expenseGuestShares.expenseId,
              guestId: expenseGuestShares.guestId,
              sponsorUserId: expenseGuestShares.sponsorUserId,
              name: groupGuests.name,
            })
            .from(expenseGuestShares)
            .innerJoin(
              groupGuests,
              eq(groupGuests.id, expenseGuestShares.guestId)
            )
            .where(inArray(expenseGuestShares.expenseId, expenseIds));

    const sharesByExpense = new Map<
      string,
      {
        userId: string;
        owedCents: number;
        shareCount: number;
        coveredBy: string | null;
      }[]
    >();
    for (const share of shareRows) {
      const list = sharesByExpense.get(share.expenseId) ?? [];
      list.push({
        userId: share.userId,
        owedCents: share.owedCents,
        shareCount: share.shareCount,
        coveredBy: share.coveredBy,
      });
      sharesByExpense.set(share.expenseId, list);
    }

    const guestsByExpense = new Map<
      string,
      { guestId: string; name: string; sponsorUserId: string }[]
    >();
    for (const guest of guestRows) {
      const list = guestsByExpense.get(guest.expenseId) ?? [];
      list.push({
        guestId: guest.guestId,
        name: guest.name,
        sponsorUserId: guest.sponsorUserId,
      });
      guestsByExpense.set(guest.expenseId, list);
    }

    return Response.json({
      expenses: expenseRows.map((e) => ({
        ...e,
        shares: sharesByExpense.get(e.id) ?? [],
        guests: guestsByExpense.get(e.id) ?? [],
      })),
    });
  }
);
