import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/monitoring";

/**
 * GET /api/health — is this install actually alive: process up AND the
 * database answering. Docker's healthcheck polls it (a hung container gets
 * restarted), the heartbeat gates on the same check, and any LAN monitor
 * can point at it. Deliberately unauthenticated and deliberately mute:
 * status code and a boolean, no versions, no names, nothing to fingerprint.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkHealth();
  return NextResponse.json(
    { ok: health.ok },
    { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
