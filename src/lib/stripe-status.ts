import type { OnboardingStatus } from "@/db/schema";

// The subset of a Stripe account that determines onboarding state. Kept as a
// plain shape so the state machine is testable without Stripe types.
export type AccountSnapshot = {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

/**
 * Onboarding state machine: not_started → pending → active/restricted.
 *
 * "not_started" is the absence of a Stripe account and never comes from here —
 * this function is only called once an account exists (created by us, then
 * reported on by account.updated webhooks).
 *
 * - Fully enabled (charges + payouts) → active: may receive settlements.
 * - Details not yet submitted → pending: they're mid-onboarding. A fresh
 *   account always has disabled requirements, so this must be checked before
 *   concluding "restricted".
 * - Submitted but not fully enabled → restricted: Stripe wants more
 *   information or has disabled the account; funds must not be routed there.
 */
export function deriveOnboardingStatus(
  account: AccountSnapshot
): Exclude<OnboardingStatus, "not_started"> {
  if (account.chargesEnabled && account.payoutsEnabled) {
    return "active";
  }
  if (!account.detailsSubmitted) {
    return "pending";
  }
  return "restricted";
}
