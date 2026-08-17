import { z } from "zod";

export const productSchema = z.object({
  sku: z.string().min(1),
  nameEn: z.string().min(1),
  nameZh: z.string().min(1),
  categoryId: z.coerce.number().int().positive(),
  descriptionEn: z.string().default(""),
  descriptionZh: z.string().default(""),
  price: z.coerce.number().nonnegative(),
  currency: z.string().min(1),
  moq: z.coerce.number().int().positive(),
  qtyPerBox: z.coerce.number().int().positive(),
  lengthCm: z.coerce.number().nonnegative().default(0),
  widthCm: z.coerce.number().nonnegative().default(0),
  heightCm: z.coerce.number().nonnegative().default(0),
  weightKg: z.coerce.number().nonnegative().default(0),
  cbmOverride: z.coerce.number().nonnegative().optional(),
  active: z.coerce.boolean().default(true),
});

export const categorySchema = z.object({
  nameEn: z.string().min(1),
  nameZh: z.string().min(1),
});

export const contactSchema = z.object({
  type: z.enum(["supplier", "client"]),
  companyName: z.string().min(1),
  contactPerson: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  whatsapp: z.string().default(""),
  wechat: z.string().default(""),
  notes: z.string().default(""),
});
