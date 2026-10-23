import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/verification-mail";

/**
 * GET /api/assistant/skill — the OpenClaw skill file for this app
 * (integrations/openclaw/mbarete/SKILL.md) with the app's address filled in.
 * No secret in it: the key lives in the assistant's own settings.
 */
export async function GET(request: Request) {
  const template = await fs
    .readFile(path.join(process.cwd(), "integrations", "openclaw", "mbarete", "SKILL.md"), "utf8")
    .catch(() => null);
  if (template === null) return new NextResponse("Not found", { status: 404 });
  const origin = (process.env.APP_ORIGIN ? appOrigin() : new URL(request.url).origin).replace(/\/$/, "");
  return new NextResponse(template.replaceAll("{{ORIGIN}}", origin), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SKILL.md"',
      "Cache-Control": "no-store",
    },
  });
}
