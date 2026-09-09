import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupGuests, users } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { assertNameIsFree, assertSponsorIsMember } from "@/server/guests";

const createGuestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sponsorUserId: z.uuid(),
});

export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/guests">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const guests = await db
      .select({
        id: groupGuests.id,
        name: groupGuests.name,
        sponsorUserId: groupGuests.sponsorUserId,
        sponsorName: users.name,
        createdAt: groupGuests.createdAt,
      })
      .from(groupGuests)
      .innerJoin(users, eq(users.id, groupGuests.sponsorUserId))
      .where(
        and(eq(groupGuests.groupId, groupId), isNull(groupGuests.archivedAt))
      )
      .orderBy(asc(groupGuests.createdAt));

    return Response.json({ guests });
  }
);

export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/guests">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    const body = createGuestSchema.parse(await req.json());
    await assertSponsorIsMember(body.sponsorUserId, groupId);
    await assertNameIsFree(groupId, body.name);

    const [guest] = await db
      .insert(groupGuests)
      .values({
        groupId,
        name: body.name,
        sponsorUserId: body.sponsorUserId,
      })
      .returning();

    return Response.json({ guest }, { status: 201 });
  }
);

