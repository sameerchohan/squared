import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { appUrl } from "@/server/config";
import { apiHandler } from "@/server/errors";
import { sendPasswordResetEmail } from "@/server/mailer";
import { mintResetToken } from "@/server/password-reset";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

const forgotSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
});

export const POST = apiHandler(async (req) => {
  const { email } = forgotSchema.parse(await req.json());

  // Two buckets, as with login: one slows a host working through a list of
  // addresses, the other stops one address being mailed repeatedly by
  // someone using the endpoint to pester its owner.
  enforceRateLimit(`forgot-ip:${clientIp(req)}`, 10, 60_000);
  enforceRateLimit(`forgot-email:${email}`, 3, 15 * 60_000);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user) {
    const token = await mintResetToken(user);
    const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, link });
    } catch (error) {
      // A delivery failure must not change the response. Letting it become a
      // 500 would answer, for anyone watching status codes, the exact
      // question the identical success body is here to refuse.
      console.error("Password reset delivery failed:", error);
    }
  }

  // The same answer whether or not the address is registered. Anything else
  // turns this endpoint into a way to enumerate accounts, and an address
  // being registered is itself worth not disclosing.
  //
  // The response does still arrive sooner for an unknown address, since no
  // mail is sent for one. Closing that gap properly means moving delivery
  // off the request path; the per-address limit above is what keeps it from
  // being a practical oracle in the meantime.
  return Response.json({ ok: true });
});
