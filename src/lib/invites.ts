import crypto from "node:crypto";

/** Pure invite-token helpers, shared by the actions and their tests. */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Only the sha256 of a token is ever stored — a database leak must not
 *  hand out live invite links. */
export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Timestamps in the same "YYYY-MM-DD HH:MM:SS" UTC shape the schema uses. */
export const isoNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");
export const isoIn = (ms: number) =>
  new Date(Date.now() + ms).toISOString().slice(0, 19).replace("T", " ");
