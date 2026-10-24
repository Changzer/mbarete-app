import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assistantKeys, users } from "@/db/schema";
import { parseScopes, type AssistantScope } from "@/lib/assistant-keys";

export type AssistantRow = {
  id: number;
  name: string;
  active: boolean;
  scopes: AssistantScope[];
  createdAt: string;
  createdByName: string | null;
  keyIssuedAt: string;
  lastUsedAt: string | null;
};

/** The company's assistants for the Team page (admin eyes only, like the page). */
export async function listAssistants(companyId: number): Promise<AssistantRow[]> {
  const creator = alias(users, "creator");
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      active: users.active,
      scopes: assistantKeys.scopes,
      createdAt: assistantKeys.createdAt,
      createdByName: creator.name,
      keyIssuedAt: assistantKeys.keyIssuedAt,
      lastUsedAt: assistantKeys.lastUsedAt,
    })
    .from(users)
    .innerJoin(assistantKeys, and(eq(assistantKeys.companyId, users.companyId), eq(assistantKeys.userId, users.id)))
    .leftJoin(creator, eq(creator.id, assistantKeys.createdBy))
    .where(and(eq(users.companyId, companyId), eq(users.kind, "assistant")))
    .orderBy(asc(users.name));
  return rows.map((r) => ({ ...r, scopes: [...parseScopes(r.scopes)] }));
}
