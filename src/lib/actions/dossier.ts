"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { orders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, requireModuleAction } from "@/lib/authz";
import { logOrderEvent } from "@/lib/order-log";
import { CUSTOMS_NO, TAX_REGIMES } from "@/lib/dossier";
import { DESTINATION_COUNTRY_CODES } from "@/lib/customs";

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
  // Shipment facts for the customs pack; all optional.
  portOfLoading: z.string().trim().max(120).default(""),
  portOfDestination: z.string().trim().max(120).default(""),
  destinationCountry: z.union([z.enum(DESTINATION_COUNTRY_CODES as [string, ...string[]]), z.literal("")]).default(""),
  goodsOrigin: z.string().trim().max(120).default(""),
  // The carton marks, one line each, as they print on the boxes and the sheets.
  shippingMarks: z
    .string()
    .max(600)
    .default("")
    .transform((v) => v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).join("\n")),
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
    ["portOfLoading", before.portOfLoading || null, data.portOfLoading || null],
    ["portOfDestination", before.portOfDestination || null, data.portOfDestination || null],
    ["destinationCountry", before.destinationCountry || null, data.destinationCountry || null],
    ["goodsOrigin", before.goodsOrigin || null, data.goodsOrigin || null],
    ["shippingMarks", before.shippingMarks || null, data.shippingMarks || null],
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
      portOfLoading: data.portOfLoading,
      portOfDestination: data.portOfDestination,
      destinationCountry: data.destinationCountry,
      goodsOrigin: data.goodsOrigin,
      shippingMarks: data.shippingMarks,
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
