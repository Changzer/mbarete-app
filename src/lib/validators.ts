import { z } from "zod";

/**
 * What a product actually needs to exist.
 *
 * Only the commercial facts are required — a name, a price, an MOQ and a pack
 * size. Carton measurements are often not to hand at a supplier, and refusing
 * to save without them turns a two-minute job into a return visit, so they are
 * optional and flagged wherever a missing figure would distort a quote.
 */
export const productSchema = z
  .object({
    // Blank is allowed; the next free number is assigned on save.
    sku: z.string().trim().default(""),
    // One language is enough: the catalog falls back to whichever exists.
    nameEn: z.string().trim().default(""),
    nameZh: z.string().trim().default(""),
    categoryId: z.coerce.number().int().positive(),
    descriptionEn: z.string().default(""),
    descriptionZh: z.string().default(""),
    price: z.coerce.number().nonnegative(),
    sellPrice: z.coerce.number().nonnegative().default(0),
    currency: z.string().min(1),
    moq: z.coerce.number().int().positive(),
    qtyPerBox: z.coerce.number().int().positive(),
    // Blank means "not measured yet", which is stored as 0 and surfaced as
    // missing rather than silently counted as no volume.
    lengthCm: z.coerce.number().nonnegative().default(0),
    widthCm: z.coerce.number().nonnegative().default(0),
    heightCm: z.coerce.number().nonnegative().default(0),
    weightKg: z.coerce.number().nonnegative().default(0),
    dimensionSource: z.enum(["carton", "piece"]).default("carton"),
    pieceLengthCm: z.coerce.number().nonnegative().default(0),
    pieceWidthCm: z.coerce.number().nonnegative().default(0),
    pieceHeightCm: z.coerce.number().nonnegative().default(0),
    pieceWeightKg: z.coerce.number().nonnegative().default(0),
    packingAllowancePct: z.coerce.number().nonnegative().max(200).default(15),
    cbmOverride: z.coerce.number().nonnegative().optional(),
    supplierId: z.coerce.number().int().positive().optional(),
    duplicatedFromId: z.coerce.number().int().positive().optional(),
    active: z.coerce.boolean().default(true),
  })
  .refine((p) => p.nameEn.length > 0 || p.nameZh.length > 0, {
    message: "a name is required in at least one language",
    path: ["nameEn"],
  });

export const categorySchema = z.object({
  nameEn: z.string().min(1),
  nameZh: z.string().min(1),
});

export const contactSchema = z.object({
  type: z.enum(["supplier", "client"]),
  companyName: z.string().min(1),
  companyNameZh: z.string().default(""),
  contactPerson: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  whatsapp: z.string().default(""),
  wechat: z.string().default(""),
  boothLocation: z.string().default(""),
  bankInfo: z.string().default(""),
  notes: z.string().default(""),
});
