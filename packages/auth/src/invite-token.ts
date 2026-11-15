import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens are bearer secrets. Only their SHA-256 digest is persisted,
 * so a database dump cannot be replayed against the accept endpoint.
 *
 * 32 random bytes = 256 bits of entropy, base64url-encoded (43 chars). SHA-256
 * is enough here because the input is high-entropy: there is no dictionary to
 * attack, unlike a user password.
 */
export const INVITE_TOKEN_BYTES = 32;

export const generateInviteToken = (): string =>
  randomBytes(INVITE_TOKEN_BYTES).toString("base64url");

export const hashInviteToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Constant-time comparison for cases where a caller already holds both digests.
 * Lookup itself is an indexed equality on the hash, which is the normal path.
 */
export const inviteTokenDigestEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Emails are stored and compared in one canonical form. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
