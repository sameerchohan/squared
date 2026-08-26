import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, expenseShares, settlements, users } from "@/db/schema";
import { computeNetBalances } from "@/lib/balances";
import { validateSettlement } from "@/lib/settlement-rules";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { appUrl, getStripe } from "@/server/stripe";

const createSettlementSchema = z.object({
  toUser: z.uuid(),
  amountCents: z.number().int().positive().max(99_999_999),
});

/**
 * Starts a settlement: validates it against balances recomputed inside a
 * transaction, records it as pending, then opens a Stripe Checkout session
 * that routes funds to the recipient's connected account (destination
 * charge). The webhook, not this route, marks it succeeded.
 */
export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/settlements">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);
    enforceRateLimit(`settle:${userId}`, 10, 60_000);

    const { toUser, amountCents } = createSettlementSchema.parse(
      await req.json()
    );

    // Everything that decides whether this settlement is allowed happens
    // inside one transaction, serialized per group by an advisory lock, so
    // two concurrent requests can't each validate against the same balance
    // and together overpay a debt.
    const settlement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${groupId}))`
      );

      const [recipient] = await tx
        .select({
          id: users.id,
          name: users.name,
          stripeAccountId: users.stripeAccountId,
          stripeOnboardingStatus: users.stripeOnboardingStatus,
        })
        .from(users)
        .where(eq(users.id, toUser))
        .limit(1);
      if (!recipient) {
        throw new ApiError(404, "That member doesn't exist");
      }
      await requireGroupMember(recipient.id, groupId);

      const shareRows = await tx
        .select({
          paidBy: expenses.paidBy,
          userId: expenseShares.userId,
          owedCents: expenseShares.owedCents,
        })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
        .where(eq(expenses.groupId, groupId));

      const settlementRows = await tx
        .select({
          fromUser: settlements.fromUser,
          toUser: settlements.toUser,
          amountCents: settlements.amountCents,
        })
        .from(settlements)
        .where(
          and(
            eq(settlements.groupId, groupId),
            ne(settlements.status, "failed")
          )
        );

      const net = computeNetBalances(
        shareRows.map((row) => ({
          paidBy: row.paidBy,
          shares: [{ userId: row.userId, owedCents: row.owedCents }],
        })),
        settlementRows
      );

      // Whether the debt exists is asked before whether it can be paid, so a
      // request that isn't owed gets that answer rather than a confusing
      // message about the recipient's payment setup.
      const check = validateSettlement(net, userId, toUser, amountCents);
      if (!check.ok) {
        throw new ApiError(400, check.reason);
      }

      // Hard gate: funds may only be routed to a fully enabled account.
      if (
        recipient.stripeOnboardingStatus !== "active" ||
        !recipient.stripeAccountId
      ) {
        throw new ApiError(
          409,
          `${recipient.name} hasn't finished setting up payments yet, so they can't receive money.`
        );
      }

      const [created] = await tx
        .insert(settlements)
        .values({
          groupId,
          fromUser: userId,
          toUser,
          amountCents,
          status: "pending",
        })
        .returning();

      return { ...created, recipient };
    });

    // Stripe is called outside the transaction: holding a DB transaction open
    // across a network call would pin the advisory lock to a third party's
    // latency.
    let checkoutUrl: string;
    try {
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          // Expire quickly so an abandoned checkout releases the debt back
          // into the group's balances instead of holding it for a day.
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          client_reference_id: settlement.id,
          metadata: { settlementId: settlement.id, groupId },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: settlement.amountCents,
                product_data: { name: `Settle up with ${settlement.recipient.name}` },
              },
            },
          ],
          payment_intent_data: {
            // Destination charge: Squared takes the payment, Stripe routes
            // the funds to the recipient's connected account.
            //
            // No application_fee_amount is set, so the recipient receives the
            // full amount and the platform absorbs Stripe's processing fee
            // (~2.9% + 30¢). That is deliberate for a portfolio demo. Running
            // this for real needs one of: an application fee covering the
            // processing cost, a surcharge added to what the payer owes, or
            // `on_behalf_of` so the connected account bears the fee.
            transfer_data: { destination: settlement.recipient.stripeAccountId! },
          },
          success_url: `${appUrl()}/groups/${groupId}?settled=1`,
          cancel_url: `${appUrl()}/groups/${groupId}?canceled=1`,
        },
        // Retrying this request can never create a second charge.
        { idempotencyKey: `settlement-${settlement.id}` }
      );

      await db
        .update(settlements)
        .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
        .where(eq(settlements.id, settlement.id));

      checkoutUrl = session.url ?? "";
    } catch (error) {
      // Release the debt immediately rather than leaving a pending
      // settlement that no webhook will ever resolve.
      await db
        .update(settlements)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(settlements.id, settlement.id));
      throw error;
    }

    return Response.json(
      { settlementId: settlement.id, checkoutUrl },
      { status: 201 }
    );
  }
);

export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/settlements">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const rows = await db
      .select({
        id: settlements.id,
        fromUser: settlements.fromUser,
        toUser: settlements.toUser,
        amountCents: settlements.amountCents,
        status: settlements.status,
        createdAt: settlements.createdAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(desc(settlements.createdAt));

    return Response.json({ settlements: rows });
  }
);
