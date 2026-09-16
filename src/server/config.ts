/**
 * The app's own public base URL, used to build links that leave the app and
 * come back — Stripe's onboarding and checkout returns, and the password
 * reset link in an email.
 *
 * It is configuration rather than something derived from the request host,
 * because a Host header is attacker-controlled: deriving a password reset
 * link from it would let someone request a reset for another account and
 * have the link point at a server they own.
 */
export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}
