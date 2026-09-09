// Who pays for whom in an equal split.
//
// An equal split is not always one share per head. Someone may be covering a
// partner who never joined Squared, or covering a member who did. Both are the
// same idea: a share belongs to a person, but the money for it comes off
// somebody else's row.
//
// This module turns "who is in, and who is covering whom" into a weight per
// member. Everything downstream is unchanged by it: the weights go through the
// same largest-remainder apportionment an equal split already used, guests
// never hold a balance of their own, and so the balance engine, debt
// simplification and Stripe payouts only ever see a sponsor who owes more.

export class CoverageError extends Error {}

/** Nobody sensibly pays for twenty heads at once; past that it is a typo. */
export const MAX_SHARES_PER_PERSON = 20;

export type CoverageParticipant = {
  userId: string;
  /**
   * How many shares this member pays on their own account, not counting named
   * guests or members they cover. Defaults to 1. Two means they are covering
   * one more person than themselves without naming them. Zero means they are
   * in the expense only to pay for somebody else: the partner who skipped the
   * museum but is still footing the bill for whoever went.
   */
  shares?: number;
  /** Another participating member who pays this member's share instead. */
  coveredBy?: string;
};

/** A guest counted in this expense. Guests have no account and no balance. */
export type CoverageGuest = {
  guestId: string;
  sponsorUserId: string;
};

export type ResolvedShare = {
  userId: string;
  /** Shares of the split this member pays for. Zero when someone covers them. */
  weight: number;
  coveredBy: string | null;
};

/**
 * Resolve participants and guests into one weight per member, in input order.
 *
 * The total of the returned weights is the number of ways the expense divides,
 * which is the number people actually count on their fingers: one per member
 * paying their own way, one per guest, one per member being covered. Whether a
 * head belongs to a member or a guest never changes the denominator, only
 * whose row the money lands on.
 *
 * Throws CoverageError on anything that would silently produce a wrong split.
 */
export function resolveEqualShares(
  participants: CoverageParticipant[],
  guests: CoverageGuest[] = []
): ResolvedShare[] {
  if (participants.length === 0) {
    throw new CoverageError("A split needs at least one participant");
  }

  const ids = participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) {
    throw new CoverageError("A participant appears more than once in the split");
  }
  const participating = new Set(ids);

  const covered = new Set(
    participants.filter((p) => p.coveredBy != null).map((p) => p.userId)
  );

  const weights = new Map<string, number>();

  for (const p of participants) {
    const own = p.shares ?? 1;
    if (!Number.isSafeInteger(own) || own < 0) {
      throw new CoverageError("Shares must be a whole number, zero or more");
    }
    if (own > MAX_SHARES_PER_PERSON) {
      throw new CoverageError(
        `One person cannot pay for more than ${MAX_SHARES_PER_PERSON} shares`
      );
    }

    if (p.coveredBy == null) {
      weights.set(p.userId, own);
      continue;
    }

    // A covered member pays nothing, so anything that would have them paying
    // is a contradiction rather than something to reconcile.
    if (p.shares != null && p.shares !== 0) {
      throw new CoverageError(
        "Someone whose share is covered cannot also pay for shares"
      );
    }
    if (p.coveredBy === p.userId) {
      throw new CoverageError("Someone cannot cover their own share");
    }
    if (!participating.has(p.coveredBy)) {
      throw new CoverageError(
        "Whoever covers a share must be part of this expense"
      );
    }
    // One hop only. Chains are the shape a cycle arrives in, and "A covers B
    // covers C" has no meaning a person would agree with anyway.
    if (covered.has(p.coveredBy)) {
      throw new CoverageError(
        "Someone whose own share is covered cannot cover another person"
      );
    }
    weights.set(p.userId, 0);
  }

  // A covered member's share moves to whoever covers them. The head still
  // counts, so the denominator does not move.
  for (const p of participants) {
    if (p.coveredBy == null) continue;
    weights.set(p.coveredBy, (weights.get(p.coveredBy) ?? 0) + 1);
  }

  const seenGuests = new Set<string>();
  for (const guest of guests) {
    if (seenGuests.has(guest.guestId)) {
      throw new CoverageError("A guest appears more than once in the split");
    }
    seenGuests.add(guest.guestId);

    // The sponsor has to appear in the split, but not necessarily as somebody
    // eating: a member listed with zero shares of their own is exactly how
    // "Ali skipped the museum but is still paying for Sara" is expressed.
    if (!participating.has(guest.sponsorUserId)) {
      throw new CoverageError(
        "Whoever covers a guest must be listed in this expense"
      );
    }
    if (covered.has(guest.sponsorUserId)) {
      throw new CoverageError(
        "Someone whose own share is covered cannot cover a guest"
      );
    }
    weights.set(
      guest.sponsorUserId,
      (weights.get(guest.sponsorUserId) ?? 0) + 1
    );
  }

  const resolved = participants.map((p) => ({
    userId: p.userId,
    weight: weights.get(p.userId) ?? 0,
    coveredBy: p.coveredBy ?? null,
  }));

  if (resolved.every((r) => r.weight === 0)) {
    throw new CoverageError("Somebody has to be paying for this");
  }

  return resolved;
}

/** How many ways the expense divides. The number shown as "split N ways". */
export function totalShares(resolved: ResolvedShare[]): number {
  return resolved.reduce((sum, r) => sum + r.weight, 0);
}
