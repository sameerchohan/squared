import { describe, expect, it } from "vitest";
import { computeShares, SplitError, type SplitSpec } from "./splits";

const sum = (shares: { owedCents: number }[]) =>
  shares.reduce((total, s) => total + s.owedCents, 0);

describe("computeShares — equal", () => {
  it("splits an evenly divisible amount equally", () => {
    const shares = computeShares(3000, {
      type: "equal",
      participants: ["a", "b", "c"],
    });
    expect(shares).toEqual([
      { userId: "a", owedCents: 1000 },
      { userId: "b", owedCents: 1000 },
      { userId: "c", owedCents: 1000 },
    ]);
  });

  it("distributes leftover cents so the total is exact", () => {
    // $1.00 across 3 people: someone has to pay the extra cent.
    const shares = computeShares(100, {
      type: "equal",
      participants: ["a", "b", "c"],
    });
    expect(sum(shares)).toBe(100);
    expect(shares.map((s) => s.owedCents).sort()).toEqual([33, 33, 34]);
  });

  it("is deterministic about who absorbs leftover cents", () => {
    const spec: SplitSpec = { type: "equal", participants: ["a", "b", "c"] };
    expect(computeShares(101, spec)).toEqual(computeShares(101, spec));
    // 101/3 = 33.67: two participants pay 34, earliest-listed first.
    expect(computeShares(101, spec)).toEqual([
      { userId: "a", owedCents: 34 },
      { userId: "b", owedCents: 34 },
      { userId: "c", owedCents: 33 },
    ]);
  });

  it("handles a single participant", () => {
    expect(
      computeShares(999, { type: "equal", participants: ["solo"] })
    ).toEqual([{ userId: "solo", owedCents: 999 }]);
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      computeShares(100, { type: "equal", participants: ["a", "a"] })
    ).toThrow(SplitError);
  });

  it("rejects an empty participant list", () => {
    expect(() =>
      computeShares(100, { type: "equal", participants: [] })
    ).toThrow(SplitError);
  });
});

describe("computeShares — exact", () => {
  it("uses the given amounts verbatim when they sum correctly", () => {
    const shares = computeShares(2500, {
      type: "exact",
      shares: [
        { userId: "a", amountCents: 2000 },
        { userId: "b", amountCents: 500 },
      ],
    });
    expect(shares).toEqual([
      { userId: "a", owedCents: 2000 },
      { userId: "b", owedCents: 500 },
    ]);
  });

  it("allows a zero share", () => {
    const shares = computeShares(500, {
      type: "exact",
      shares: [
        { userId: "a", amountCents: 500 },
        { userId: "b", amountCents: 0 },
      ],
    });
    expect(sum(shares)).toBe(500);
  });

  it("rejects shares that do not sum to the amount", () => {
    expect(() =>
      computeShares(1000, {
        type: "exact",
        shares: [
          { userId: "a", amountCents: 300 },
          { userId: "b", amountCents: 300 },
        ],
      })
    ).toThrow(/sum to 600, expected 1000/);
  });

  it("rejects negative and non-integer shares", () => {
    expect(() =>
      computeShares(100, {
        type: "exact",
        shares: [
          { userId: "a", amountCents: 200 },
          { userId: "b", amountCents: -100 },
        ],
      })
    ).toThrow(SplitError);
    expect(() =>
      computeShares(100, {
        type: "exact",
        shares: [{ userId: "a", amountCents: 100.5 }],
      })
    ).toThrow(SplitError);
  });
});

describe("computeShares — percentage", () => {
  it("splits by whole percentages", () => {
    const shares = computeShares(10000, {
      type: "percentage",
      shares: [
        { userId: "a", percent: 70 },
        { userId: "b", percent: 30 },
      ],
    });
    expect(shares).toEqual([
      { userId: "a", owedCents: 7000 },
      { userId: "b", owedCents: 3000 },
    ]);
  });

  it("supports two decimal places and still sums exactly", () => {
    const shares = computeShares(10000, {
      type: "percentage",
      shares: [
        { userId: "a", percent: 33.33 },
        { userId: "b", percent: 33.33 },
        { userId: "c", percent: 33.34 },
      ],
    });
    expect(sum(shares)).toBe(10000);
    expect(shares).toEqual([
      { userId: "a", owedCents: 3333 },
      { userId: "b", owedCents: 3333 },
      { userId: "c", owedCents: 3334 },
    ]);
  });

  it("keeps totals exact when percentages do not divide the amount evenly", () => {
    // 33.33% of $0.50 is 16.665 cents — rounding must not create or destroy
    // money.
    const shares = computeShares(50, {
      type: "percentage",
      shares: [
        { userId: "a", percent: 33.33 },
        { userId: "b", percent: 33.33 },
        { userId: "c", percent: 33.34 },
      ],
    });
    expect(sum(shares)).toBe(50);
  });

  it("rejects percentages that do not total 100", () => {
    expect(() =>
      computeShares(1000, {
        type: "percentage",
        shares: [
          { userId: "a", percent: 50 },
          { userId: "b", percent: 49 },
        ],
      })
    ).toThrow(/sum to 99, expected 100/);
  });

  it("rejects more than two decimal places", () => {
    expect(() =>
      computeShares(1000, {
        type: "percentage",
        shares: [
          { userId: "a", percent: 33.333 },
          { userId: "b", percent: 66.667 },
        ],
      })
    ).toThrow(SplitError);
  });
});

describe("computeShares — amount validation", () => {
  it.each([[0], [-100], [10.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "rejects amount %p",
    (amount) => {
      expect(() =>
        computeShares(amount, { type: "equal", participants: ["a"] })
      ).toThrow(SplitError);
    }
  );
});

describe("computeShares — conservation property", () => {
  it("never creates or destroys cents across many awkward inputs", () => {
    const participants = ["a", "b", "c", "d", "e", "f", "g"];
    for (let amount = 1; amount <= 500; amount++) {
      for (let n = 1; n <= participants.length; n++) {
        const shares = computeShares(amount, {
          type: "equal",
          participants: participants.slice(0, n),
        });
        expect(sum(shares)).toBe(amount);
        // No participant is ever more than one cent from the mean.
        const cents = shares.map((s) => s.owedCents);
        expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
      }
    }
  });
});
