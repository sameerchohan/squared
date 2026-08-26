import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { deriveOnboardingStatus } from "@/lib/stripe-status";
import { requireUserId } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { getStripe } from "@/server/stripe";

/**
 * Reconciliation: pull the account state from Stripe and update our status.
 * Webhooks are the primary mechanism; this covers missed deliveries and
 * local development without a webhook forwarder.
 */
export const POST = apiHandler(async (req) => {
  const userId = await requireUserId();
  enforceRateLimit(`stripe-sync:${clientIp(req)}`, 10, 60_000);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.stripeAccountId) {
    throw new ApiError(400, "Payment setup hasn't been started");
  }

  const account = await getStripe().accounts.retrieve(user.stripeAccountId);
  const status = deriveOnboardingStatus({
    detailsSubmitted: account.details_submitted ?? false,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  });

  await db
    .update(users)
    .set({ stripeOnboardingStatus: status })
    .where(eq(users.id, user.id));

  return Response.json({ stripeOnboardingStatus: status });
});
