import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/server/auth";
import { apiHandler, ApiError, isUniqueViolation } from "@/server/errors";

const registerSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const POST = apiHandler(async (req) => {
  const { email, name, password } = registerSchema.parse(await req.json());
  const passwordHash = await hashPassword(password);

  let user;
  try {
    [user] = await db
      .insert(users)
      .values({ email, name, passwordHash })
      .returning({ id: users.id, email: users.email, name: users.name });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "An account with that email already exists");
    }
    throw error;
  }

  await createSession(user.id);
  return Response.json({ user }, { status: 201 });
});
