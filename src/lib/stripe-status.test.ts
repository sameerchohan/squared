import { describe, expect, it } from "vitest";
import { deriveOnboardingStatus } from "./stripe-status";

describe("deriveOnboardingStatus", () => {
  it("is active only when charges and payouts are both enabled", () => {
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
      })
    ).toBe("active");
  });

  it("is pending for a fresh account that has not submitted details", () => {
    // A brand-new account always has outstanding requirements; that must not
    // read as "restricted".
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      })
    ).toBe("pending");
  });

  it("is restricted once details are submitted but capabilities are off", () => {
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: true,
        chargesEnabled: false,
        payoutsEnabled: false,
      })
    ).toBe("restricted");
  });

  it("is restricted when only one capability is enabled", () => {
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: false,
      })
    ).toBe("restricted");
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: true,
        chargesEnabled: false,
        payoutsEnabled: true,
      })
    ).toBe("restricted");
  });

  it("treats a fully enabled account as active even mid-review", () => {
    // Stripe can re-verify (details_submitted stays true); as long as both
    // capabilities remain enabled the user can still receive settlements.
    expect(
      deriveOnboardingStatus({
        detailsSubmitted: false,
        chargesEnabled: true,
        payoutsEnabled: true,
      })
    ).toBe("active");
  });
});
