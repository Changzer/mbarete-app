import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * GET /api/nas/<file> — the NAS side of the backup setup, downloadable by the
 * NAS itself (`curl … | sh`), since the repository is private. Two fixed
 * files, no secrets in either; anything else is a 404.
 */

const FILES = new Set(["setup-nas.sh", "mbarete-nas-backup.sh"]);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILES.has(file)) return new NextResponse("Not found", { status: 404 });
  const body = await fs.readFile(path.join(process.cwd(), "scripts", "nas", file), "utf8").catch(() => null);
  if (body === null) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body, {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
