import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { requireUserId } from "@/server/auth";
import { apiHandler } from "@/server/errors";

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const POST = apiHandler(async (req) => {
  const userId = await requireUserId();
  const { name } = createGroupSchema.parse(await req.json());

  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groups)
      .values({ name, createdBy: userId })
      .returning();
    await tx
      .insert(groupMembers)
      .values({ groupId: created.id, userId });
    return created;
  });

  return Response.json({ group }, { status: 201 });
});

export const GET = apiHandler(async () => {
  const userId = await requireUserId();

  const myGroupIds = db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));

  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      memberCount: sql<number>`count(*)::int`,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(inArray(groups.id, myGroupIds))
    .groupBy(groups.id)
    .orderBy(groups.createdAt);

  return Response.json({ groups: rows });
});
