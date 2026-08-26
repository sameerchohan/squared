import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  // Bounded so an oversized body can't burn bcrypt CPU on a doomed compare.
  password: z.string().min(1).max(72),
});

export const POST = apiHandler(async (req) => {
  const { email, password } = loginSchema.parse(await req.json());

  // Two buckets: one slows a single host spraying many accounts, the other
  // slows a distributed attack against one account.
  enforceRateLimit(`login-ip:${clientIp(req)}`, 20, 60_000);
  enforceRateLimit(`login-email:${email}`, 10, 60_000);

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
