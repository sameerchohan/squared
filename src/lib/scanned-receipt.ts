/**
 * What reading a photo of a receipt gives back. Shared by the route that
 * produces it and the form that fills itself in from it, so the two cannot
 * drift apart.
 *
 * Every figure is nullable because a receipt may simply not print it, and a
 * gap is reported rather than guessed at.
 */
export type ScannedReceipt = {
  items: { label: string; amountCents: number }[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
};
