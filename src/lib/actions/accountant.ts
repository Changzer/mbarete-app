"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { periodCloses } from "@/db/schema";
import { requireAdmin, requireModuleAction } from "@/lib/authz";
import { assembleAccountantPack, periodKey } from "@/lib/accountant-pack-server";
import type { Period } from "@/lib/finance-report";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ClosePeriodResult = { ok: boolean; error?: "invalid" | "failed" };

/**
 * Records the period's deterministic data digest as its close anchor.
 * Closing never locks anything — records stay editable, because operational
 * software must not hold data hostage — it only makes later edits visible:
 * the next pack for this period says plainly whether its digest still
 * matches. Re-closing after a deliberate correction simply overwrites the
 * anchor; the close row always reflects the operator's latest sign-off.
 */
export async function closePeriod(from: string, to: string): Promise<ClosePeriodResult> {
  const user = await requireAdmin();
  await requireModuleAction(user, "finance");
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) return { ok: false, error: "invalid" };
  const period: Period = { from, to };

  try {
    // The digest comes off the same assembly the download uses — never a
    // parallel computation that could drift from what the pack contains.
    const { built } = await assembleAccountantPack({
      companyId: user.companyId,
      period,
      reportCurrency: "RMB",
      generatedBy: { id: user.id, email: user.email },
    });
    await db
      .insert(periodCloses)
      .values({
        companyId: user.companyId,
        period: periodKey(period),
        closedBy: user.id,
        closedAt: new Date().toISOString(),
        packSha256: built.manifest.closeDigest,
      })
      .onConflictDoUpdate({
        target: [periodCloses.companyId, periodCloses.period],
        set: {
          closedBy: user.id,
          closedAt: new Date().toISOString(),
          packSha256: built.manifest.closeDigest,
        },
      });
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/finance");
  return { ok: true };
}
