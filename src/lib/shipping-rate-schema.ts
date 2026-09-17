import { z } from "zod";
import { normalizeDecimalInput } from "@/lib/decimal-input";

const decimal = (v: unknown) => typeof v === "string" ? normalizeDecimalInput(v) : v;

export const shippingRateSchema = z.object({
  destination: z.enum(["BR", "PY"]),
  mode: z.enum(["lcl", "fcl"]),
  basis: z.enum(["per_cbm", "per_40hq"]),
  amount: z.preprocess(decimal, z.coerce.number().positive().max(9_999_999_999)),
  currency: z.string().trim().min(3).max(8).transform((s) => s.toUpperCase()),
  usableCbm: z.preprocess(decimal, z.coerce.number().positive().max(200)).default(68),
  effectiveFrom: z.iso.date(),
  note: z.string().trim().max(200).default(""),
});
