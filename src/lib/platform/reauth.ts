/**
 * Step-up authentication for the platform panel.
 *
 * Holding a session is not enough to mutate tenants: plans, seats, module
 * switches and backups additionally require the operator's PASSWORD again,
 * recently. A hijacked browser tab or a forgotten signed-in machine can
 * then still look, but not touch — the blast radius of a stolen session
 * shrinks to read access for its lifetime.
 *
 * The marker lives in process memory, like every other brake in the app: a
 * restart simply asks the operator to type the password once more. TTL is
 * fifteen minutes of authority per confirmation, checked server-side on
 * every mutation — the panel UI only mirrors it.
 */

export const REAUTH_TTL_MS = 15 * 60 * 1000;

export type ReauthTracker = {
  /** Records a successful password confirmation for this user, now. */
  mark(userId: number): void;
  /** True while the last confirmation is younger than the TTL. */
  isFresh(userId: number): boolean;
  /** Drops a user's confirmation — e.g. when their password changes. */
  clear(userId: number): void;
};

export function makeReauthTracker(
  { ttlMs, now = Date.now }: { ttlMs: number; now?: () => number },
): ReauthTracker {
  const marks = new Map<number, number>();
  return {
    mark(userId) {
      marks.set(userId, now());
    },
    isFresh(userId) {
      const at = marks.get(userId);
      if (at === undefined) return false;
      if (now() - at >= ttlMs) {
        marks.delete(userId);
        return false;
      }
      return true;
    },
    clear(userId) {
      marks.delete(userId);
    },
  };
}

// One tracker per process, hot-reload-proof the same way the backup
// scheduler is — a dev reload must not mint a fresh, empty tracker while
// an old one still answers for earlier module instances.
const KEY = Symbol.for("mbarete.platform.reauth");
const g = globalThis as Record<symbol, unknown>;
if (!g[KEY]) g[KEY] = makeReauthTracker({ ttlMs: REAUTH_TTL_MS });
export const platformReauth = g[KEY] as ReauthTracker;
