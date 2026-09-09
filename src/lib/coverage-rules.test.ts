import { describe, expect, it } from "vitest";
import {
  CoverageError,
  MAX_SHARES_PER_PERSON,
  resolveEqualShares,
  totalShares,
} from "./coverage-rules";

const plain = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe("resolveEqualShares", () => {
  it("gives everyone one share when nobody is covering anybody", () => {
    const resolved = resolveEqualShares(plain("a", "b", "c"));
    expect(resolved).toEqual([
      { userId: "a", weight: 1, coveredBy: null },
      { userId: "b", weight: 1, coveredBy: null },
      { userId: "c", weight: 1, coveredBy: null },
    ]);
    expect(totalShares(resolved)).toBe(3);
  });

  // The case the feature exists for, in both of its shapes. Seven people at
  // dinner, two of them a couple, one of the couple paying for both.
  describe("a couple where one covers the other", () => {
    it("counts a partner who never joined Squared", () => {
      // Six members plus Sara, who has no account and is Ali's guest.
      const resolved = resolveEqualShares(
        plain("ali", "b", "c", "d", "e", "f"),
        [{ guestId: "sara", sponsorUserId: "ali" }]
      );
      expect(totalShares(resolved)).toBe(7);
      expect(resolved[0]).toEqual({ userId: "ali", weight: 2, coveredBy: null });
    });

    it("counts a partner who is in the group, and charges her nothing", () => {
      // Seven members, Sara among them, her share moved onto Ali.
      const resolved = resolveEqualShares([
        { userId: "ali" },
        { userId: "sara", coveredBy: "ali" },
        ...plain("c", "d", "e", "f", "g"),
      ]);
      expect(totalShares(resolved)).toBe(7);
      expect(resolved[0]).toEqual({ userId: "ali", weight: 2, coveredBy: null });
      expect(resolved[1]).toEqual({
        userId: "sara",
        weight: 0,
        coveredBy: "ali",
      });
    });

    it("divides the bill the same number of ways either way", () => {
      const asGuest = resolveEqualShares(
        plain("ali", "b", "c", "d", "e", "f"),
        [{ guestId: "sara", sponsorUserId: "ali" }]
      );
      const asMember = resolveEqualShares([
        { userId: "ali" },
        { userId: "sara", coveredBy: "ali" },
        ...plain("b", "c", "d", "e", "f"),
      ]);
      expect(totalShares(asGuest)).toBe(totalShares(asMember));
    });
  });

  it("lets one person cover several guests and a member at once", () => {
    const resolved = resolveEqualShares(
      [{ userId: "ali" }, { userId: "sara", coveredBy: "ali" }, ...plain("c")],
      [
        { guestId: "kid-1", sponsorUserId: "ali" },
        { guestId: "kid-2", sponsorUserId: "ali" },
      ]
    );
    expect(resolved[0].weight).toBe(4); // himself, Sara, both kids
    expect(totalShares(resolved)).toBe(5);
  });

  it("takes a plain share count for people not worth naming", () => {
    const resolved = resolveEqualShares([
      { userId: "ali", shares: 3 },
      { userId: "b" },
    ]);
    expect(resolved[0].weight).toBe(3);
    expect(totalShares(resolved)).toBe(4);
  });

  it("lets a sponsor pay for a guest at something they skipped themselves", () => {
    // Ali did not go to the museum. Sara did, and Ali is still paying for her.
    const resolved = resolveEqualShares(
      [{ userId: "ali", shares: 0 }, { userId: "b" }, { userId: "c" }],
      [{ guestId: "sara", sponsorUserId: "ali" }]
    );
    expect(resolved[0]).toEqual({ userId: "ali", weight: 1, coveredBy: null });
    expect(totalShares(resolved)).toBe(3);
  });

  it("keeps input order so callers can zip against it", () => {
    const resolved = resolveEqualShares([
      { userId: "z" },
      { userId: "a", coveredBy: "z" },
      { userId: "m" },
    ]);
    expect(resolved.map((r) => r.userId)).toEqual(["z", "a", "m"]);
  });

  describe("rejects splits that would silently come out wrong", () => {
    const rejects = (fn: () => unknown, match: RegExp) =>
      expect(fn).toThrow(expect.objectContaining({ message: expect.stringMatching(match) }));

    it("nobody at all", () => {
      rejects(() => resolveEqualShares([]), /at least one participant/i);
      expect(() => resolveEqualShares([])).toThrow(CoverageError);
    });

    it("the same person twice", () => {
      rejects(() => resolveEqualShares(plain("a", "a")), /more than once/i);
    });

    it("covering yourself", () => {
      rejects(
        () => resolveEqualShares([{ userId: "a", coveredBy: "a" }, { userId: "b" }]),
        /own share/i
      );
    });

    it("being covered by someone who is not in the expense", () => {
      rejects(
        () => resolveEqualShares([{ userId: "a", coveredBy: "ghost" }, { userId: "b" }]),
        /part of this expense/i
      );
    });

    it("a chain of covering", () => {
      rejects(
        () =>
          resolveEqualShares([
            { userId: "a" },
            { userId: "b", coveredBy: "a" },
            { userId: "c", coveredBy: "b" },
          ]),
        /cannot cover another person/i
      );
    });

    it("a covered person also paying for shares", () => {
      rejects(
        () =>
          resolveEqualShares([
            { userId: "a" },
            { userId: "b", coveredBy: "a", shares: 1 },
          ]),
        /cannot also pay/i
      );
    });

    it("nobody paying for anything", () => {
      rejects(
        () => resolveEqualShares([{ userId: "a", shares: 0 }]),
        /has to be paying/i
      );
    });

    it("a guest sponsored by someone not in the expense", () => {
      rejects(
        () =>
          resolveEqualShares(plain("a", "b"), [
            { guestId: "g", sponsorUserId: "ghost" },
          ]),
        /listed in this expense/i
      );
    });

    it("a guest sponsored by someone who is themselves covered", () => {
      rejects(
        () =>
          resolveEqualShares(
            [{ userId: "a" }, { userId: "b", coveredBy: "a" }],
            [{ guestId: "g", sponsorUserId: "b" }]
          ),
        /cannot cover a guest/i
      );
    });

    it("the same guest twice", () => {
      rejects(
        () =>
          resolveEqualShares(plain("a"), [
            { guestId: "g", sponsorUserId: "a" },
            { guestId: "g", sponsorUserId: "a" },
          ]),
        /more than once/i
      );
    });

    it("a fractional or negative number of shares", () => {
      rejects(
        () => resolveEqualShares([{ userId: "a", shares: 1.5 }]),
        /whole number/i
      );
      rejects(
        () => resolveEqualShares([{ userId: "a", shares: -1 }]),
        /whole number/i
      );
    });

    it("an implausible number of shares", () => {
      rejects(
        () =>
          resolveEqualShares([
            { userId: "a", shares: MAX_SHARES_PER_PERSON + 1 },
          ]),
        /more than 20 shares/i
      );
    });
  });
});
