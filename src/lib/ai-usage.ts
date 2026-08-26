import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import type { VisionUsage } from "@/lib/vision";

/**
 * Writes one AI-scan row to the spend ledger. Fire-and-forget by design:
 * accounting must never fail a scan, so the insert runs behind the response
 * and a failure only reaches the server log. Called from inside a tenant
 * request, where the connection already carries the company's RLS scope.
 */
export function recordAiUsage(
  row: {
    companyId: number;
    /** Null when the scan ran without a signed-in user (draft background read). */
    userId: number | null;
    kind: "product" | "card";
    images: number;
  } & VisionUsage,
): void {
  void db
    .insert(aiUsage)
    .values({
      companyId: row.companyId,
      userId: row.userId,
      kind: row.kind,
      provider: row.provider,
      model: row.model,
      images: row.images,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    })
    .catch((err) => console.error("[ai-usage] insert failed:", err));
}
