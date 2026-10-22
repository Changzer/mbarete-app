import { NextResponse } from "next/server";
import { backupDir } from "@/lib/backups";
import { acceptPairedKey, checkPairing, isNasPublicKey, readPairing } from "@/lib/nas-backup";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * POST /api/backups/nas-pair — the NAS handing over its public key during
 * setup (scripts/nas/setup-nas.sh), so nobody has to copy a key between two
 * terminals. Open only while scripts/nas/setup-server.sh holds a pairing open
 * (twenty minutes, one use), and only for the one-time code it printed. The
 * answer carries the report token, which the NAS needs for its nightly reports.
 *
 *   { "code": "<from the server script>", "publicKey": "ssh-ed25519 AAAA… mbarete-nas" }
 */

const limiter = makeLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

export async function POST(request: Request) {
  if (!backupDir()) return new NextResponse("Not found", { status: 404 });
  if (limiter.hit("pair")) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { code?: unknown; publicKey?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const key = typeof body?.publicKey === "string" ? body.publicKey.trim() : "";

  const verdict = checkPairing(await readPairing(), code, Date.now());
  if (verdict === "closed") return NextResponse.json({ error: "no pairing is open — run setup-server.sh on the server" }, { status: 404 });
  if (verdict === "expired") return NextResponse.json({ error: "the pairing expired — run setup-server.sh again" }, { status: 410 });
  if (verdict === "wrong-code") return NextResponse.json({ error: "wrong pairing code" }, { status: 403 });
  if (!isNasPublicKey(key)) return NextResponse.json({ error: "not an ed25519 public key" }, { status: 400 });

  await acceptPairedKey(key);
  return NextResponse.json({ ok: true, reportToken: process.env.NAS_REPORT_TOKEN?.trim() ?? "" });
}
