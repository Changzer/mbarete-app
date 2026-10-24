import { NextResponse } from "next/server";
import { authenticateAssistant } from "@/lib/assistant-auth";
import { handleAssistantRequest } from "@/lib/assistant-api";
import { recordError } from "@/lib/monitoring";

/**
 * /api/assistant/v1/… — the API a chat assistant works through with its key
 * (docs/ASSISTANT.md). Authentication, then the router in assistant-api.ts.
 */

type Params = { params: Promise<{ path?: string[] }> };

async function serve(request: Request, { params }: Params, method: string) {
  const gate = await authenticateAssistant(request);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, message: gate.status === 429 ? "Too many wrong keys from this address; wait 15 minutes." : "Missing, wrong or revoked key." },
      { status: gate.status, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" } },
    );
  }
  const { path = [] } = await params;
  try {
    const reply = await handleAssistantRequest(gate.identity, method, path, request);
    return NextResponse.json(reply.body, { status: reply.status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    recordError("assistant-api", err);
    return NextResponse.json({ error: "server", message: "Something went wrong on the server. Read the item again before retrying: the change may or may not have been saved." }, { status: 500 });
  }
}

export const GET = (request: Request, ctx: Params) => serve(request, ctx, "GET");
export const POST = (request: Request, ctx: Params) => serve(request, ctx, "POST");
export const PATCH = (request: Request, ctx: Params) => serve(request, ctx, "PATCH");
