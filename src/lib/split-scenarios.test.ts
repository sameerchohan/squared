// Real situations, end to end through the same code the app uses.
//
// The unit tests next door check each rule on its own. This file checks that
// the rules together produce the number a person would arrive at with a pen,
// for the kinds of nights out people actually have, and that the money always
// adds up exactly no matter how awkward the division.

import { describe, expect, it } from "vitest";
import { computeShares } from "./splits";
import { splitReceipt, type SharedItem } from "./receipt-split";

const c = (dollars: number) => Math.round(dollars * 100);
const owed = (bill: { lines: { userId: string; owedCents: number }[] }) =>
  Object.fromEntries(bill.lines.map((l) => [l.userId, l.owedCents]));
const paidTotal = (bill: { lines: { owedCents: number }[] }) =>
  bill.lines.reduce((sum, l) => sum + l.owedCents, 0);
const people = (...names: string[]) =>
  names.map((userId) => ({ userId, subtotalCents: 0 }));
const noneShared: SharedItem[] = [];

/** Every bill must satisfy these, whatever it is a bill for. */
function expectSound(bill: ReturnType<typeof splitReceipt>) {
  expect(paidTotal(bill)).toBe(bill.totalCents);
  for (const line of bill.lines) {
    expect(line.owedCents).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(line.owedCents)).toBe(true);
    expect(line.subtotalCents).toBe(line.individualCents + line.sharedCents);
    // Nothing consumed, nothing owed. Not even a share of the tip.
    if (line.subtotalCents === 0) expect(line.owedCents).toBe(0);
  }
}

describe("eating out", () => {
  it("separate mains, shared starters, tip in proportion", () => {
    const bill = splitReceipt(
      [
        { userId: "maya", subtotalCents: c(32) },
        { userId: "daniel", subtotalCents: c(26) },
        { userId: "priya", subtotalCents: c(19) },
        { userId: "tom", subtotalCents: c(0) },
      ],
      [
        { label: "Appetisers", amountCents: c(36), sharedBy: ["maya", "daniel", "priya", "tom"] },
        { label: "Wine", amountCents: c(45), sharedBy: ["maya", "daniel", "priya"] },
      ],
      c(9.5),
      c(18)
    );
    expect(owed(bill)).toEqual({
      maya: c(65.75),
      daniel: c(58.7),
      priya: c(50.48),
      tom: c(10.57),
    });
    expectSound(bill);
  });

  it("the designated driver who had nothing pays nothing at all", () => {
    const bill = splitReceipt(
      [
        { userId: "eater", subtotalCents: c(40) },
        { userId: "driver", subtotalCents: c(0) },
      ],
      noneShared,
      c(4),
      c(8)
    );
    expect(owed(bill).driver).toBe(0);
    expect(owed(bill).eater).toBe(c(52));
    expectSound(bill);
  });

  it("somebody who turned up only for dessert", () => {
    const bill = splitReceipt(
      [
        { userId: "dinner", subtotalCents: c(48) },
        { userId: "latecomer", subtotalCents: c(9) },
      ],
      [{ label: "Dessert to share", amountCents: c(12), sharedBy: ["dinner", "latecomer"] }],
      0,
      0
    );
    expect(owed(bill)).toEqual({ dinner: c(54), latecomer: c(15) });
    expectSound(bill);
  });

  it("rounds of drinks, each bought for a different set of people", () => {
    const bill = splitReceipt(
      people("a", "b", "c", "d"),
      [
        { label: "Round one", amountCents: c(32), sharedBy: ["a", "b", "c", "d"] },
        { label: "Round two", amountCents: c(24), sharedBy: ["a", "b", "c"] },
        { label: "Round three", amountCents: c(16), sharedBy: ["a", "b"] },
      ],
      0,
      0
    );
    expect(owed(bill)).toEqual({ a: c(24), b: c(24), c: c(16), d: c(8) });
    expectSound(bill);
  });

  it("a coupon comes off everybody in proportion", () => {
    const bill = splitReceipt(
      [
        { userId: "big", subtotalCents: c(60) },
        { userId: "small", subtotalCents: c(20) },
      ],
      noneShared,
      0,
      0,
      c(20)
    );
    // $20 off an $80 bill is a quarter off each person's share.
    expect(owed(bill)).toEqual({ big: c(45), small: c(15) });
    expectSound(bill);
  });

  it("refuses a discount larger than the bill", () => {
    expect(() =>
      splitReceipt([{ userId: "a", subtotalCents: c(10) }], noneShared, 0, 0, c(50))
    ).toThrow(/bigger than the bill/i);
  });
});

describe("activities, not just restaurants", () => {
  it("bowling: lanes shared, shoes only for who hired them", () => {
    const bill = splitReceipt(
      people("ana", "ben", "cara", "dan"),
      [
        { label: "Two lanes", amountCents: c(72), sharedBy: ["ana", "ben", "cara", "dan"] },
        { label: "Shoe hire", amountCents: c(15), sharedBy: ["ana", "ben", "cara"] },
      ],
      0,
      0
    );
    expect(owed(bill)).toEqual({ ana: c(23), ben: c(23), cara: c(23), dan: c(18) });
    expectSound(bill);
  });

  it("pool by the hour, with two people joining for the second hour", () => {
    // Time-based charges divide by modelling each stretch as its own item.
    const bill = splitReceipt(
      people("a", "b", "c", "d", "e", "f"),
      [
        { label: "First hour", amountCents: c(24), sharedBy: ["a", "b", "c", "d"] },
        { label: "Second hour", amountCents: c(24), sharedBy: ["a", "b", "c", "d", "e", "f"] },
      ],
      0,
      0
    );
    expect(owed(bill)).toEqual({
      a: c(10), b: c(10), c: c(10), d: c(10), e: c(4), f: c(4),
    });
    expectSound(bill);
  });

  it("golf: green fees each, a cart shared by two", () => {
    const bill = splitReceipt(
      [
        { userId: "walker", subtotalCents: c(45) },
        { userId: "rider1", subtotalCents: c(45) },
        { userId: "rider2", subtotalCents: c(45) },
      ],
      [{ label: "Cart", amountCents: c(30), sharedBy: ["rider1", "rider2"] }],
      0,
      0
    );
    expect(owed(bill)).toEqual({ walker: c(45), rider1: c(60), rider2: c(60) });
    expectSound(bill);
  });

  it("a rental split by nights stayed", () => {
    // Four nights at $200; one person is only there for the last two.
    const bill = splitReceipt(
      people("full1", "full2", "late"),
      [
        { label: "Nights 1 and 2", amountCents: c(400), sharedBy: ["full1", "full2"] },
        { label: "Nights 3 and 4", amountCents: c(400), sharedBy: ["full1", "full2", "late"] },
      ],
      0,
      0
    );
    // $800 over four nights. The two who stayed throughout pay for the first
    // two nights between them and share the rest three ways; the odd cent on
    // the second item lands on full2 because the rounding start rotates.
    expect(owed(bill)).toEqual({
      full1: c(333.33), full2: c(333.34), late: c(133.33),
    });
    expect(paidTotal(bill)).toBe(c(800));
    expectSound(bill);
  });

  it("a flat activity fee is just an even split", () => {
    const shares = computeShares(c(90), {
      type: "equal",
      participants: ["a", "b", "c", "d", "e", "f"],
    });
    expect(shares.every((s) => s.owedCents === c(15))).toBe(true);
  });

  it("ski day: different lift passes, shared petrol and lodge", () => {
    const bill = splitReceipt(
      [
        { userId: "adult1", subtotalCents: c(129) },
        { userId: "adult2", subtotalCents: c(129) },
        { userId: "child", subtotalCents: c(69) },
      ],
      [
        { label: "Petrol", amountCents: c(58), sharedBy: ["adult1", "adult2", "child"] },
        { label: "Lodge lunch", amountCents: c(47), sharedBy: ["adult1", "adult2", "child"] },
      ],
      c(24.5),
      0
    );
    expectSound(bill);
    // The child's pass is cheaper, so the child's share of the tax is smaller.
    expect(owed(bill).child).toBeLessThan(owed(bill).adult1);
    expect(owed(bill).adult1).toBe(owed(bill).adult2);
  });

  it("groceries: shared staples and one person's own shopping", () => {
    const bill = splitReceipt(
      [
        { userId: "a", subtotalCents: c(0) },
        { userId: "b", subtotalCents: c(0) },
        { userId: "c", subtotalCents: c(23.4) },
      ],
      [{ label: "Shared staples", amountCents: c(84.6), sharedBy: ["a", "b", "c"] }],
      0,
      0
    );
    expect(owed(bill)).toEqual({ a: c(28.2), b: c(28.2), c: c(51.6) });
    expectSound(bill);
  });
});

describe("awkward divisions still come out exact", () => {
  it("one person on the bill gets all of it", () => {
    const bill = splitReceipt(
      [{ userId: "solo", subtotalCents: c(19.99) }],
      noneShared,
      c(1.7),
      c(4)
    );
    expect(owed(bill).solo).toBe(c(25.69));
    expectSound(bill);
  });

  it("three ways on a penny-awkward bill", () => {
    const bill = splitReceipt(
      people("a", "b", "c"),
      [{ label: "Everything", amountCents: 1000, sharedBy: ["a", "b", "c"] }],
      0,
      1
    );
    expect(paidTotal(bill)).toBe(1001);
    expectSound(bill);
  });

  it("does not tax the same person for every rounding leftover", () => {
    // Six items of $10 split three ways: the spare cent has to move around,
    // or whoever is listed first quietly pays six cents extra every time.
    const items = Array.from({ length: 6 }, (_, i) => ({
      label: `Item ${i + 1}`,
      amountCents: 1000,
      sharedBy: ["a", "b", "c"],
    }));
    const bill = splitReceipt(people("a", "b", "c"), items, 0, 0);
    expect(paidTotal(bill)).toBe(6000);
    // Two spare cents each, rather than six for one person and none for the others.
    expect(bill.lines.map((l) => l.owedCents)).toEqual([2000, 2000, 2000]);
  });

  it("survives an implausibly large bill without losing precision", () => {
    const bill = splitReceipt(
      [
        { userId: "a", subtotalCents: 99_000_000 },
        { userId: "b", subtotalCents: 899_999 },
      ],
      noneShared,
      0,
      0
    );
    expect(paidTotal(bill)).toBe(99_899_999);
    expect(owed(bill).a).toBe(99_000_000);
    expectSound(bill);
  });

  it("splits a prime number of ways with nothing left over", () => {
    const names = Array.from({ length: 13 }, (_, i) => `p${i}`);
    const bill = splitReceipt(
      people(...names),
      [{ label: "Table", amountCents: 10_000, sharedBy: names }],
      777,
      1_234
    );
    expect(paidTotal(bill)).toBe(10_000 + 777 + 1_234);
    expectSound(bill);
  });
});

describe("whatever the numbers, the money always adds up", () => {
  // A small deterministic generator, so a failure can be reproduced exactly.
  function rng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  it("holds across a thousand randomly generated bills", () => {
    const random = rng(20260909);
    const pick = (n: number) => Math.floor(random() * n);

    for (let trial = 0; trial < 1000; trial++) {
      const headcount = 1 + pick(15);
      const names = Array.from({ length: headcount }, (_, i) => `p${i}`);

      const individual = names.map((userId) => ({
        userId,
        // Plenty of zeroes, so people who consumed nothing are well covered.
        subtotalCents: pick(3) === 0 ? 0 : pick(20_000),
      }));

      const shared: SharedItem[] = [];
      for (let item = 0; item < pick(5); item++) {
        const sharers = names.filter(() => random() < 0.6);
        if (sharers.length === 0) continue;
        shared.push({ amountCents: 1 + pick(15_000), sharedBy: sharers });
      }

      const food =
        individual.reduce((sum, o) => sum + o.subtotalCents, 0) +
        shared.reduce((sum, s) => sum + s.amountCents, 0);
      if (food === 0) continue;

      const tax = pick(3) === 0 ? 0 : pick(4_000);
      const tip = pick(3) === 0 ? 0 : pick(8_000);
      // Never more than the bill can absorb.
      const discount = pick(4) === 0 ? pick(Math.min(food + tax + tip, 5_000)) : 0;

      const bill = splitReceipt(individual, shared, tax, tip, discount);
      expectSound(bill);
      expect(bill.totalCents).toBe(food + tax + tip - discount);

      // Nobody is ever more than a cent per rounding stage away from their
      // exact proportion of the bill.
      for (const line of bill.lines) {
        const ideal = (line.subtotalCents / bill.foodCents) * bill.totalCents;
        expect(Math.abs(line.owedCents - ideal)).toBeLessThanOrEqual(
          shared.length + 2
        );
      }
    }
  });

  it("holds for equal splits with covering, however they are arranged", () => {
    const random = rng(7654321);
    const pick = (n: number) => Math.floor(random() * n);

    for (let trial = 0; trial < 1000; trial++) {
      const headcount = 1 + pick(12);
      const names = Array.from({ length: headcount }, (_, i) => `p${i}`);
      const amount = 1 + pick(500_000);

      const participants = names.map((userId, index) => {
        // Only ever covered by someone earlier in the list, which keeps the
        // generator from inventing the chains the rules already reject.
        if (index > 0 && pick(4) === 0) {
          return { userId, coveredBy: names[0] };
        }
        return { userId, shares: pick(6) === 0 ? 0 : 1 + pick(3) };
      });
      if (participants.every((p) => "shares" in p && p.shares === 0)) continue;

      const shares = computeShares(amount, { type: "equal", participants });
      expect(shares.reduce((sum, s) => sum + s.owedCents, 0)).toBe(amount);
      for (const share of shares) {
        expect(share.owedCents).toBeGreaterThanOrEqual(0);
      }
      // Anybody being covered owes nothing.
      for (const p of participants) {
        if ("coveredBy" in p && p.coveredBy) {
          expect(shares.find((s) => s.userId === p.userId)!.owedCents).toBe(0);
        }
      }
    }
  });
});
