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
  // "cash" records a payment that already happened somewhere Squared cannot
  // observe: Venmo, a bank transfer, notes across a table. It is recorded on
  // the payer's word, which is why it is only offered between people who
  // already share a group.
  method: z.enum(["stripe", "cash"]).default("stripe"),
});

/**
 * Starts a settlement: validates it against balances recomputed inside a
 * transaction, then either opens a Stripe Checkout session that routes funds
 * to the recipient's connected account (destination charge), or, for method
 * "cash", records the transfer as already succeeded.
 *
 * Both paths share the same balance validation, so neither can settle a debt
 * that isn't owed or overpay one that is. They differ only in who confirms
 * the money moved: for Stripe that is the webhook, for cash it is the payer.
 */
export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/settlements">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);
    enforceRateLimit(`settle:${userId}`, 10, 60_000);

    const { toUser, amountCents, method } = createSettlementSchema.parse(
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
      // Cash settlements move no money through Stripe, so the recipient's
      // Connect status is irrelevant to them.
      if (
        method === "stripe" &&
        (recipient.stripeOnboardingStatus !== "active" ||
          !recipient.stripeAccountId)
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
          method,
          // A cash settlement has already happened by the time it is
          // recorded; there is no later event that would promote it.
          status: method === "cash" ? "succeeded" : "pending",
        })
        .returning();

      return { ...created, recipient };
    });

    // Cash is done at commit: the balances both people see already account
    // for it, and there is no third party to call.
    if (method === "cash") {
      return Response.json(
        { settlementId: settlement.id, checkoutUrl: null },
        { status: 201 }
      );
    }

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
        method: settlements.method,
        status: settlements.status,
        createdAt: settlements.createdAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(desc(settlements.createdAt));

    return Response.json({ settlements: rows });
  }
);
