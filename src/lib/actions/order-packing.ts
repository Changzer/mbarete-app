"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, one } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { requireUser, requireModuleAction } from "@/lib/authz";
import { deriveLineFigures } from "@/lib/calculations";
import { logOrderEvent, type PackingChange } from "@/lib/order-log";

/**
 * The order's packing as the factory actually packed it. A supplier quotes
 * "600 a carton"; the boxes that arrive at the forwarder hold 500. Entered
 * here, the line's carton figures become the factory's, and every document
 * follows — the carton count, CBM and weight on the order, the packing list,
 * the customs pack and the carton labels — because they all read the line.
 *
 * Packing is not the deal: quantities, prices and money never change here,
 * and it stays editable after confirmation and after shipping (the factory's
 * list often arrives late). Every change is logged, a stale form loses to a
 * newer save (orders.version), and Update-from-catalog leaves confirmed lines
 * alone until "Back to the catalog's figures" hands a line back.
 */

const lineInput = z.union([
  z.object({
    productId: z.number().int().positive(),
    perCarton: z.number().int().min(1).max(1_000_000),
    // A carton bigger than 5 m³ or heavier than 2 t is a typo, not a box.
    cartonCbm: z.number().min(0).max(5),
    cartonKg: z.number().min(0).max(2000),
  }),
  z.object({ productId: z.number().int().positive(), reset: z.literal(true) }),
]);

const packingInput = z.object({
  version: z.number().int().min(1),
  lines: z.array(lineInput).min(1).max(500),
});

export type PackingResult = { error?: "invalid" | "notFound" | "frozen" | "conflict"; version?: number };

const near = (a: number, b: number) => Math.abs(a - b) < 0.00005;

export async function updateOrderPacking(orderId: number, input: unknown): Promise<PackingResult> {
  const user = await requireUser();
  await requireModuleAction(user, "orders");
  const parsed = packingInput.safeParse(input);
  if (!parsed.success || !Number.isInteger(orderId) || orderId <= 0) return { error: "invalid" };
  const { version, lines } = parsed.data;

  const order = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!order) return { error: "notFound" };
  // A cancelled order ships nothing; there is nothing to pack.
  if (order.status === "cancelled") return { error: "frozen" };
  if (order.version !== version) return { error: "conflict" };

  const items = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.companyId, user.companyId), eq(orderItems.orderId, orderId)));
  const itemByProduct = new Map(items.map((i) => [i.productId, i]));
  if (lines.some((l) => !itemByProduct.has(l.productId))) return { error: "invalid" };

  const resetIds = lines.flatMap((l) => ("reset" in l ? [l.productId] : []));
  const catalog = resetIds.length
    ? await db
        .select({ id: products.id, qtyPerBox: products.qtyPerBox, cbm: products.cbm, weightKg: products.weightKg })
        .from(products)
        .where(and(eq(products.companyId, user.companyId), inArray(products.id, resetIds)))
    : [];
  const catalogById = new Map(catalog.map((p) => [p.id, p]));

  const updates: { itemId: number; set: Partial<typeof orderItems.$inferInsert> }[] = [];
  const changes: PackingChange[] = [];
  for (const line of lines) {
    const item = itemByProduct.get(line.productId)!;
    let next: { perCarton: number; cartonCbm: number; cartonKg: number; confirmed: boolean };
    if ("reset" in line) {
      // A product deleted since has no catalog figures to go back to: the line keeps its own.
      const product = catalogById.get(line.productId);
      next = product
        ? { perCarton: product.qtyPerBox, cartonCbm: product.cbm, cartonKg: product.weightKg, confirmed: false }
        : { perCarton: item.qtyPerBoxSnapshot, cartonCbm: item.cartonCbmSnapshot, cartonKg: item.cartonWeightSnapshot, confirmed: false };
      if (!item.packingConfirmed) continue;
    } else {
      next = { perCarton: line.perCarton, cartonCbm: line.cartonCbm, cartonKg: line.cartonKg, confirmed: true };
      const same =
        item.packingConfirmed &&
        item.qtyPerBoxSnapshot === next.perCarton &&
        near(item.cartonCbmSnapshot, next.cartonCbm) &&
        near(item.cartonWeightSnapshot, next.cartonKg);
      if (same) continue;
    }
    // The money stays as agreed: only the logistics are derived again.
    const derived = deriveLineFigures(
      { unitPrice: item.unitPriceSnapshot, qtyPerBox: next.perCarton, cartonCbm: next.cartonCbm, cartonWeightKg: next.cartonKg },
      item.quantity,
    );
    const cartons = next.perCarton > 0 ? derived.cartons : item.cartonsSnapshot;
    updates.push({
      itemId: item.id,
      set: {
        qtyPerBoxSnapshot: next.perCarton,
        cartonCbmSnapshot: next.cartonCbm,
        cartonWeightSnapshot: next.cartonKg,
        cartonsSnapshot: cartons,
        lineCbm: next.perCarton > 0 ? derived.lineCbm : item.lineCbm,
        lineWeightKg: next.perCarton > 0 ? derived.lineWeightKg : item.lineWeightKg,
        packingConfirmed: next.confirmed,
      },
    });
    changes.push({
      sku: item.skuSnapshot,
      name: item.nameEnSnapshot || item.nameZhSnapshot,
      ...("reset" in line ? { reset: true as const } : {}),
      perCarton: [item.qtyPerBoxSnapshot, next.perCarton],
      cartonCbm: [item.cartonCbmSnapshot, next.cartonCbm],
      cartonKg: [item.cartonWeightSnapshot, next.cartonKg],
      cartons: [item.cartonsSnapshot, cartons],
    });
  }
  if (updates.length === 0) return { version: order.version };

  const nextVersion = await db.transaction(async (tx) => {
    const won = await tx
      .update(orders)
      .set({ version: order.version + 1, updatedBy: user.id, updatedAt: new Date().toISOString() })
      .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId), eq(orders.version, version)))
      .returning({ version: orders.version });
    if (won.length === 0) return null;
    for (const { itemId, set } of updates) {
      await tx
        .update(orderItems)
        .set(set)
        .where(and(eq(orderItems.companyId, user.companyId), eq(orderItems.orderId, orderId), eq(orderItems.id, itemId)));
    }
    return won[0].version;
  });
  if (nextVersion === null) return { error: "conflict" };

  await logOrderEvent(orderId, user.id, "packing", { lines: changes });
  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/followup", "page");
  return { version: nextVersion };
}
