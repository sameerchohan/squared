// Rules about group guests, shared by the guest routes.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupGuests, groupMembers } from "@/db/schema";
import { ApiError } from "./errors";

/** A guest's sponsor has to be someone who can actually be charged. */
export async function assertSponsorIsMember(
  sponsorUserId: string,
  groupId: string
): Promise<void> {
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, sponsorUserId)
      )
    )
    .limit(1);
  if (!row) {
    throw new ApiError(400, "Whoever covers a guest has to be in this group");
  }
}

/**
 * Reject a name already taken by a live guest here. Two people called Sara on
 * one trip is a mistake far more often than it is the truth, and the split
 * screen would be unreadable either way. Archived guests do not reserve their
 * name, so a removed guest can be added back.
 */
export async function assertNameIsFree(
  groupId: string,
  name: string,
  exceptGuestId?: string
): Promise<void> {
  const clashes = await db
    .select({ id: groupGuests.id })
    .from(groupGuests)
    .where(
      and(
        eq(groupGuests.groupId, groupId),
        isNull(groupGuests.archivedAt),
        sql`lower(${groupGuests.name}) = lower(${name})`
      )
    );
  if (clashes.some((c) => c.id !== exceptGuestId)) {
    throw new ApiError(409, `There is already a guest called ${name} here`);
  }
}
