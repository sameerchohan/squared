import { describe, expect, it } from "vitest";
import { canModifyExpense } from "./expense-rules";

const base = {
  actorId: "payer",
  expensePaidBy: "payer",
  groupCreatedBy: "owner",
};

describe("canModifyExpense", () => {
  it("lets the payer edit their own expense", () => {
    expect(canModifyExpense(base)).toEqual({ ok: true });
  });

  it("lets the group owner edit an expense someone else paid", () => {
    expect(canModifyExpense({ ...base, actorId: "owner" })).toEqual({ ok: true });
  });

  it("stops a member who neither paid nor owns the group", () => {
    const result = canModifyExpense({ ...base, actorId: "bystander" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only the person who paid/i);
  });

  it("allows an owner who is also the payer", () => {
    expect(
      canModifyExpense({
        actorId: "owner",
        expensePaidBy: "owner",
        groupCreatedBy: "owner",
      })
    ).toEqual({ ok: true });
  });
});
