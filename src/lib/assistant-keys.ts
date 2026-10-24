import crypto from "node:crypto";

/**
 * Assistant keys, the pure half (assistant-auth.ts is the database half).
 *
 * A key reads `mbk_<assistant user id>_<43 random characters>`. The id lets
 * the server find the account before it knows the company (users is the one
 * table readable before a tenant is entered); the random part is the secret,
 * kept only as its SHA-256. Anything not of exactly this shape is refused
 * before a single query runs.
 */

/** What an admin may allow beyond reading. Reading orders, the board, contacts and products is always on. */
export const ASSISTANT_SCOPES = ["followup", "contacts", "prices"] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

const KEY_SHAPE = /^mbk_([1-9][0-9]{0,9})_([A-Za-z0-9_-]{43})$/;

export function newAssistantKey(userId: number): { key: string; hash: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  return { key: `mbk_${userId}_${secret}`, hash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** The key out of an `Authorization: Bearer …` header, or null. */
export function parseAssistantKey(header: string | null): { userId: number; secret: string } | null {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  const parts = match && KEY_SHAPE.exec(match[1]);
  if (!parts) return null;
  const userId = Number(parts[1]);
  return Number.isSafeInteger(userId) ? { userId, secret: parts[2] } : null;
}

/** Constant-time comparison of the presented secret against the stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Stored comma list → known scopes only; anything else is dropped, never granted. */
export function parseScopes(text: string): Set<AssistantScope> {
  const known = new Set<string>(ASSISTANT_SCOPES);
  return new Set(
    text
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is AssistantScope => known.has(s)),
  );
}

export function scopesText(scopes: Iterable<string>): string {
  const wanted = new Set(scopes);
  return ASSISTANT_SCOPES.filter((s) => wanted.has(s)).join(",");
}
