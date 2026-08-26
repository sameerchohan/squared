import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

export const POST = apiHandler(async (req) => {
  const { email, password } = loginSchema.parse(await req.json());

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same error either way: don't reveal whether the email is registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Incorrect email or password");
  }

  await createSession(user.id);
  return Response.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
});
