import { describe, expect, it } from "vitest";
import {
  computeNetBalances,
  simplifyDebts,
  type ExpenseForBalance,
  type SettlementForBalance,
} from "./balances";

const expense = (
  paidBy: string,
  shares: [string, number][]
): ExpenseForBalance => ({
  paidBy,
  shares: shares.map(([userId, owedCents]) => ({ userId, owedCents })),
});

describe("computeNetBalances", () => {
  it("credits the payer and debits each sharer", () => {
    // a pays $30, split equally three ways.
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 1000],
          ["b", 1000],
          ["c", 1000],
        ]),
      ],
      []
    );
    expect(net.get("a")).toBe(2000);
    expect(net.get("b")).toBe(-1000);
    expect(net.get("c")).toBe(-1000);
  });

  it("nets multiple expenses across payers", () => {
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 500],
          ["b", 500],
        ]),
        expense("b", [
          ["a", 500],
          ["b", 500],
        ]),
      ],
      []
    );
    // Perfectly mutual: everyone nets to zero and is dropped from the map.
    expect(net.size).toBe(0);
  });

  it("applies settlements against the debt", () => {
    const settlements: SettlementForBalance[] = [
      { fromUser: "b", toUser: "a", amountCents: 400 },
    ];
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 500],
          ["b", 500],
        ]),
      ],
      settlements
    );
    expect(net.get("a")).toBe(100);
    expect(net.get("b")).toBe(-100);
  });

  it("drops users who settle to exactly zero", () => {
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 500],
          ["b", 500],
        ]),
      ],
      [{ fromUser: "b", toUser: "a", amountCents: 500 }]
    );
    expect(net.size).toBe(0);
  });

  it("handles a payer who is not in the shares", () => {
    // a pays for something only b and c consumed.
    const net = computeNetBalances(
      [
        expense("a", [
          ["b", 600],
          ["c", 400],
        ]),
      ],
      []
    );
    expect(net.get("a")).toBe(1000);
    expect(net.get("b")).toBe(-600);
    expect(net.get("c")).toBe(-400);
  });

  it("always sums to zero", () => {
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 123],
          ["b", 456],
          ["c", 789],
        ]),
        expense("b", [
          ["a", 250],
          ["d", 251],
        ]),
        expense("d", [
          ["c", 99],
          ["d", 1],
        ]),
      ],
      [{ fromUser: "c", toUser: "a", amountCents: 300 }]
    );
    let sum = 0;
    for (const cents of net.values()) sum += cents;
    expect(sum).toBe(0);
  });
});

describe("simplifyDebts", () => {
  const asMap = (entries: [string, number][]) => new Map(entries);

  it("returns no transfers when everyone is settled", () => {
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it("handles a single debtor-creditor pair", () => {
    expect(
      simplifyDebts(
        asMap([
          ["a", 500],
          ["b", -500],
        ])
      )
    ).toEqual([{ fromUser: "b", toUser: "a", amountCents: 500 }]);
  });

  it("collapses a chain: b owes a, c owes b becomes direct transfers", () => {
    // Pairwise view would be b→a $10, c→b $10 (2 transfers involving b twice).
    // Net view: a +10, b 0, c -10 → a single transfer c→a.
    const transfers = simplifyDebts(
      asMap([
        ["a", 1000],
        ["c", -1000],
      ])
    );
    expect(transfers).toEqual([
      { fromUser: "c", toUser: "a", amountCents: 1000 },
    ]);
  });

  it("matches the largest debtor to the largest creditor first", () => {
    const transfers = simplifyDebts(
      asMap([
        ["a", 700],
        ["b", 300],
        ["c", -600],
        ["d", -400],
      ])
    );
    expect(transfers[0]).toEqual({
      fromUser: "c",
      toUser: "a",
      amountCents: 600,
    });
    // After c→a, d (400 left) is the largest debtor and b (300) the largest
    // creditor, so d pays b before topping up a.
    expect(transfers).toEqual([
      { fromUser: "c", toUser: "a", amountCents: 600 },
      { fromUser: "d", toUser: "b", amountCents: 300 },
      { fromUser: "d", toUser: "a", amountCents: 100 },
    ]);
  });

  it("produces at most n-1 transfers for n unsettled users", () => {
    const net = asMap([
      ["a", 999],
      ["b", 501],
      ["c", 1],
      ["d", -700],
      ["e", -800],
      ["f", -1],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers.length).toBeLessThanOrEqual(net.size - 1);
  });

  it("transfers exactly settle every balance", () => {
    const net = asMap([
      ["a", 12345],
      ["b", -2345],
      ["c", -10000],
      ["d", 55],
      ["e", -55],
    ]);
    const transfers = simplifyDebts(net);

    const after = new Map(net);
    for (const t of transfers) {
      expect(t.amountCents).toBeGreaterThan(0);
      expect(t.fromUser).not.toBe(t.toUser);
      after.set(t.fromUser, (after.get(t.fromUser) ?? 0) + t.amountCents);
      after.set(t.toUser, (after.get(t.toUser) ?? 0) - t.amountCents);
    }
    for (const cents of after.values()) expect(cents).toBe(0);
  });

  it("is deterministic when amounts tie", () => {
    const make = () =>
      simplifyDebts(
        asMap([
          ["b", 500],
          ["a", 500],
          ["d", -500],
          ["c", -500],
        ])
      );
    expect(make()).toEqual(make());
  });

  it("rejects balances that do not sum to zero", () => {
    expect(() => simplifyDebts(asMap([["a", 100]]))).toThrow(
      /sum to 100, expected 0/
    );
  });

  it("settles end-to-end from expenses to transfers", () => {
    // Roommates: a pays rent $1500 split equally, b pays groceries $90
    // equally, c pays utilities $60 equally.
    const net = computeNetBalances(
      [
        expense("a", [
          ["a", 50000],
          ["b", 50000],
          ["c", 50000],
        ]),
        expense("b", [
          ["a", 3000],
          ["b", 3000],
          ["c", 3000],
        ]),
        expense("c", [
          ["a", 2000],
          ["b", 2000],
          ["c", 2000],
        ]),
      ],
      []
    );
    const transfers = simplifyDebts(net);
    // Net: a +950, b -460, c -490. b and c each just pay a once — no b↔c
    // transfer needed, and the larger debtor (c) goes first.
    expect(transfers).toEqual([
      { fromUser: "c", toUser: "a", amountCents: 49000 },
      { fromUser: "b", toUser: "a", amountCents: 46000 },
    ]);
  });
});
