import { describe, expect, it } from "vitest";
import { canRemoveMember } from "./membership-rules";

const base = {
  actorId: "owner",
  targetId: "member",
  groupCreatedBy: "owner",
  targetNetCents: 0,
  targetPaidExpenseCount: 0,
  memberCount: 3,
};

describe("canRemoveMember", () => {
  it("lets the creator remove a settled member", () => {
    expect(canRemoveMember(base)).toEqual({ ok: true });
  });

  it("lets anyone remove themselves", () => {
    expect(
      canRemoveMember({ ...base, actorId: "member", groupCreatedBy: "owner" })
    ).toEqual({ ok: true });
  });

  it("stops a non-creator removing someone else", () => {
    const result = canRemoveMember({ ...base, actorId: "bystander" });
    expect(result.ok).toBe(false);
  });

  it("refuses while the member still owes money", () => {
    expect(canRemoveMember({ ...base, targetNetCents: -500 }).ok).toBe(false);
  });

  it("refuses while the member is still owed money", () => {
    // Removing a creditor would erase what the group owes them.
    expect(canRemoveMember({ ...base, targetNetCents: 500 }).ok).toBe(false);
  });

  it("refuses when the member paid for an expense", () => {
    // expenses.paid_by has no cascade; the reference would be orphaned.
    expect(canRemoveMember({ ...base, targetPaidExpenseCount: 2 }).ok).toBe(false);
  });

  it("refuses to empty a group", () => {
    expect(
      canRemoveMember({ ...base, actorId: "solo", targetId: "solo", memberCount: 1 }).ok
    ).toBe(false);
  });
});
