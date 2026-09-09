/** "$12.34" / "-$0.05" from integer cents. Display only — money stays in cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/**
 * Parse a user-typed dollar amount ("12.34") into integer cents, or null if
 * it isn't a valid amount with at most 2 decimal places. The only place a
 * decimal representation is ever converted.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [dollars, decimals = ""] = trimmed.split(".");
  return Number(dollars) * 100 + Number(decimals.padEnd(2, "0") || "0");
}

/**
 * Several amounts in one field: "15+2+7", or "15 2 7", meaning 24.00.
 *
 * Nobody sitting at a table wants to add up their own entree, side and drink
 * before they can type them in. Blank means zero. A trailing or doubled
 * separator is ignored rather than rejected, because it is what a
 * half-finished "15+" looks like while somebody is still typing.
 *
 * Commas are deliberately not separators: "1,234.56" is one amount, not two.
 */
export function parseMoneySum(input: string): number | null {
  const parts = input.split(/[+\s]+/).filter((part) => part !== "");
  let total = 0;
  for (const part of parts) {
    const cents = parseDollarsToCents(part);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}

/** How many amounts were actually typed, so a form can show its working. */
export function countMoneyParts(input: string): number {
  return input.split(/[+\s]+/).filter((part) => part !== "").length;
}
