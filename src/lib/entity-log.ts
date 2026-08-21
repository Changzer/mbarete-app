import { db } from "@/db";
import { entityEvents } from "@/db/schema";

/**
 * The write side of the products/contacts changelog — the same posture as
 * the order log in order-log.ts: events carry structured payloads and the
 * Activity page composes the sentences in the reader's language.
 *
 * Display values (names, numbers) are captured at write time, because the
 * log must keep saying what happened even after the row is renamed or gone —
 * "deleted supplier 张三饰品" has to survive the deletion it records.
 */

export type EntityKind = "product" | "contact";
export type EntityEventKind = "created" | "edited" | "deleted";

/**
 * One field-level difference inside an "edited" event. `from`/`to` are the
 * display strings as they were; both absent means "changed, values too long
 * to keep" (descriptions, notes).
 */
export type FieldChange = { field: string; from?: string; to?: string };

export type EntityEventPayload = { name: string; changes?: FieldChange[] };

export async function logEntityEvent(
  companyId: number,
  entity: EntityKind,
  entityId: number,
  userId: number | null,
  kind: EntityEventKind,
  payload: EntityEventPayload,
) {
  await db
    .insert(entityEvents)
    .values({ companyId, entity, entityId, userId, kind, payload: JSON.stringify(payload) });
}

/** Long free text would bloat the log; keep enough to recognise the value. */
function clip(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

function changed(field: string, from: string, to: string): FieldChange | null {
  if (from.trim() === to.trim()) return null;
  return { field, from: clip(from), to: clip(to) };
}

type ContactShape = {
  companyName: string;
  companyNameZh: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  boothLocation: string;
  bankInfo: string;
  notes: string;
};

/**
 * What changed in a contact edit. Values are kept for every field — a bank
 * account or phone number being replaced (or blanked) is exactly what this
 * log exists to show — except notes, where "changed" is enough.
 */
export function diffContactEdit(before: ContactShape, after: ContactShape): FieldChange[] {
  const changes = [
    changed("companyName", before.companyName, after.companyName),
    changed("companyNameZh", before.companyNameZh, after.companyNameZh),
    changed("contactPerson", before.contactPerson, after.contactPerson),
    changed("phone", before.phone, after.phone),
    changed("email", before.email, after.email),
    changed("whatsapp", before.whatsapp, after.whatsapp),
    changed("wechat", before.wechat, after.wechat),
    changed("boothLocation", before.boothLocation, after.boothLocation),
    changed("bankInfo", before.bankInfo, after.bankInfo),
  ].filter((c): c is FieldChange => c !== null);

  if (before.notes.trim() !== after.notes.trim()) {
    changes.push({ field: "notes" });
  }
  return changes;
}

type ProductShape = {
  sku: string;
  nameEn: string;
  nameZh: string;
  categoryId: number;
  descriptionEn: string;
  descriptionZh: string;
  price: number;
  sellPrice: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  supplierId: number | null;
  active: boolean;
};

/**
 * What changed in a product edit. Category and supplier ids become the
 * display names the log keeps; price carries its currency so a currency
 * switch reads as a price change, which is what it is.
 */
export function diffProductEdit(
  before: ProductShape,
  after: ProductShape,
  categoryNameOf: (id: number) => string,
  supplierNameOf: (id: number | null) => string,
): FieldChange[] {
  const money = (value: number, currency: string) => `${value} ${currency}`;
  const dims = (p: ProductShape) => `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm`;

  const changes = [
    changed("sku", before.sku, after.sku),
    changed("nameEn", before.nameEn, after.nameEn),
    changed("nameZh", before.nameZh, after.nameZh),
    before.categoryId !== after.categoryId
      ? changed("category", categoryNameOf(before.categoryId), categoryNameOf(after.categoryId))
      : null,
    changed("price", money(before.price, before.currency), money(after.price, after.currency)),
    changed(
      "sellPrice",
      money(before.sellPrice, before.currency),
      money(after.sellPrice, after.currency),
    ),
    changed("moq", String(before.moq), String(after.moq)),
    changed("qtyPerBox", String(before.qtyPerBox), String(after.qtyPerBox)),
    changed("dimensions", dims(before), dims(after)),
    changed("weight", `${before.weightKg} kg`, `${after.weightKg} kg`),
    before.supplierId !== after.supplierId
      ? changed("supplier", supplierNameOf(before.supplierId), supplierNameOf(after.supplierId))
      : null,
  ].filter((c): c is FieldChange => c !== null);

  if (
    before.descriptionEn.trim() !== after.descriptionEn.trim() ||
    before.descriptionZh.trim() !== after.descriptionZh.trim()
  ) {
    changes.push({ field: "description" });
  }
  if (before.active !== after.active) {
    changes.push({ field: after.active ? "activated" : "deactivated" });
  }
  return changes;
}
