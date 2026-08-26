import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { settlements, stripeEvents, users } from "@/db/schema";
import { deriveOnboardingStatus } from "@/lib/stripe-status";
import {
  processEventOnce,
  type IdempotencyDeps,
} from "@/lib/webhook-idempotency";

// Real-database implementation of the idempotency contract: the ledger
// insert and every handler side effect share one transaction, so a failed
// handler rolls the ledger row back and Stripe's retry reprocesses cleanly.
const dbIdempotency: IdempotencyDeps<DbTransaction> = {
  withTransaction: (fn) => db.transaction(fn),
  async recordEventOnce(tx, event) {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    return inserted.length > 0;
  },
};

/** Returns "processed" or "duplicate"; throws to make Stripe retry. */
export function handleStripeEvent(event: Stripe.Event) {
  return processEventOnce(dbIdempotency, event, async (tx) => {
    switch (event.type) {
      case "account.updated":
        await onAccountUpdated(tx, event.data.object);
        break;
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await onCheckoutCompleted(tx, event.data.object);
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await onCheckoutFailed(tx, event.data.object);
        break;
      default:
        // Unhandled types are still recorded so redelivery stays cheap.
        break;
    }
  });
}

async function onAccountUpdated(tx: DbTransaction, account: Stripe.Account) {
  await tx
    .update(users)
    .set({
      stripeOnboardingStatus: deriveOnboardingStatus({
        detailsSubmitted: account.details_submitted ?? false,
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
      }),
    })
    .where(eq(users.stripeAccountId, account.id));
}

async function onCheckoutCompleted(
  tx: DbTransaction,
  session: Stripe.Checkout.Session
) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  await tx
    .update(settlements)
    .set({
      // Card payments arrive already paid; delayed methods (e.g. ACH) come
      // through as unpaid first and flip on async_payment_succeeded.
      status: session.payment_status === "paid" ? "succeeded" : "processing",
      stripePaymentIntentId: paymentIntentId,
      updatedAt: new Date(),
    })
    .where(eq(settlements.stripeCheckoutSessionId, session.id));
}

async function onCheckoutFailed(
  tx: DbTransaction,
  session: Stripe.Checkout.Session
) {
  // Marking failed puts the debt back into the group's balances, since
  // balance queries exclude failed settlements.
  await tx
    .update(settlements)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(settlements.stripeCheckoutSessionId, session.id));
}
