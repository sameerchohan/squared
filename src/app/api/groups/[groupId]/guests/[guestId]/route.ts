import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseGuestShares, groupGuests } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";
import { assertNameIsFree, assertSponsorIsMember } from "@/server/guests";

const updateGuestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sponsorUserId: z.uuid().optional(),
  })
  .refine((b) => b.name !== undefined || b.sponsorUserId !== undefined, {
    message: "Nothing to change",
  });

async function loadGuest(groupId: string, guestId: string) {
  const [guest] = await db
    .select()
    .from(groupGuests)
    .where(
      and(
        eq(groupGuests.id, guestId),
        eq(groupGuests.groupId, groupId),
        isNull(groupGuests.archivedAt)
      )
    )
    .limit(1);
  if (!guest) throw new ApiError(404, "Guest not found");
  return guest;
}

export const PATCH = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/guests/[guestId]">) => {
    const userId = await requireUserId();
    const { groupId, guestId } = await ctx.params;
    await requireGroupMember(userId, groupId);
    await loadGuest(groupId, guestId);

    const body = updateGuestSchema.parse(await req.json());
    if (body.sponsorUserId) {
      await assertSponsorIsMember(body.sponsorUserId, groupId);
    }
    if (body.name) {
      await assertNameIsFree(groupId, body.name, guestId);
    }

    // Reassigning a sponsor only changes who covers this guest from now on.
    // Past expenses keep the sponsor snapshotted on their own rows, because
    // what the ledger already charged is not ours to rewrite.
    const [guest] = await db
      .update(groupGuests)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.sponsorUserId ? { sponsorUserId: body.sponsorUserId } : {}),
      })
      .where(eq(groupGuests.id, guestId))
      .returning();

    return Response.json({ guest });
  }
);

export const DELETE = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/guests/[guestId]">) => {
    const userId = await requireUserId();
    const { groupId, guestId } = await ctx.params;
    await requireGroupMember(userId, groupId);
    await loadGuest(groupId, guestId);

    const [used] = await db
      .select({ id: expenseGuestShares.id })
      .from(expenseGuestShares)
      .where(eq(expenseGuestShares.guestId, guestId))
      .limit(1);

    // A guest who has been in an expense is archived, never deleted: their
    // name is what makes those rows readable later. One added by mistake and
    // never used leaves no trace.
    if (used) {
      await db
        .update(groupGuests)
        .set({ archivedAt: new Date() })
        .where(eq(groupGuests.id, guestId));
      return Response.json({ ok: true, archived: true });
    }

    await db.delete(groupGuests).where(eq(groupGuests.id, guestId));
    return Response.json({ ok: true, archived: false });
  }
);
