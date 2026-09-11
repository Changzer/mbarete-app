import { z } from "zod";

/**
 * Validation for the public enquiry form, kept out of the action module so it
 * can be tested directly: a "use server" file may only export async functions,
 * so the schema itself cannot live there.
 *
 * The contact handle is free text and optional on purpose. This page sells to
 * importers across Latin America, so the handle might be a WhatsApp number in
 * any country, a WeChat ID, or nothing at all — and a format check would only
 * ever turn away a real buyer. The message, unlike everything else here, IS
 * required: an enquiry that does not say what someone wants to import is not
 * an enquiry, it is a row nobody can act on.
 */
/** Blank, whitespace and absent all mean "not given" — stored as NULL. */
const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullish()
  .transform((v) => v ?? null);

export const enquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  // An empty field and an absent field are the same intent: no handle given.
  preferredContact: optionalText,
  message: z.string().trim().min(1).max(4000),
  // Everything below is optional and free text. A quote needs quantity and
  // destination to be worth anything, but demanding them costs more enquiries
  // than it saves work: a buyer who does not know their volume yet is still a
  // buyer, and the operator can ask. Free text because importers say "500
  // pcs", "1x40HQ" or "um contêiner", a destination may be a country or a
  // named port, and a target price carries its own currency.
  quantity: optionalText,
  destination: optionalText,
  targetPrice: optionalText,
});

export type EnquiryInput = z.infer<typeof enquirySchema>;
