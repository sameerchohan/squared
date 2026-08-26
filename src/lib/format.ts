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
