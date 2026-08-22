import { headers } from "next/headers";

/**
 * In-memory rate limiting, shared by every brake in the app.
 *
 * In-memory on purpose: the app is a single process, and a restart clearing
 * the counters costs an abuser their progress, not us our safety. Every
 * limiter is a fixed window with a bounded key set, so a flood of unique
 * keys (random IPs, probe emails) cannot grow memory without limit.
 */
export type Limiter = {
  /** Counts one hit; true means the key is over its budget right now. */
  hit(key: string): boolean;
  /** True without counting — for read-only checks. */
  isLimited(key: string): boolean;
  /** Forgets a key — e.g. a correct password ends its failure streak. */
  clear(key: string): void;
};

export function makeLimiter({
  max,
  windowMs,
  maxKeys = 5000,
}: {
  max: number;
  windowMs: number;
  maxKeys?: number;
}): Limiter {
  const entries = new Map<string, { count: number; first: number }>();

  const sweep = (now: number) => {
    if (entries.size <= maxKeys) return;
    for (const [key, entry] of entries) {
      if (now - entry.first > windowMs) entries.delete(key);
    }
  };

  return {
    hit(key) {
      const now = Date.now();
      sweep(now);
      const entry = entries.get(key);
      if (!entry || now - entry.first > windowMs) {
        entries.set(key, { count: 1, first: now });
        return false;
      }
      entry.count += 1;
      return entry.count > max;
    },
    isLimited(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      if (Date.now() - entry.first > windowMs) {
        entries.delete(key);
        return false;
      }
      return entry.count >= max;
    },
    clear(key) {
      entries.delete(key);
    },
  };
}

/**
 * The caller's address as the reverse proxy reports it. Behind the NAS or a
 * cloud proxy the first X-Forwarded-For hop is the client; the constant
 * fallback means a missing header shares one bucket rather than none. The
 * header is spoofable by a caller that reaches the app directly — these
 * brakes are abuse dampers, not authentication, and every gate they guard
 * still checks the session.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}
