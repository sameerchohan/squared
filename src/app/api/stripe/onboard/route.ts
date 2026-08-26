import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { appUrl, getStripe } from "@/server/stripe";

/**
 * Starts (or resumes) Stripe Connect onboarding: creates the Express account
 * on first call, then returns a fresh account-link URL. Status transitions
 * are driven by account.updated webhooks, not by this route.
 */
export const POST = apiHandler(async (req) => {
  const userId = await requireUserId();
  enforceRateLimit(`onboard:${clientIp(req)}`, 10, 60_000);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new ApiError(401, "Not signed in");
  }

  const stripe = getStripe();

  let accountId = user.stripeAccountId;
  if (!accountId) {
    // The idempotency key pins account creation to this user, so a double
    // click can't create two Stripe accounts.
    const account = await stripe.accounts.create(
      {
        type: "express",
        email: user.email,
        capabilities: { transfers: { requested: true } },
      },
      { idempotencyKey: `acct-create-${user.id}` }
    );
    accountId = account.id;
    await db
      .update(users)
      .set({ stripeAccountId: accountId, stripeOnboardingStatus: "pending" })
      .where(eq(users.id, user.id));
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl()}/?stripe=refresh`,
    return_url: `${appUrl()}/?stripe=return`,
    type: "account_onboarding",
  });

  return Response.json({ url: link.url });
});
