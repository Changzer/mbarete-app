import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BACKUP_NAME_RE, backupDir } from "@/lib/backups";

/**
 * The NAS copy, as the server sees it. The NAS pulls each night's snapshot
 * (scripts/nas/mbarete-nas-backup.sh, docs/NAS-BACKUP.md), checks every file
 * against SHA256SUMS and then reports here: which snapshot it now holds,
 * verified, or why it could not get one. The server cannot look into the
 * NAS — it sits behind the office router — so this report is the only way
 * the panel can say "the copy at home is fresh", and the only way silence
 * can raise an alarm.
 *
 * Kept as one small JSON file beside the backups it describes: no table, no
 * migration, and it travels with nothing (the NAS copies backup-* folders only).
 */

export const NAS_REPORT_FILE = "nas-report.json";

const reportInput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    snapshot: z.string().regex(BACKUP_NAME_RE),
    files: z.number().int().min(0).max(10_000_000),
    bytes: z.number().int().min(0),
    kept: z.number().int().min(1).max(10_000),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().trim().min(1).max(500),
  }),
]);

export type NasReportInput = z.infer<typeof reportInput>;

export type NasState = {
  lastOk: { snapshot: string; files: number; bytes: number; kept: number; at: string } | null;
  lastFailure: { error: string; at: string } | null;
  /** When the operator was last emailed about the NAS copy; throttles the alarm. */
  alertedAt: string | null;
};

export function parseNasReport(body: unknown): NasReportInput | null {
  const parsed = reportInput.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** A success clears the failure it follows; a failure keeps the last good copy on record. */
export function applyNasReport(state: NasState | null, report: NasReportInput, now: Date): NasState {
  const base: NasState = state ?? { lastOk: null, lastFailure: null, alertedAt: null };
  const at = now.toISOString();
  if (report.ok) {
    return {
      ...base,
      lastOk: { snapshot: report.snapshot, files: report.files, bytes: report.bytes, kept: report.kept, at },
      lastFailure: null,
    };
  }
  return { ...base, lastFailure: { error: report.error, at } };
}

/** backup-YYYYMMDD-HHMMSS is a UTC instant; null for anything else. */
export function snapshotTimeMs(name: string): number | null {
  const m = /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(ms) ? null : ms;
}

export function staleHours(): number {
  const h = Number(process.env.NAS_STALE_HOURS ?? 48);
  return Number.isFinite(h) && h >= 6 ? h : 48;
}

export type NasHealth =
  | { level: "off" }
  | { level: "ok" | "stale" | "failing"; snapshot: string | null; ageHours: number | null; state: NasState };

/**
 * Off until the first report arrives. Stale when the newest copy on the NAS
 * was TAKEN more than `staleH` hours ago — which covers both a NAS that stopped
 * pulling and a server that stopped backing up. Failing when the last word
 * from the NAS was a failure, however fresh the copy before it.
 */
export function nasHealth(state: NasState | null, nowMs: number, staleH = staleHours()): NasHealth {
  if (!state || (!state.lastOk && !state.lastFailure)) return { level: "off" };
  const snapshot = state.lastOk?.snapshot ?? null;
  const taken = snapshot ? snapshotTimeMs(snapshot) : null;
  const ageHours = taken === null ? null : Math.floor((nowMs - taken) / 3_600_000);
  if (state.lastFailure) return { level: "failing", snapshot, ageHours, state };
  if (ageHours === null || ageHours >= staleH) return { level: "stale", snapshot, ageHours, state };
  return { level: "ok", snapshot, ageHours, state };
}

/** One email a day at most while the NAS copy is in trouble. */
export function shouldAlert(health: NasHealth, alertedAt: string | null, nowMs: number): boolean {
  if (health.level !== "stale" && health.level !== "failing") return false;
  if (!alertedAt) return true;
  return nowMs - Date.parse(alertedAt) >= 24 * 3_600_000;
}

function reportPath(): string | null {
  const dir = backupDir();
  return dir ? path.join(dir, NAS_REPORT_FILE) : null;
}

export async function readNasState(): Promise<NasState | null> {
  const file = reportPath();
  if (!file) return null;
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as NasState;
  } catch {
    return null;
  }
}

/** Written whole and renamed into place: a reader never sees half a report. */
export async function writeNasState(state: NasState): Promise<void> {
  const file = reportPath();
  if (!file) throw new Error("BACKUP_DIR not set");
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, file);
}

export function describeNasTrouble(health: NasHealth): { subject: string; text: string } | null {
  if (health.level === "failing") {
    return {
      subject: "Mbarete: the NAS backup failed",
      text:
        `The NAS could not fetch tonight's backup from the server.\n\n` +
        `Reason it gave: ${health.state.lastFailure?.error}\n\n` +
        `Newest copy safely on the NAS: ${health.snapshot ?? "none yet"}` +
        `${health.ageHours !== null ? ` (${health.ageHours} hours old)` : ""}.\n\n` +
        `It retries on its own; if this mail comes again tomorrow, see docs/NAS-BACKUP.md, "When the email arrives".`,
    };
  }
  if (health.level === "stale") {
    return {
      subject: "Mbarete: no fresh backup on the NAS",
      text:
        `The newest copy on the NAS is ${health.snapshot ?? "unknown"}` +
        `${health.ageHours !== null ? `, ${health.ageHours} hours old` : ""}.\n\n` +
        `Either the NAS has stopped fetching (off, offline, its scheduled job gone) or the server has stopped ` +
        `making its nightly backup (the platform panel says which). See docs/NAS-BACKUP.md, "When the email arrives".`,
    };
  }
  return null;
}

/**
 * Mails the operator when the NAS copy is stale or failing, at most once a
 * day; the throttle lives in the report file, so a restart does not re-send.
 */
export async function checkNasAlarm(nowMs = Date.now()): Promise<void> {
  const state = await readNasState();
  const health = nasHealth(state, nowMs);
  if (!state || !shouldAlert(health, state.alertedAt, nowMs)) return;
  const message = describeNasTrouble(health);
  if (!message) return;
  const { alertOperator } = await import("@/lib/monitoring");
  if (alertOperator(message.subject, message.text)) {
    await writeNasState({ ...state, alertedAt: new Date(nowMs).toISOString() }).catch(() => {});
  }
}

const WATCH_KEY = Symbol.for("mbarete.nas.watch");

/** Hourly, from boot: is the copy at home still fresh. Silent until the NAS first reports. */
export function startNasWatch() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[WATCH_KEY] || !backupDir()) return;
  g[WATCH_KEY] = true;
  setInterval(() => void checkNasAlarm().catch(() => {}), 3_600_000);
}

// --- pairing: the NAS hands its key over without anyone copying it ----------
//
// scripts/nas/setup-server.sh opens a pairing for twenty minutes by writing a
// one-time code into BACKUP_DIR and prints the one command to paste on the
// NAS. The NAS posts its public key with that code (POST
// /api/backups/nas-pair); the app drops it beside the code and closes the
// pairing; the server script, waiting as root, installs the key read-only.
// The app never touches SSH itself — it only passes a public key along.

export const NAS_PAIR_FILE = ".nas-pair.json";
export const NAS_PAIR_KEY_FILE = ".nas-pair-key";

const ED25519_PUBLIC_KEY = /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}( [A-Za-z0-9@._-]{1,64})?$/;

/** One ed25519 public key on one line, an optional plain comment — nothing else can ride along. */
export function isNasPublicKey(key: string): boolean {
  return ED25519_PUBLIC_KEY.test(key);
}

export type NasPairing = { code: string; expiresAt: string };

export function checkPairing(
  pairing: NasPairing | null,
  code: string,
  nowMs: number,
): "ok" | "closed" | "expired" | "wrong-code" {
  if (!pairing || typeof pairing.code !== "string" || pairing.code.length < 16) return "closed";
  if (!(Date.parse(pairing.expiresAt) > nowMs)) return "expired";
  const a = crypto.createHash("sha256").update(code).digest();
  const b = crypto.createHash("sha256").update(pairing.code).digest();
  return crypto.timingSafeEqual(a, b) ? "ok" : "wrong-code";
}

export async function readPairing(): Promise<NasPairing | null> {
  const dir = backupDir();
  if (!dir) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dir, NAS_PAIR_FILE), "utf8")) as NasPairing;
  } catch {
    return null;
  }
}

/** Hands the key to the waiting server script and closes the pairing: the code works once. */
export async function acceptPairedKey(key: string): Promise<void> {
  const dir = backupDir();
  if (!dir) throw new Error("BACKUP_DIR not set");
  const file = path.join(dir, NAS_PAIR_KEY_FILE);
  await fs.writeFile(`${file}.tmp`, `${key}\n`, { mode: 0o644 });
  await fs.rename(`${file}.tmp`, file);
  await fs.rm(path.join(dir, NAS_PAIR_FILE), { force: true });
}
