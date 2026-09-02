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
  /** How many keys are currently held — the bound this must respect is maxKeys. */
  size(): number;
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
    // Still over after dropping expired windows: a flood of unique keys
    // inside ONE window (random probe emails, spoofed addresses). Forget
    // oldest-inserted counters until bounded — losing a counter mid-window
    // is an accepted cost of a hard memory ceiling; the endpoint the flood
    // is aimed at keeps counting the flood itself.
    for (const key of entries.keys()) {
      if (entries.size <= maxKeys) break;
      entries.delete(key);
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
    size() {
      return entries.size;
    },
  };
}

/**
 * The last hop of an X-Forwarded-For header: the address the nearest proxy
 * itself saw, which is the one it vouches for. Caddy (2.5+) drops the header
 * a client sends unless the client is a configured trusted proxy, then
 * appends the peer address — so the LAST hop is the proxy's word and the
 * FIRST is whatever the client chose to claim wherever a proxy is lenient.
 * Keying a limiter on the first hop lets one machine become a thousand.
 * Null when the header is absent or empty.
 */
export function lastForwardedHop(header: string | null | undefined): string | null {
  if (!header) return null;
  const hops = header
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : null;
}

/**
 * The caller's address as the reverse proxy reports it; the constant
 * fallback means a missing header shares one bucket rather than none. A
 * caller that reaches the app directly, bypassing the proxy, can still
 * write the header — these brakes are abuse dampers, not authentication,
 * and every gate they guard still checks the session. (If another proxy
 * is ever put in front of Caddy — a CDN, a tunnel — list it in Caddy's
 * trusted_proxies, or every visitor will share that proxy's address here.)
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return lastForwardedHop(h.get("x-forwarded-for")) ?? h.get("x-real-ip") ?? "unknown";
}
