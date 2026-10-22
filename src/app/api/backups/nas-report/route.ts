import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { backupDir } from "@/lib/backups";
import { applyNasReport, checkNasAlarm, parseNasReport, readNasState, writeNasState } from "@/lib/nas-backup";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * POST /api/backups/nas-report — the NAS saying what it holds after a night's
 * pull (scripts/nas/mbarete-nas-backup.sh). Machine to machine: no session,
 * a shared token instead (NAS_REPORT_TOKEN, the same value on both ends).
 * Unset token = the endpoint does not exist. The worst a stolen token does
 * is make the panel show a wrong NAS status, so nothing more than a
 * constant-time comparison and a brake guards it.
 *
 *   Authorization: Bearer <NAS_REPORT_TOKEN>
 *   { "ok": true, "snapshot": "backup-20261022-050000", "files": 1234, "bytes": 5678, "kept": 31 }
 *   { "ok": false, "error": "ssh: connect to host … timed out" }
 */

const limiter = makeLimiter({ max: 60, windowMs: 60 * 60 * 1000 });

function tokenMatches(header: string | null, expected: string): boolean {
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return given.length > 0 && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.NAS_REPORT_TOKEN?.trim();
  if (!expected || !backupDir()) return new NextResponse("Not found", { status: 404 });
  if (limiter.hit("nas")) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  if (!tokenMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = parseNasReport(await request.json().catch(() => null));
  if (!report) return NextResponse.json({ error: "invalid" }, { status: 400 });

  await writeNasState(applyNasReport(await readNasState(), report, new Date()));
  // A failure is worth a mail now, not at the next hourly check.
  if (!report.ok) await checkNasAlarm().catch(() => {});
  return NextResponse.json({ ok: true });
}
