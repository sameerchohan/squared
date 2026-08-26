// Server-side settlement validation. The client proposes (recipient, amount),
// but the source of truth is the group's net balances computed fresh from the
// database — inside the same advisory-locked transaction that inserts the
// settlement, so concurrent attempts can't double-spend a debt.

export type SettlementCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * A settlement from `fromUser` to `toUser` is valid when the payer actually
 * owes money, the recipient is actually owed money, and the amount exceeds
 * neither side. Capping at min(debt, credit) preserves the group's zero-sum
 * invariant: no payer can end up net-positive and no recipient net-negative
 * because of a settlement.
 */
export function validateSettlement(
  net: Map<string, number>,
  fromUser: string,
  toUser: string,
  amountCents: number
): SettlementCheck {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "Amount must be a positive number of cents" };
  }
  if (fromUser === toUser) {
    return { ok: false, reason: "You can't settle up with yourself" };
  }

  const payerDebt = -(net.get(fromUser) ?? 0);
  if (payerDebt <= 0) {
    return { ok: false, reason: "You don't owe anything in this group" };
  }

  const recipientCredit = net.get(toUser) ?? 0;
  if (recipientCredit <= 0) {
    return { ok: false, reason: "That member isn't owed anything" };
  }

  const maxPayable = Math.min(payerDebt, recipientCredit);
  if (amountCents > maxPayable) {
    return {
      ok: false,
      reason: `Amount exceeds what can be settled between you (max ${maxPayable} cents)`,
    };
  }

  return { ok: true };
}
