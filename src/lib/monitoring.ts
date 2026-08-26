import { db } from "@/db";
import { sql } from "drizzle-orm";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * Ops visibility, self-contained — no external error service.
 *
 * Three pieces, all wired in instrumentation.ts:
 * - recordError(): every server error lands in a deduplicated in-memory log
 *   (the platform panel shows the last 24h), and the FIRST occurrence of a
 *   new error emails the operator — throttled hard, so a crash loop costs
 *   one email, not a thousand.
 * - checkHealth(): the truth behind /api/health — can the database answer.
 * - startHeartbeat(): a dead-man's switch for a server the internet cannot
 *   reach INTO (a NAS behind NAT): while healthy, the app pings OUT to
 *   HEARTBEAT_URL every minute; when the pings stop — crash, database down,
 *   power cut — the receiving service (healthchecks.io, Uptime Kuma, any
 *   ping-URL monitor) raises the alarm. No pings configured, no monitoring:
 *   the feature is off exactly like backups without BACKUP_DIR.
 *
 * In-memory on purpose, like every brake in the app: a restart clears the
 * log, and the restart itself is what the heartbeat monitor reports.
 */

export type ErrorEntry = {
  signature: string;
  message: string;
  stack: string;
  source: string;
  count: number;
  firstAt: number;
  lastAt: number;
};

const MAX_ERRORS = 200;

type Mailer = (subject: string, text: string) => void;

export function makeErrorLog({
  now = Date.now,
  mail,
}: {
  now?: () => number;
  mail?: Mailer;
} = {}) {
  const entries = new Map<string, ErrorEntry>();
  // One alert per distinct error per 6 hours, five per hour across all of
  // them — a bad deploy tells the operator once, not once per request.
  const perSignature = makeLimiter({ max: 1, windowMs: 6 * 60 * 60 * 1000 });
  const global = makeLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

  return {
    record(source: string, err: unknown): ErrorEntry {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? "") : "";
      // Same source + message + top frame = same defect, however often it fires.
      const topFrame = stack.split("\n")[1]?.trim() ?? "";
      const signature = `${source}|${message}|${topFrame}`;

      const existing = entries.get(signature);
      const entry: ErrorEntry = existing
        ? { ...existing, count: existing.count + 1, lastAt: now() }
        : { signature, message, stack, source, count: 1, firstAt: now(), lastAt: now() };
      entries.set(signature, entry);

      if (entries.size > MAX_ERRORS) {
        // Forget whichever defect has been quiet longest.
        let oldest: string | null = null;
        let oldestAt = Infinity;
        for (const [key, e] of entries) {
          if (e.lastAt < oldestAt) {
            oldestAt = e.lastAt;
            oldest = key;
          }
        }
        if (oldest) entries.delete(oldest);
      }

      if (mail && !perSignature.hit(signature) && !global.hit("all")) {
        mail(
          `[mbarete] server error: ${message.slice(0, 120)}`,
          `${source} error, seen ${entry.count} time(s) since ${new Date(entry.firstAt).toISOString()}:\n\n` +
            `${message}\n\n${stack}\n\n` +
            `Further alerts for this error are muted for 6 hours; the platform panel shows the live list.`,
        );
      }
      return entry;
    },
    recent(withinMs: number): ErrorEntry[] {
      const cutoff = now() - withinMs;
      return [...entries.values()]
        .filter((e) => e.lastAt >= cutoff)
        .sort((a, b) => b.lastAt - a.lastAt);
    },
  };
}

function operatorEmail(): string | null {
  return (
    process.env.ALERT_EMAIL ||
    process.env.PLATFORM_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    null
  );
}

/** Fire-and-forget: an alert that fails must never take a request with it. */
function alertMailer(subject: string, text: string): void {
  const to = operatorEmail();
  if (!to || !isMailConfigured()) return;
  void sendMail({ to, subject, text }).catch(() => {});
}

// One log per process, hot-reload-proof like the other singletons.
const LOG_KEY = Symbol.for("mbarete.monitoring.errors");
const g = globalThis as Record<symbol, unknown>;
if (!g[LOG_KEY]) g[LOG_KEY] = makeErrorLog({ mail: alertMailer });
const errorLog = g[LOG_KEY] as ReturnType<typeof makeErrorLog>;

export function recordError(source: string, err: unknown): void {
  try {
    const entry = errorLog.record(source, err);
    // Every occurrence still reaches the container log for `docker compose logs`.
    if (entry.count === 1) console.error(`[error] ${source}:`, err);
  } catch {
    // The reporter must never be the thing that crashes.
  }
}

export function recentErrors(withinMs = 24 * 60 * 60 * 1000): ErrorEntry[] {
  return errorLog.recent(withinMs);
}

/** Can the database answer, within a hard deadline. */
export async function checkHealth(): Promise<{ ok: boolean; dbMs: number | null }> {
  const started = Date.now();
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 5000)),
    ]);
    return { ok: true, dbMs: Date.now() - started };
  } catch {
    return { ok: false, dbMs: null };
  }
}

const HEARTBEAT_KEY = Symbol.for("mbarete.monitoring.heartbeat");

export function startHeartbeat() {
  if (g[HEARTBEAT_KEY]) return;
  g[HEARTBEAT_KEY] = true;

  const url = process.env.HEARTBEAT_URL?.trim();
  if (!url) {
    console.log("[monitor] HEARTBEAT_URL not set — uptime pings off");
    return;
  }
  const interval = Math.max(30, Number(process.env.HEARTBEAT_INTERVAL_SECONDS) || 60) * 1000;

  let lastOk: boolean | null = null;
  const beat = async () => {
    const health = await checkHealth();
    if (health.ok !== lastOk) {
      // State changes are worth a log line; steady states are not.
      console.log(`[monitor] health ${health.ok ? "ok" : "FAILING"} — pings ${health.ok ? "on" : "paused"}`);
      lastOk = health.ok;
    }
    // Unhealthy = deliberately silent: the missed ping IS the alarm.
    if (!health.ok) return;
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) }).catch(() => {});
  };

  void beat();
  setInterval(() => void beat(), interval);
  console.log(`[monitor] heartbeat every ${interval / 1000}s while healthy`);
}

/**
 * Observe process-level failures without changing crash semantics: the
 * monitor hook sees an uncaught exception and the process still dies (and
 * the container restarts, and the heartbeat gap tells the operator).
 * Unhandled rejections are recorded and re-thrown so they keep crashing
 * exactly as Node would have crashed them.
 */
export function registerProcessErrorHandlers() {
  const key = Symbol.for("mbarete.monitoring.process");
  if (g[key]) return;
  g[key] = true;
  process.on("uncaughtExceptionMonitor", (err) => recordError("process", err));
  process.on("unhandledRejection", (reason) => {
    recordError("process", reason);
    throw reason;
  });
}
