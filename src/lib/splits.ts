// Split calculation: turns an expense amount plus a split specification into
// per-user shares in integer cents that sum exactly to the expense amount.
// No floats ever touch a stored monetary value; rounding happens once, here,
// via largest-remainder apportionment.

export class SplitError extends Error {}

export type SplitSpec =
  | { type: "equal"; participants: string[] }
  | { type: "exact"; shares: { userId: string; amountCents: number }[] }
  | { type: "percentage"; shares: { userId: string; percent: number }[] };

export type Share = { userId: string; owedCents: number };

/**
 * Compute each participant's share of `amountCents` according to `spec`.
 * Guarantees: result sums to exactly `amountCents`, every share >= 0, and
 * the output is deterministic (leftover cents from rounding go to the
 * participants with the largest truncated remainders, ties broken by input
 * order).
 */
export function computeShares(amountCents: number, spec: SplitSpec): Share[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new SplitError("Amount must be a positive integer number of cents");
  }

  switch (spec.type) {
    case "equal": {
      const ids = spec.participants;
      assertNonEmptyDistinct(ids);
      // Equal split is percentage apportionment with equal weights.
      return apportion(
        amountCents,
        ids.map((userId) => ({ userId, weight: 1 }))
      );
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
      return apportion(amountCents, weights);
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
