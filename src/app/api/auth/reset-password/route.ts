import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/server/auth";
import { apiHandler, ApiError } from "@/server/errors";
import { readResetSubject, verifyResetToken } from "@/server/password-reset";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

const resetSchema = z.object({
  token: z.string().min(1).max(4096),
  // Same bound as registration: bcrypt silently truncates past 72 bytes, so
  // the input is capped rather than letting two different long passwords
  // authenticate the same account.
  password: z.string().min(8).max(72),
});

// One message for every way a link can fail to work. Distinguishing "expired"
// from "already used" from "not a real token" tells whoever is holding a
// token they shouldn't have exactly how close they are.
const BAD_TOKEN = "That reset link is invalid or has already been used.";

export const POST = apiHandler(async (req) => {
  enforceRateLimit(`reset-ip:${clientIp(req)}`, 10, 60_000);
  const { token, password } = resetSchema.parse(await req.json());

  const userId = readResetSubject(token);
  if (!userId) {
    throw new ApiError(400, BAD_TOKEN);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !(await verifyResetToken(token, user))) {
    throw new ApiError(400, BAD_TOKEN);
  }

  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

  // Writing the new hash is what spends the token: the signing key is derived
  // from the old one, so this link — and any other reset link outstanding for
  // this account — no longer verifies.
  //
  // Sessions issued before now do survive, because they are stateless JWTs
  // with nothing server-side to revoke. That is a known limitation of the
  // session design rather than of this route, and it is recorded as such in
  // the README.
  await createSession(user.id);

  return Response.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
});
