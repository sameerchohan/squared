/**
 * Whether a member can be removed from a group. Extracted so the rule is
 * testable on its own: removing someone mid-debt would erase the record of
 * what they owe, and removing someone who paid for an expense would orphan
 * that expense's payer reference.
 */
export type RemovalCheck = { ok: true } | { ok: false; reason: string };

export function canRemoveMember(input: {
  actorId: string;
  targetId: string;
  groupCreatedBy: string;
  targetNetCents: number;
  targetPaidExpenseCount: number;
  memberCount: number;
}): RemovalCheck {
  const leavingSelf = input.actorId === input.targetId;

  if (!leavingSelf && input.groupCreatedBy !== input.actorId) {
    return { ok: false, reason: "Only the group's creator can remove other members." };
  }
  if (input.memberCount <= 1) {
    return { ok: false, reason: "A group needs at least one member." };
  }
  if (input.targetNetCents !== 0) {
    return { ok: false, reason: "Settle up before leaving or removing someone." };
  }
  if (input.targetPaidExpenseCount > 0) {
    return {
      ok: false,
      reason: "They paid for expenses here, so their record has to stay.",
    };
  }
  return { ok: true };
}
