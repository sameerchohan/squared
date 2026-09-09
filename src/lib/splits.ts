// Split calculation: turns an expense amount plus a split specification into
// per-user shares in integer cents that sum exactly to the expense amount.
// No floats ever touch a stored monetary value; rounding happens once, here,
// via largest-remainder apportionment.

import {
  resolveEqualShares,
  type CoverageGuest,
  type CoverageParticipant,
} from "./coverage-rules";

export class SplitError extends Error {}

/** A participant given as a bare id still means exactly one share. */
export type EqualParticipantSpec = string | CoverageParticipant;

export type SplitSpec =
  | {
      type: "equal";
      participants: EqualParticipantSpec[];
      guests?: CoverageGuest[];
    }
  | { type: "exact"; shares: { userId: string; amountCents: number }[] }
  | { type: "percentage"; shares: { userId: string; percent: number }[] };

export type Share = { userId: string; owedCents: number };

/**
 * A share plus the bookkeeping that lets an equal split be read back and
 * edited later. `shareCount` is how many ways-worth this member is paying for,
 * and `coveredBy` names the member paying instead when they are not.
 */
export type ShareRow = Share & {
  shareCount: number;
  coveredBy: string | null;
};

/**
 * Compute each participant's share of `amountCents` according to `spec`.
 * Guarantees: result sums to exactly `amountCents`, every share >= 0, and
 * the output is deterministic (leftover cents from rounding go to the
 * participants with the largest truncated remainders, ties broken by input
 * order).
 */
export function computeShares(amountCents: number, spec: SplitSpec): Share[] {
  return computeShareRows(amountCents, spec).map(({ userId, owedCents }) => ({
    userId,
    owedCents,
  }));
}

/**
 * As computeShares, but also returning what has to be persisted for an equal
 * split to survive a round trip through the database and back into the edit
 * form. Same arithmetic, one call, so the two views can never disagree.
 */
export function computeShareRows(
  amountCents: number,
  spec: SplitSpec
): ShareRow[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new SplitError("Amount must be a positive integer number of cents");
  }

  switch (spec.type) {
    case "equal": {
      const participants = spec.participants.map((p) =>
        typeof p === "string" ? { userId: p } : p
      );
      assertNonEmptyDistinct(participants.map((p) => p.userId));

      // An equal split is apportionment by head count. Covering only changes
      // whose head is charged to whom, so it stays the same arithmetic with
      // weights that are no longer all 1.
      const resolved = resolveEqualShares(participants, spec.guests ?? []);
      const owed = apportion(
        amountCents,
        resolved.map(({ userId, weight }) => ({ userId, weight }))
      );

      // apportion returns input order, so these line up by index. A covered
      // member has weight 0, and leftover cents only ever land on rows with a
      // non-zero remainder, so they are guaranteed to come back owing 0.
      return resolved.map((r, i) => ({
        userId: r.userId,
        owedCents: owed[i].owedCents,
        shareCount: r.weight,
        coveredBy: r.coveredBy,
      }));
    }

    case "exact": {
      assertNonEmptyDistinct(spec.shares.map((s) => s.userId));
      for (const s of spec.shares) {
        if (!Number.isSafeInteger(s.amountCents) || s.amountCents < 0) {
          throw new SplitError(
            "Exact shares must be non-negative integer cents"
          );
        }
      }
      const total = spec.shares.reduce((sum, s) => sum + s.amountCents, 0);
      if (total !== amountCents) {
        throw new SplitError(
          `Exact shares sum to ${total}, expected ${amountCents}`
        );
      }
      return spec.shares.map((s) => ({
        userId: s.userId,
        owedCents: s.amountCents,
        shareCount: 1,
        coveredBy: null,
      }));
    }

    case "percentage": {
      assertNonEmptyDistinct(spec.shares.map((s) => s.userId));
      // Percentages are accepted with up to 2 decimal places and converted to
      // integer basis points, so the arithmetic below stays in integers.
      const weights = spec.shares.map((s) => {
        const basisPoints = Math.round(s.percent * 100);
        if (
          !Number.isFinite(s.percent) ||
          s.percent < 0 ||
          Math.abs(s.percent * 100 - basisPoints) > 1e-6
        ) {
          throw new SplitError(
            "Percentages must be non-negative with at most 2 decimal places"
          );
        }
        return { userId: s.userId, weight: basisPoints };
      });
      const totalBp = weights.reduce((sum, w) => sum + w.weight, 0);
      if (totalBp !== 100_00) {
        throw new SplitError(
          `Percentages sum to ${totalBp / 100}, expected 100`
        );
      }
      return apportion(amountCents, weights).map((share) => ({
        ...share,
        shareCount: 1,
        coveredBy: null,
      }));
    }
  }
}

/**
 * Largest-remainder apportionment: give each participant
 * floor(amount * weight / totalWeight) cents, then hand the leftover cents —
 * always fewer than the number of participants — to those with the largest
 * truncated remainders, earliest-listed first on ties.
 */
function apportion(
  amountCents: number,
  weights: { userId: string; weight: number }[]
): Share[] {
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    throw new SplitError("At least one share must be greater than zero");
  }

  const shares = weights.map(({ userId, weight }, index) => {
    const exact = amountCents * weight;
    return {
      userId,
      index,
      owedCents: Math.floor(exact / totalWeight),
      remainder: exact % totalWeight,
    };
  });

  let leftover =
    amountCents - shares.reduce((sum, s) => sum + s.owedCents, 0);

  const byRemainder = [...shares].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index
  );
  for (const share of byRemainder) {
    if (leftover === 0) break;
    share.owedCents += 1;
    leftover -= 1;
  }

  return shares
    .sort((a, b) => a.index - b.index)
    .map(({ userId, owedCents }) => ({ userId, owedCents }));
}

function assertNonEmptyDistinct(userIds: string[]): void {
  if (userIds.length === 0) {
    throw new SplitError("A split needs at least one participant");
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new SplitError("A participant appears more than once in the split");
  }
}
