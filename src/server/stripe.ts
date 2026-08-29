import Stripe from "stripe";
import { ApiError } from "./errors";

let client: Stripe | null = null;

/**
 * Lazily constructed so the app boots (and builds) without Stripe configured;
 * routes that need Stripe fail with an explicit 503 instead of a crash.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new ApiError(503, "Stripe is not configured on this server");
  }
  client ??= new Stripe(key);
  return client;
}

/**
 * Stripe delivers events about connected accounts (account.updated) through a
 * Connect endpoint, and events about the platform's own charges
 * (checkout.session.*) through a regular one. Two endpoints means two signing
 * secrets, so this accepts a comma-separated list and the verifier tries each.
 *
 * The local `stripe listen` forwarder issues a single secret covering both,
 * which is why one value is also valid.
 */
export function getWebhookSecrets(): string[] {
  const raw = process.env.STRIPE_WEBHOOK_SECRET;
  const secrets = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (secrets.length === 0) {
    throw new ApiError(503, "Stripe webhooks are not configured");
  }
  return secrets;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}
