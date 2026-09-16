import { createHash, timingSafeEqual } from "node:crypto";
import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { ApiError } from "./errors";

const RESET_TTL_SECONDS = 60 * 60;

/**
 * Password reset tokens, without a table to store them in.
 *
 * A reset token is a short-lived JWT signed with a key derived from the
 * user's *current* password hash. That one detail is what makes it single-use
 * by construction: completing a reset writes a new hash, the derived key
 * changes with it, and every token ever minted for that account stops
 * verifying — the one just spent, and any older link still sitting in the
 * mailbox. Changing a password the ordinary way invalidates them too.
 *
 * The alternative is a `password_reset_tokens` table: a row written on
 * request, read on use, marked spent, and swept afterwards, plus a migration
 * to deploy before the code that depends on it. This has none of those parts.
 * What it gives up is early revocation — a token cannot be cancelled before
 * it expires — and an hour is short enough that the difference is not worth a
 * table.
 *
 * bcrypt hashes embed a per-user salt, so the derived key differs per account
 * as well as per password; a token minted for one user cannot be replayed
 * against another even if the same password is shared.
 */
function resetKey(passwordHash: string): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Matches how sessions answer the same misconfiguration: the caller did
    // nothing wrong and can do nothing about it.
    console.error("JWT_SECRET is not set — password resets cannot be issued");
    throw new ApiError(
      503,
      "Password resets aren't configured on this server yet."
    );
  }
  return new Uint8Array(
    createHash("sha256").update(`${secret}:pwreset:${passwordHash}`).digest()
  );
}

// async so a missing JWT_SECRET rejects rather than throwing synchronously
// out of a function that otherwise returns a promise.
export async function mintResetToken(user: {
  id: string;
  passwordHash: string;
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${RESET_TTL_SECONDS}s`)
    .sign(resetKey(user.passwordHash));
}

/**
 * The user id a token claims to be for, read *without* verifying it — the
 * signing key depends on that user's password hash, so there is no way to
 * check the signature before knowing which row to load. Nothing is trusted
 * on the strength of this: it only selects the candidate whose hash then has
 * to validate the signature. Anything that isn't a well-formed uuid is
 * rejected here rather than handed to Postgres, which would error on a
 * malformed uuid comparison and turn a bad link into a 500.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readResetSubject(token: string): string | null {
  try {
    const { sub } = decodeJwt(token);
    return typeof sub === "string" && UUID_RE.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

/** True when the token is intact, unexpired, and issued for this exact user. */
export async function verifyResetToken(
  token: string,
  user: { id: string; passwordHash: string }
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, resetKey(user.passwordHash), {
      algorithms: ["HS256"],
      subject: user.id,
    });
    // jwtVerify already enforces the subject; comparing again in constant
    // time costs nothing and keeps the guarantee local to this function.
    const claimed = Buffer.from(payload.sub ?? "");
    const expected = Buffer.from(user.id);
    return (
      claimed.length === expected.length && timingSafeEqual(claimed, expected)
    );
  } catch {
    return false;
  }
}
