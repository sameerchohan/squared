import { describe, expect, it } from "vitest";
import { ReceiptError, splitReceipt, type SharedItem } from "./receipt-split";

const owedOf = (b: { lines: { userId: string; owedCents: number }[] }) =>
  Object.fromEntries(b.lines.map((l) => [l.userId, l.owedCents]));
const total = (b: { lines: { owedCents: number }[] }) =>
  b.lines.reduce((sum, l) => sum + l.owedCents, 0);
const none: SharedItem[] = [];

describe("splitReceipt", () => {
  it("charges tax and tip in proportion to what each person ordered", () => {
    // $40 and $20 of food, $6 tax, $12 tip. Two thirds of it is the big order.
    const bill = splitReceipt(
      [
        { userId: "big", subtotalCents: 4000 },
        { userId: "small", subtotalCents: 2000 },
      ],
      none,
      600,
      1200
    );
    expect(owedOf(bill)).toEqual({ big: 5200, small: 2600 });
    expect(total(bill)).toBe(7800);
  });

  // The case this was rebuilt for: separate mains, one shared starter.
  it("splits shared items evenly and keeps the rest exact", () => {
    const bill = splitReceipt(
      [
        { userId: "ali", subtotalCents: 3000 },
        { userId: "priya", subtotalCents: 2000 },
        { userId: "dev", subtotalCents: 1000 },
      ],
      [{ label: "Appetisers", amountCents: 3000, sharedBy: ["ali", "priya", "dev"] }],
      900,
      1800
    );

    // $10 of starter each, then tax and tip at 30% of everyone's own food.
    expect(bill.lines.map((l) => l.sharedCents)).toEqual([1000, 1000, 1000]);
    expect(bill.lines.map((l) => l.subtotalCents)).toEqual([4000, 3000, 2000]);
    expect(owedOf(bill)).toEqual({ ali: 5200, priya: 3900, dev: 2600 });
    expect(total(bill)).toBe(11700);
  });

  it("charges a shared item only to the people who were in on it", () => {
    const bill = splitReceipt(
      [
        { userId: "ali", subtotalCents: 3000 },
        { userId: "priya", subtotalCents: 2000 },
        { userId: "teetotal", subtotalCents: 1000 },
      ],
      [{ label: "Wine", amountCents: 2000, sharedBy: ["ali", "priya"] }],
      0,
      0
    );
    expect(owedOf(bill)).toEqual({ ali: 4000, priya: 3000, teetotal: 1000 });
    // The person who skipped the wine pays exactly what they ordered.
    expect(bill.lines[2].sharedCents).toBe(0);
  });

  it("counts somebody who only shared and ordered nothing of their own", () => {
    const bill = splitReceipt(
      [
        { userId: "ate", subtotalCents: 3000 },
        { userId: "picked", subtotalCents: 0 },
      ],
      [{ label: "Chips", amountCents: 1000, sharedBy: ["ate", "picked"] }],
      0,
      0
    );
    expect(owedOf(bill)).toEqual({ ate: 3500, picked: 500 });
  });

  it("charges nothing to somebody who ordered nothing and shared nothing", () => {
    const bill = splitReceipt(
      [
        { userId: "ate", subtotalCents: 3000 },
        { userId: "watched", subtotalCents: 0 },
      ],
      [{ amountCents: 1000, sharedBy: ["ate"] }],
      400,
      800
    );
    expect(owedOf(bill).watched).toBe(0);
    expect(total(bill)).toBe(5200);
  });

  it("never loses a cent dividing an awkward shared item", () => {
    const bill = splitReceipt(
      [
        { userId: "a", subtotalCents: 0 },
        { userId: "b", subtotalCents: 0 },
        { userId: "c", subtotalCents: 0 },
      ],
      [{ label: "Bread", amountCents: 1000, sharedBy: ["a", "b", "c"] }],
      0,
      0
    );
    expect(bill.sharedSplits[0].map((s) => s.cents)).toEqual([334, 333, 333]);
    expect(total(bill)).toBe(1000);
  });

  it("adds up exactly however awkward every number is", () => {
    const bill = splitReceipt(
      [
        { userId: "a", subtotalCents: 1733 },
        { userId: "b", subtotalCents: 911 },
        { userId: "c", subtotalCents: 2477 },
      ],
      [
        { label: "Starters", amountCents: 1301, sharedBy: ["a", "b", "c"] },
        { label: "Wine", amountCents: 4099, sharedBy: ["a", "c"] },
      ],
      877,
      1613
    );
    const food = 1733 + 911 + 2477 + 1301 + 4099;
    expect(bill.foodCents).toBe(food);
    expect(bill.totalCents).toBe(food + 877 + 1613);
    expect(total(bill)).toBe(bill.totalCents);
    // Every person's food is their own plus their parts of the two items.
    for (const line of bill.lines) {
      expect(line.subtotalCents).toBe(line.individualCents + line.sharedCents);
    }
  });

  it("reports each shared item's per-person figure for the screen", () => {
    const bill = splitReceipt(
      [
        { userId: "a", subtotalCents: 100 },
        { userId: "b", subtotalCents: 100 },
      ],
      [{ label: "Olives", amountCents: 900, sharedBy: ["a", "b"] }],
      0,
      0
    );
    expect(bill.sharedSplits[0]).toEqual([
      { userId: "a", cents: 450 },
      { userId: "b", cents: 450 },
    ]);
  });

  it("refuses a shared item nobody is down for", () => {
    expect(() =>
      splitReceipt(
        [{ userId: "a", subtotalCents: 100 }],
        [{ label: "Olives", amountCents: 900, sharedBy: [] }],
        0,
        0
      )
    ).toThrow(/who shared Olives/i);
  });

  it("refuses a sharer who is not on the bill", () => {
    expect(() =>
      splitReceipt(
        [{ userId: "a", subtotalCents: 100 }],
        [{ amountCents: 900, sharedBy: ["ghost"] }],
        0,
        0
      )
    ).toThrow(/not on this bill/i);
  });

  it("refuses a bill with no food on it at all", () => {
    expect(() =>
      splitReceipt([{ userId: "a", subtotalCents: 0 }], none, 500, 500)
    ).toThrow(ReceiptError);
  });

  it("refuses fractional or negative money", () => {
    expect(() =>
      splitReceipt([{ userId: "a", subtotalCents: 10.5 }], none, 0, 0)
    ).toThrow(/whole number of cents/i);
    expect(() =>
      splitReceipt([{ userId: "a", subtotalCents: 100 }], none, -1, 0)
    ).toThrow(/tax/i);
    expect(() =>
      splitReceipt(
        [{ userId: "a", subtotalCents: 100 }],
        [{ amountCents: -5, sharedBy: ["a"] }],
        0,
        0
      )
    ).toThrow(/shared amount/i);
  });

  it("refuses the same person twice", () => {
    expect(() =>
      splitReceipt(
        [
          { userId: "a", subtotalCents: 100 },
          { userId: "a", subtotalCents: 200 },
        ],
        none,
        0,
        0
      )
    ).toThrow(/more than once/i);
  });
});
