import { describe, expect, it } from "vitest";
import { countMoneyParts, formatCents, parseDollarsToCents, parseMoneySum } from "./format";

describe("parseMoneySum", () => {
  it("adds up several amounts typed into one field", () => {
    expect(parseMoneySum("15+2+7")).toBe(2400);
    expect(parseMoneySum("15 2 7")).toBe(2400);
    expect(parseMoneySum("15.50 + 2.25")).toBe(1775);
  });

  it("still takes a single amount", () => {
    expect(parseMoneySum("24")).toBe(2400);
    expect(parseMoneySum("24.50")).toBe(2450);
  });

  it("treats blank as nothing", () => {
    expect(parseMoneySum("")).toBe(0);
    expect(parseMoneySum("   ")).toBe(0);
  });

  it("tolerates what a half-typed sum looks like", () => {
    expect(parseMoneySum("15+")).toBe(1500);
    expect(parseMoneySum("15++2")).toBe(1700);
    expect(parseMoneySum(" 15 + 2 ")).toBe(1700);
  });

  it("does not split on a comma, which belongs inside an amount", () => {
    // "1,234.56" is one number; splitting it would silently read 1 and 234.56.
    expect(parseMoneySum("1,234.56")).toBeNull();
  });

  it("rejects anything that is not an amount", () => {
    expect(parseMoneySum("15+abc")).toBeNull();
    expect(parseMoneySum("$15+2")).toBeNull();
    expect(parseMoneySum("15.999")).toBeNull();
    expect(parseMoneySum("-15")).toBeNull();
  });

  it("never disagrees with the single-amount parser", () => {
    for (const value of ["0", "0.01", "9.99", "1000", "12.30"]) {
      expect(parseMoneySum(value)).toBe(parseDollarsToCents(value));
    }
  });

  it("counts the parts so the form knows when to show its working", () => {
    expect(countMoneyParts("15+2+7")).toBe(3);
    expect(countMoneyParts("24")).toBe(1);
    expect(countMoneyParts("")).toBe(0);
    expect(countMoneyParts("15+")).toBe(1);
  });
});

describe("formatCents", () => {
  it("renders whole and part dollars", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(2400)).toBe("$24.00");
    expect(formatCents(-2400)).toBe("-$24.00");
  });
});
