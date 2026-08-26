import { describe, expect, it } from "vitest";
import { validateSettlement } from "./settlement-rules";

// a is owed $10, b owes $6, c owes $4.
const net = new Map([
  ["a", 1000],
  ["b", -600],
  ["c", -400],
]);

describe("validateSettlement", () => {
  it("allows paying exactly what the payer owes", () => {
    expect(validateSettlement(net, "b", "a", 600)).toEqual({ ok: true });
  });

  it("allows a partial payment", () => {
    expect(validateSettlement(net, "b", "a", 100)).toEqual({ ok: true });
  });

  it("rejects paying more than the payer owes", () => {
    const result = validateSettlement(net, "b", "a", 601);
    expect(result.ok).toBe(false);
  });

  it("rejects paying more than the recipient is owed", () => {
    // d owes 500 but a is only owed 300 here.
    const smallCredit = new Map([
      ["a", 300],
      ["d", -500],
      ["e", 200],
    ]);
    expect(validateSettlement(smallCredit, "d", "a", 400).ok).toBe(false);
    expect(validateSettlement(smallCredit, "d", "a", 300)).toEqual({
      ok: true,
    });
  });

  it("rejects a payer who owes nothing", () => {
    expect(validateSettlement(net, "a", "b", 100).ok).toBe(false);
    expect(validateSettlement(net, "unknown", "a", 100).ok).toBe(false);
  });

  it("rejects a recipient who is owed nothing", () => {
    expect(validateSettlement(net, "b", "c", 100).ok).toBe(false);
    expect(validateSettlement(net, "b", "unknown", 100).ok).toBe(false);
  });

  it("rejects self-settlement and non-positive or non-integer amounts", () => {
    expect(validateSettlement(net, "b", "b", 100).ok).toBe(false);
    expect(validateSettlement(net, "b", "a", 0).ok).toBe(false);
    expect(validateSettlement(net, "b", "a", -100).ok).toBe(false);
    expect(validateSettlement(net, "b", "a", 100.5).ok).toBe(false);
  });
});
