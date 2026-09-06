import { compare, hash } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { ApiError } from "./errors";

const SESSION_COOKIE = "session";
const BCRYPT_ROUNDS = 12;

// A week by default. Sessions are not refreshed on use, so this is measured
// from sign-in: a deployment whose natural life is longer than a demo can
// raise it with SESSION_TTL_DAYS rather than signing everyone out mid-use.
// Anything unparseable, negative, or beyond a year falls back to the default
// instead of issuing a session that never expires.
function sessionTtlSeconds(): number {
  const days = Number(process.env.SESSION_TTL_DAYS);
  const valid = Number.isFinite(days) && days > 0 && days <= 365;
  return Math.round((valid ? days : 7) * 24 * 60 * 60);
}

function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // A 503 rather than a generic 500: the caller did nothing wrong and can
    // do nothing about it, and "Internal server error" on a *correct*
    // password sends whoever is debugging it looking at the password check.
    console.error("JWT_SECRET is not set — sessions cannot be issued");
    throw new ApiError(503, "Sessions aren't configured on this server yet.");
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return compare(password, passwordHash);
}

/** Signs a session JWT for the user and sets it as an httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  const ttlSeconds = sessionTtlSeconds();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(jwtSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** The authenticated user's id, or null for missing/invalid/expired tokens. */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), {
      algorithms: ["HS256"],
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** The authenticated user's id, or a 401 out of the API. */
export async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new ApiError(401, "Not signed in");
  }
  return userId;
}
