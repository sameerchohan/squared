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

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(503, "Stripe webhooks are not configured");
  }
  return secret;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}
