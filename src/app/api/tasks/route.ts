import { NextResponse } from "next/server";
import { companyLifecycleBlock, getCompanyModules, sessionUser, type SessionUser } from "@/lib/authz";
import { getMyTasks, markTasksSeen } from "@/lib/tasks-server";
import { routing, type Locale } from "@/i18n/routing";

/**
 * The task bell's data. A Route Handler rather than a Server Action because
 * the bell polls: actions from one page run one at a time, and a background
 * read must never hold up someone's save on the board.
 */

async function allowed(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await sessionUser();
  if (!user) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const blocked = await companyLifecycleBlock(user);
  if (blocked) return { response: NextResponse.json({ error: blocked }, { status: 403 }) };
  // The board lives with the orders module; without it there is nothing to follow up.
  if (!(await getCompanyModules(user.companyId)).orders) {
    return { response: NextResponse.json({ error: "module disabled" }, { status: 404 }) };
  }
  return { user };
}

export async function GET(request: Request) {
  const gate = await allowed();
  if ("response" in gate) return gate.response;
  const asked = new URL(request.url).searchParams.get("locale");
  const locale = (routing.locales as readonly string[]).includes(asked ?? "") ? (asked as Locale) : routing.defaultLocale;
  const tasks = await getMyTasks(gate.user, locale);
  return NextResponse.json(tasks, { headers: { "Cache-Control": "no-store" } });
}

/** Marks the list the bell showed as seen: `{ "upTo": "<asOf from GET>" }`. */
export async function POST(request: Request) {
  // A JSON body only: a cross-site form cannot send one without a preflight.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "json only" }, { status: 415 });
  }
  const gate = await allowed();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => null)) as { upTo?: unknown } | null;
  const ok = typeof body?.upTo === "string" && (await markTasksSeen(gate.user, body.upTo));
  if (!ok) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
