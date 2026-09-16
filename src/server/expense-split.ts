// Validating and resolving an expense split, shared by create and edit so the
// two can never disagree about what a valid split is.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  groupGuests,
  groupMembers,
  type StoredItemization,
} from "@/db/schema";
import { CoverageError, MAX_SHARES_PER_PERSON } from "@/lib/coverage-rules";
import { computeShareRows, SplitError, type ShareRow } from "@/lib/splits";
import { ReceiptError, splitReceipt } from "@/lib/receipt-split";
import { parseMoneySum } from "@/lib/format";
import { ApiError } from "./errors";

// A participant may arrive as a bare id, which still means one share. Older
// clients send only that shape, and a phone with the previous bundle loaded
// should not start failing mid-trip because the server moved on.
const equalParticipantSchema = z.union([
  z.uuid(),
  z.object({
    userId: z.uuid(),
    shares: z.number().int().min(0).max(MAX_SHARES_PER_PERSON).optional(),
    coveredBy: z.uuid().nullish(),
  }),
]);

export const splitSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("equal"),
    participants: z.array(equalParticipantSchema).min(1),
    guestIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    type: z.literal("exact"),
    shares: z
      .array(
        z.object({
          userId: z.uuid(),
          amountCents: z.number().int().nonnegative(),
        })
      )
      .min(1),
    // An itemised bill can include guests. Their money is already inside their
    // sponsor's amount by the time it gets here, since a guest has no row of
    // their own to put it in; recording them keeps the expense readable.
    guestIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    type: z.literal("percentage"),
    shares: z
      .array(z.object({ userId: z.uuid(), percent: z.number().nonnegative() }))
      .min(1),
  }),
  // What was typed into the itemised form. The browser sends the working, not
  // the answer: the server does the arithmetic itself, so what is stored can
  // never drift from what the numbers actually come to.
  z.object({
    type: z.literal("itemized"),
    individual: z
      .array(
        z.object({
          participantId: z.uuid(),
          amountCents: z.number().int().nonnegative(),
          entry: z.string().trim().max(60).nullish(),
        })
      )
      .min(1),
    items: z
      .array(
        z.object({
          label: z.string().trim().max(60).nullish(),
          amountCents: z.number().int().nonnegative(),
          sharedBy: z.array(z.uuid()),
        })
      )
      .max(100),
    taxCents: z.number().int().nonnegative(),
    tipCents: z.number().int().nonnegative(),
    discountCents: z.number().int().nonnegative(),
  }),
]);

export type SplitInput = z.infer<typeof splitSchema>;

export type ResolvedSplit = {
  shares: ShareRow[];
  /** Guests counted in this expense, with the sponsor to record against them. */
  guests: { guestId: string; sponsorUserId: string }[];
  /** What gets written to expenses.split_type. */
  splitType: "equal" | "exact" | "percentage";
  /** Set when the server worked the total out rather than being told it. */
  amountCents?: number;
  /** The working, kept so the expense can be reopened as it was filled in. */
  itemization?: StoredItemization;
};

/**
 * Check that everyone named belongs to this group, resolve guests to their
 * sponsors, and compute the rows to store.
 *
 * Guest portions are folded into their sponsor's share here. Nothing further
 * down the stack learns that guests exist: the balance engine, debt
 * simplification and Stripe payouts only ever see a member who owes more.
 */
export async function resolveSplit(
  groupId: string,
  paidBy: string,
  amountCents: number,
  split: SplitInput
): Promise<ResolvedSplit> {
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const memberIds = new Set(memberRows.map((m) => m.userId));

  if (split.type === "itemized") {
    return resolveItemized(groupId, paidBy, memberIds, split);
  }

  const participants =
    split.type === "equal"
      ? split.participants.map((p) =>
          typeof p === "string"
            ? { userId: p }
            : {
                userId: p.userId,
                shares: p.shares,
                coveredBy: p.coveredBy ?? undefined,
              }
        )
      : [];

  const namedIds =
    split.type === "equal"
      ? [
          ...participants.map((p) => p.userId),
          ...participants.flatMap((p) => (p.coveredBy ? [p.coveredBy] : [])),
        ]
      : split.shares.map((s) => s.userId);

  for (const id of [paidBy, ...namedIds]) {
    if (!memberIds.has(id)) {
      throw new ApiError(400, "All participants must be group members");
    }
  }

  const guests = await resolveGuests(
    groupId,
    split.type === "percentage" ? [] : (split.guestIds ?? [])
  );

  // On an equal split the coverage rules check this while working out weights.
  // On an exact one there are no weights to work out, so check it here rather
  // than let a guest be recorded against somebody who is not even paying.
  if (split.type === "exact") {
    const paying = new Set(split.shares.map((s) => s.userId));
    for (const guest of guests) {
      if (!paying.has(guest.sponsorUserId)) {
        throw new ApiError(
          400,
          "Whoever covers a guest must be listed in this expense"
        );
      }
    }
  }

  try {
    const shares = computeShareRows(
      amountCents,
      split.type === "equal"
        ? { type: "equal", participants, guests }
        : split
    );
    return { shares, guests, splitType: split.type };
  } catch (error) {
    // A split that does not add up is the caller's mistake, not a server
    // fault, and the message is written to be shown to a person as-is.
    if (error instanceof CoverageError || error instanceof SplitError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
}

/**
 * Work an itemised bill out from what was typed in.
 *
 * Every participant is a member or a guest of this group. Guests are looked up
 * including archived ones, so an expense recorded months ago still opens and
 * saves; a guest who has appeared in an expense is archived rather than
 * deleted precisely so this keeps working.
 *
 * A guest cannot hold a balance, so once the arithmetic is done their money is
 * moved onto whoever covers them. That happens after the split, not before, so
 * the itemisation keeps each person's own figures and the total is only ever
 * regrouped, never recalculated.
 */
async function resolveItemized(
  groupId: string,
  paidBy: string,
  memberIds: Set<string>,
  split: Extract<SplitInput, { type: "itemized" }>
): Promise<ResolvedSplit> {
  if (!memberIds.has(paidBy)) {
    throw new ApiError(400, "All participants must be group members");
  }

  const guestRows = await db
    .select({ id: groupGuests.id, sponsorUserId: groupGuests.sponsorUserId })
    .from(groupGuests)
    .where(eq(groupGuests.groupId, groupId));
  const sponsorOf = new Map(guestRows.map((g) => [g.id, g.sponsorUserId]));

  const listed = new Set(split.individual.map((o) => o.participantId));
  if (listed.size !== split.individual.length) {
    throw new ApiError(400, "A person appears more than once on this bill");
  }
  for (const id of listed) {
    if (!memberIds.has(id) && !sponsorOf.has(id)) {
      throw new ApiError(400, "All participants must be group members");
    }
  }
  // A kept expression is only ever a record of how the number was reached, so
  // it has to still reach it. Storing one that says something else would put a
  // figure on screen that disagrees with the split it came from.
  for (const line of split.individual) {
    if (line.entry == null || line.entry === "") continue;
    if (parseMoneySum(line.entry) !== line.amountCents) {
      throw new ApiError(400, "An amount does not match what it adds up to");
    }
  }

  for (const item of split.items) {
    for (const id of item.sharedBy) {
      if (!listed.has(id)) {
        throw new ApiError(400, "Somebody sharing an item is not on this bill");
      }
    }
  }

  let breakdown;
  try {
    breakdown = splitReceipt(
      split.individual.map((o) => ({
        userId: o.participantId,
        subtotalCents: o.amountCents,
      })),
      split.items.map((item) => ({
        label: item.label ?? undefined,
        amountCents: item.amountCents,
        sharedBy: item.sharedBy,
      })),
      split.taxCents,
      split.tipCents,
      split.discountCents
    );
  } catch (error) {
    if (error instanceof ReceiptError) throw new ApiError(400, error.message);
    throw error;
  }

  if (breakdown.totalCents > 99_999_999) {
    throw new ApiError(400, "That is more than one expense can hold");
  }

  const owedByMember = new Map<string, number>();
  for (const line of breakdown.lines) {
    const owner = sponsorOf.get(line.userId) ?? line.userId;
    owedByMember.set(owner, (owedByMember.get(owner) ?? 0) + line.owedCents);
  }

  const shares: ShareRow[] = [...owedByMember]
    .filter(([, cents]) => cents > 0)
    .map(([userId, owedCents]) => ({
      userId,
      owedCents,
      shareCount: 1,
      coveredBy: null,
    }));
  if (shares.length === 0) {
    throw new ApiError(400, "Nobody is paying for this");
  }

  const guests = breakdown.lines
    .filter((line) => sponsorOf.has(line.userId) && line.subtotalCents > 0)
    .map((line) => ({
      guestId: line.userId,
      sponsorUserId: sponsorOf.get(line.userId)!,
    }));

  return {
    shares,
    guests,
    splitType: "exact",
    amountCents: breakdown.totalCents,
    itemization: {
      version: 1,
      individual: split.individual.map((line) => ({
        participantId: line.participantId,
        amountCents: line.amountCents,
        entry: line.entry || null,
      })),
      items: split.items.map((item) => ({
        label: item.label?.trim() || null,
        amountCents: item.amountCents,
        sharedBy: item.sharedBy,
      })),
      taxCents: split.taxCents,
      tipCents: split.tipCents,
      discountCents: split.discountCents,
    },
  };
}

/** Look up guests by id, refusing any that aren't a live guest of this group. */
async function resolveGuests(
  groupId: string,
  guestIds: string[]
): Promise<{ guestId: string; sponsorUserId: string }[]> {
  if (guestIds.length === 0) return [];

  const unique = [...new Set(guestIds)];
  if (unique.length !== guestIds.length) {
    throw new ApiError(400, "A guest appears more than once in the split");
  }

  const rows = await db
    .select({ id: groupGuests.id, sponsorUserId: groupGuests.sponsorUserId })
    .from(groupGuests)
    .where(
      and(
        eq(groupGuests.groupId, groupId),
        isNull(groupGuests.archivedAt),
        inArray(groupGuests.id, unique)
      )
    );

  if (rows.length !== unique.length) {
    throw new ApiError(400, "Every guest must belong to this group");
  }

  return rows.map((r) => ({ guestId: r.id, sponsorUserId: r.sponsorUserId }));
}
