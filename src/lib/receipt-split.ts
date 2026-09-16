// Splitting a restaurant bill by what people actually had.
//
// A real bill has three kinds of money on it, and they divide differently:
//
//   1. What one person ordered alone. Theirs.
//   2. What a few people shared: the appetisers, a bottle of wine. Split
//      evenly, but only between the people who were in on it.
//   3. Tax, tip, fees, and anything off the top. Nobody ordered these; they
//      scale with what the group spent, so they belong to each person in
//      proportion to their own share of it. A discount works the same way in
//      reverse: everybody's bill comes down by the same proportion.
//
// Handling only the first kind is what makes most bill-splitting wrong. The
// appetisers get dumped on whoever ordered them, or the whole thing collapses
// to an even split that overcharges the person who had a salad.
//
// Rounding is done in cents throughout and never with floats. Each shared item
// is apportioned to its own sharers first, so "your quarter of the appetisers
// was $9.01" is a real number somebody can point at; then the whole bill is
// apportioned by the subtotals that result. Both stages use the same
// largest-remainder apportionment as an equal split, so the cents always add
// up to the bill exactly and nobody has to absorb a rounding error twice.

import { apportion } from "./splits";

export class ReceiptError extends Error {}

/** What one person ordered for themselves, before tax and tip. */
export type IndividualOrder = { userId: string; subtotalCents: number };

/** Something several people split: an appetiser, a bottle, the table's bread. */
export type SharedItem = {
  /** What it was, so the split can be read back and understood later. */
  label?: string;
  amountCents: number;
  /** Who was in on it. Everyone here pays an equal part. */
  sharedBy: string[];
};

export type ReceiptLine = {
  userId: string;
  /** What they ordered alone. */
  individualCents: number;
  /** Their part of everything shared. */
  sharedCents: number;
  /** The two together: their food, before tax and tip. */
  subtotalCents: number;
  /** What they owe once tax and tip are shared out in proportion. */
  owedCents: number;
};

export type ReceiptBreakdown = {
  lines: ReceiptLine[];
  /** Per shared item, what each sharer's part came to. Same order as input. */
  sharedSplits: { userId: string; cents: number }[][];
  foodCents: number;
  taxCents: number;
  tipCents: number;
  /** Money off the whole bill: a coupon, a comped dish, a group rate. */
  discountCents: number;
  totalCents: number;
};

function assertMoney(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReceiptError(`${what} must be a whole number of cents, or zero`);
  }
}

/**
 * Work out what everybody owes on one bill.
 *
 * Guarantees: the result sums to exactly the bill, every share is a
 * non-negative whole number of cents, and somebody who ordered nothing and
 * shared nothing pays nothing, tip included. Deterministic, so the same bill
 * always divides the same way.
 */
export function splitReceipt(
  individual: IndividualOrder[],
  shared: SharedItem[],
  taxCents: number,
  tipCents: number,
  discountCents = 0
): ReceiptBreakdown {
  assertMoney(taxCents, "Tax");
  assertMoney(tipCents, "Tip");
  assertMoney(discountCents, "Discount");

  const ids = individual.map((o) => o.userId);
  if (new Set(ids).size !== ids.length) {
    throw new ReceiptError("A person appears more than once on this bill");
  }
  const known = new Set(ids);

  const individualCents = new Map<string, number>();
  for (const order of individual) {
    assertMoney(order.subtotalCents, "Every amount");
    individualCents.set(order.userId, order.subtotalCents);
  }

  // Each shared item is divided among its own sharers first. Doing it here,
  // rather than folding it into one big weighting, is what lets the screen
  // show a per-item figure that a person can check against the receipt.
  const sharedCents = new Map<string, number>();
  const sharedSplits: { userId: string; cents: number }[][] = [];

  for (const [index, item] of shared.entries()) {
    assertMoney(item.amountCents, "Every shared amount");

    const sharers = [...new Set(item.sharedBy)];
    for (const userId of sharers) {
      if (!known.has(userId)) {
        throw new ReceiptError(
          "Somebody sharing an item is not on this bill"
        );
      }
    }

    if (item.amountCents === 0) {
      sharedSplits.push([]);
      continue;
    }
    if (sharers.length === 0) {
      throw new ReceiptError(
        item.label
          ? `Choose who shared ${item.label}`
          : "Choose who shared each item"
      );
    }

    // Three people splitting $10 means somebody pays the extra cent. Always
    // handing it to whoever is listed first would quietly tax the same person
    // on every item of the night, so the starting point rotates by item.
    const offset = index % sharers.length;
    const rotated = [...sharers.slice(offset), ...sharers.slice(0, offset)];
    const listedOrder = new Map(sharers.map((userId, at) => [userId, at]));

    const split = apportion(
      item.amountCents,
      rotated.map((userId) => ({ userId, weight: 1 }))
    )
      .map((s) => ({ userId: s.userId, cents: s.owedCents }))
      .sort((a, b) => listedOrder.get(a.userId)! - listedOrder.get(b.userId)!);

    for (const part of split) {
      sharedCents.set(
        part.userId,
        (sharedCents.get(part.userId) ?? 0) + part.cents
      );
    }
    sharedSplits.push(split);
  }

  const subtotals = individual.map((order) => ({
    userId: order.userId,
    individualCents: order.subtotalCents,
    sharedCents: sharedCents.get(order.userId) ?? 0,
    subtotalCents: order.subtotalCents + (sharedCents.get(order.userId) ?? 0),
  }));

  const foodCents = subtotals.reduce((sum, s) => sum + s.subtotalCents, 0);
  if (foodCents === 0) {
    // With nothing ordered there is no proportion to divide tax and tip by,
    // and splitting them evenly would be inventing an answer.
    throw new ReceiptError("Put in what at least one person ordered");
  }

  const totalCents = foodCents + taxCents + tipCents - discountCents;
  if (totalCents <= 0) {
    throw new ReceiptError(
      "The discount is bigger than the bill, so there is nothing to split"
    );
  }
  const owed = new Map(
    apportion(
      totalCents,
      subtotals.map((s) => ({ userId: s.userId, weight: s.subtotalCents }))
    ).map((s) => [s.userId, s.owedCents])
  );

  return {
    lines: subtotals.map((s) => ({
      ...s,
      owedCents: owed.get(s.userId) ?? 0,
    })),
    sharedSplits,
    foodCents,
    taxCents,
    tipCents,
    discountCents,
    totalCents,
  };
}
