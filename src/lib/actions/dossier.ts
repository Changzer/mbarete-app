"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { orders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, requireModuleAction } from "@/lib/authz";
import { logOrderEvent } from "@/lib/order-log";
import { CUSTOMS_NO, TAX_REGIMES } from "@/lib/dossier";
import { storeDossierDocument } from "@/lib/dossier-server";

/**
 * The dossier's header lives on the order but is not the agreed document:
 * regime, declaration number and dates arrive after confirmation, so they
 * stay editable on any status. Every change is written to the order's
 * history, and a stale form loses to a newer save (orders.version).
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "date");
const optionalDate = z.union([isoDate, z.literal("")]).transform((v) => (v === "" ? null : v));

const metaInput = z.object({
  version: z.number().int().min(1),
  taxRegime: z.enum(TAX_REGIMES as [string, ...string[]]),
  customsDeclarationNo: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .refine((v) => v === "" || CUSTOMS_NO.test(v), "customsNo")
    .transform((v) => (v === "" ? null : v)),
  exportContractDate: optionalDate,
  purchaseContractDate: optionalDate,
  warehouseInDate: optionalDate,
  exportDate: optionalDate,
});

export type DossierMetaResult = { error?: string; version?: number };

async function requireSession() {
  const user = await requireUser();
  await requireModuleAction(user, "orders");
  return user;
}

function refresh() {
  revalidatePath("/[locale]/orders/[id]", "page");
}

export async function updateDossierMeta(orderId: number, input: unknown): Promise<DossierMetaResult> {
  const user = await requireSession();
  const parsed = metaInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path?.[0] ?? "");
    if (path === "customsDeclarationNo") return { error: "customsNo" };
    if (path.endsWith("Date")) return { error: "date" };
    return { error: "invalid" };
  }
  const data = parsed.data;
  // The export date is a fact from the declaration; a date ahead of today is a typo.
  const today = new Date().toISOString().slice(0, 10);
  if (data.exportDate && data.exportDate > today) return { error: "futureDate" };

  const before = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!before) return { error: "notFound" };
  if (before.version !== data.version) return { error: "conflict" };

  const fields = [
    ["taxRegime", before.taxRegime, data.taxRegime],
    ["customsDeclarationNo", before.customsDeclarationNo, data.customsDeclarationNo],
    ["exportContractDate", before.exportContractDate, data.exportContractDate],
    ["purchaseContractDate", before.purchaseContractDate, data.purchaseContractDate],
    ["warehouseInDate", before.warehouseInDate, data.warehouseInDate],
    ["exportDate", before.exportDate, data.exportDate],
  ] as const;
  const changes = fields
    .filter(([, from, to]) => (from ?? null) !== (to ?? null))
    .map(([field, from, to]) => ({ field, from: from ?? null, to: to ?? null }));
  if (changes.length === 0) return { version: before.version };

  const updated = await db
    .update(orders)
    .set({
      taxRegime: data.taxRegime as (typeof orders.$inferInsert)["taxRegime"],
      customsDeclarationNo: data.customsDeclarationNo,
      exportContractDate: data.exportContractDate,
      purchaseContractDate: data.purchaseContractDate,
      warehouseInDate: data.warehouseInDate,
      exportDate: data.exportDate,
      version: before.version + 1,
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.companyId, user.companyId), eq(orders.version, data.version)))
    .returning({ version: orders.version });
  if (updated.length === 0) return { error: "conflict" };

  await logOrderEvent(orderId, user.id, "dossier", { changes });
  refresh();
  return { version: updated[0].version };
}

export type DossierUploadResult = { error?: string };

/** A document for one checklist item; the video item goes through its own route. */
export async function uploadDossierDocument(
  orderId: number,
  _prev: DossierUploadResult | undefined,
  formData: FormData,
): Promise<DossierUploadResult> {
  const user = await requireSession();
  const kind = String(formData.get("kind") ?? "");
  const fapiaoType = formData.get("fapiaoType");
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "invalid" };
  const result = await storeDossierDocument(
    user,
    orderId,
    kind,
    typeof fapiaoType === "string" && fapiaoType ? fapiaoType : null,
    file,
  );
  if (result.error) return { error: result.error };
  refresh();
  return {};
}
