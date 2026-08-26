// Group balance math. Two stages, both pure:
//
// 1. computeNetBalances: collapse expenses + settlements into one net position
//    per user (positive = the group owes them, negative = they owe the group).
// 2. simplifyDebts: turn those net positions into the smallest practical list
//    of transfers by greedily matching the largest debtor with the largest
//    creditor. This is what "settle up" proposes as real Stripe payments.

export type ExpenseForBalance = {
  paidBy: string;
  shares: { userId: string; owedCents: number }[];
};

export type SettlementForBalance = {
  fromUser: string;
  toUser: string;
  amountCents: number;
};

export type Transfer = {
  fromUser: string;
  toUser: string;
  amountCents: number;
};

/**
 * Net position per user in cents. For each expense the payer is credited the
 * full amount and every sharer (payer included) is debited their share; a
 * settlement moves credit from the payer to the recipient. The returned map
 * always sums to zero and includes only users with a non-zero position.
 *
 * Callers decide which settlements to pass in. The API includes pending and
 * processing ones as well as succeeded, so a settlement in flight already
 * counts against the debt and can't be double-paid; a failed settlement is
 * excluded, which puts the debt back.
 */
export function computeNetBalances(
  expenses: ExpenseForBalance[],
  settlements: SettlementForBalance[]
): Map<string, number> {
  const net = new Map<string, number>();
  const add = (userId: string, cents: number) =>
    net.set(userId, (net.get(userId) ?? 0) + cents);

  for (const expense of expenses) {
    for (const share of expense.shares) {
      add(expense.paidBy, share.owedCents);
      add(share.userId, -share.owedCents);
    }
  }

  for (const s of settlements) {
    add(s.fromUser, s.amountCents);
    add(s.toUser, -s.amountCents);
  }

  for (const [userId, cents] of net) {
    if (cents === 0) net.delete(userId);
  }
  return net;
}

/**
 * Minimize the number of transfers needed to zero out `net` by repeatedly
 * matching the largest debtor with the largest creditor for
 * min(debt, credit). Produces at most (participants - 1) transfers instead of
 * the O(n²) pairwise debts. Deterministic: ties broken by userId.
 *
 * Throws if the positions don't sum to zero — that would mean the caller's
 * inputs are inconsistent, and no transfer list can settle them.
 */
export function simplifyDebts(net: Map<string, number>): Transfer[] {
  let sum = 0;
  for (const cents of net.values()) sum += cents;
  if (sum !== 0) {
    throw new Error(`Net balances sum to ${sum}, expected 0`);
  }

  // Sorted ascending so the largest of each side is at the end; amounts are
  // unique per entry only in magnitude order, so ties fall back to userId for
  // deterministic output.
  const creditors: { userId: string; cents: number }[] = [];
  const debtors: { userId: string; cents: number }[] = [];
  for (const [userId, cents] of net) {
    if (cents > 0) creditors.push({ userId, cents });
    else if (cents < 0) debtors.push({ userId, cents: -cents });
  }
  const byAmountAsc = (
    a: { userId: string; cents: number },
    b: { userId: string; cents: number }
  ) => a.cents - b.cents || b.userId.localeCompare(a.userId);
  creditors.sort(byAmountAsc);
  debtors.sort(byAmountAsc);

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[creditors.length - 1];
    const debtor = debtors[debtors.length - 1];
    const amount = Math.min(creditor.cents, debtor.cents);

    transfers.push({
      fromUser: debtor.userId,
      toUser: creditor.userId,
      amountCents: amount,
    });

    creditor.cents -= amount;
    debtor.cents -= amount;
    if (creditor.cents === 0) creditors.pop();
    if (debtor.cents === 0) debtors.pop();

    // A partially-settled party may no longer be the largest; restore order.
    // Lists are tiny (group-sized), so re-sorting beats a heap for clarity.
    creditors.sort(byAmountAsc);
    debtors.sort(byAmountAsc);
  }

  return transfers;
}
