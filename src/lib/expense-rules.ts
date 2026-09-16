/**
 * Who may change or remove an expense. Extracted so the rule is testable on
 * its own and so the API and the UI can never disagree about which rows get
 * edit controls.
 *
 * Two people qualify. The payer, because the record is theirs: they are the
 * one who spent the money and the one who knows what it was for. And the
 * group's owner, because someone has to be able to fix a typo left behind by
 * a member who has stopped replying, and without that the only repair for a
 * wrong expense is deleting the whole group.
 *
 * Deliberately *not* every member: a debtor who could quietly delete an
 * expense could erase what they owe, which is the one thing the ledger exists
 * to remember.
 */
export type ExpenseEditCheck = { ok: true } | { ok: false; reason: string };

export function canModifyExpense(input: {
  actorId: string;
  expensePaidBy: string;
  groupCreatedBy: string;
}): ExpenseEditCheck {
  if (input.actorId === input.expensePaidBy) return { ok: true };
  if (input.actorId === input.groupCreatedBy) return { ok: true };
  return {
    ok: false,
    reason:
      "Only the person who paid, or the group's owner, can change or delete this expense.",
  };
}
