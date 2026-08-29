import type Stripe from "stripe";
import { apiHandler } from "@/server/errors";
import { getStripe, getWebhookSecrets } from "@/server/stripe";
import { handleStripeEvent } from "@/server/webhooks";

// No session auth here — authenticity comes from the Stripe signature over
// the raw body. Never parse the JSON before verifying it.
export const POST = apiHandler(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  // Verified against each configured secret; the event is accepted only if
  // one of them produces a valid signature. Failing every secret is
  // indistinguishable from a forgery, and is answered the same way.
  let event: Stripe.Event | null = null;
  for (const secret of getWebhookSecrets()) {
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
      break;
    } catch {
      // Try the next secret.
    }
  }

  if (!event) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Throws propagate to a 500 so Stripe retries with backoff; the failed
  // attempt's transaction rolled back, so the retry will actually process.
  const outcome = await handleStripeEvent(event);
  return Response.json({ received: true, outcome });
});
