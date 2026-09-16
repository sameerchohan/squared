import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mintResetToken,
  readResetSubject,
  verifyResetToken,
} from "./password-reset";

// Two real bcrypt-shaped hashes. The values don't need to hash anything in
// particular — only to differ, the way they would after a reset.
const OLD_HASH = "$2b$12$abcdefghijklmnopqrstuuKJ2Xr0l9k9Mi2aGZ3zYQ1nQ0sT5uC6";
const NEW_HASH = "$2b$12$zyxwvutsrqponmlkjihgfeD8Lq1m2N3o4P5q6R7s8T9u0V1w2X3";

const ALICE = {
  id: "11111111-1111-4111-8111-111111111111",
  passwordHash: OLD_HASH,
};
const BOB = {
  id: "22222222-2222-4222-8222-222222222222",
  passwordHash: OLD_HASH,
};

let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret-for-password-reset";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

describe("password reset tokens", () => {
  it("verifies a freshly minted token for its own user", async () => {
    const token = await mintResetToken(ALICE);
    expect(await verifyResetToken(token, ALICE)).toBe(true);
  });

  it("names the user it was issued for", async () => {
    const token = await mintResetToken(ALICE);
    expect(readResetSubject(token)).toBe(ALICE.id);
  });

  it("stops verifying once the password hash changes", async () => {
    // This is the single-use guarantee: completing a reset writes a new hash,
    // which changes the derived signing key.
    const token = await mintResetToken(ALICE);
    expect(
      await verifyResetToken(token, { ...ALICE, passwordHash: NEW_HASH })
    ).toBe(false);
  });

  it("rejects a token replayed against a different account", async () => {
    // Both users share a password hash here, so only the subject binding can
    // be what rejects it.
    const token = await mintResetToken(ALICE);
    expect(await verifyResetToken(token, BOB)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await mintResetToken(ALICE);
    const [header, payload, signature] = token.split(".");
    const flipped = signature.startsWith("A")
      ? `B${signature.slice(1)}`
      : `A${signature.slice(1)}`;
    expect(
      await verifyResetToken(`${header}.${payload}.${flipped}`, ALICE)
    ).toBe(false);
  });

  it("rejects a token signed with a different server secret", async () => {
    const token = await mintResetToken(ALICE);
    process.env.JWT_SECRET = "a-completely-different-secret";
    expect(await verifyResetToken(token, ALICE)).toBe(false);
  });

  it("refuses to issue a token with no server secret", async () => {
    delete process.env.JWT_SECRET;
    await expect(mintResetToken(ALICE)).rejects.toThrow(/aren't configured/i);
  });

  describe("readResetSubject", () => {
    it("returns null for a string that isn't a JWT", () => {
      expect(readResetSubject("not-a-token")).toBeNull();
      expect(readResetSubject("")).toBeNull();
    });

    it("returns null when the subject isn't a uuid", async () => {
      // A malformed id must never reach Postgres: comparing it against a uuid
      // column errors, turning a bad link into a 500.
      const { SignJWT } = await import("jose");
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("'; drop table users; --")
        .setExpirationTime("1h")
        .sign(new Uint8Array(32));
      expect(readResetSubject(token)).toBeNull();
    });
  });
});
