// Validating and resolving an expense split, shared by create and edit so the
// two can never disagree about what a valid split is.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupGuests, groupMembers } from "@/db/schema";
import { CoverageError, MAX_SHARES_PER_PERSON } from "@/lib/coverage-rules";
import { computeShareRows, SplitError, type ShareRow } from "@/lib/splits";
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
  }),
  z.object({
    type: z.literal("percentage"),
    shares: z
      .array(z.object({ userId: z.uuid(), percent: z.number().nonnegative() }))
      .min(1),
  }),
]);

export type SplitInput = z.infer<typeof splitSchema>;

export type ResolvedSplit = {
  shares: ShareRow[];
  /** Guests counted in this expense, with the sponsor to record against them. */
  guests: { guestId: string; sponsorUserId: string }[];
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
    split.type === "equal" ? (split.guestIds ?? []) : []
  );

  try {
    const shares = computeShareRows(
      amountCents,
      split.type === "equal"
        ? { type: "equal", participants, guests }
        : split
    );
    return { shares, guests };
  } catch (error) {
    // A split that does not add up is the caller's mistake, not a server
    // fault, and the message is written to be shown to a person as-is.
    if (error instanceof CoverageError || error instanceof SplitError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
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
