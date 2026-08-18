"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exchangeRates, companyProfile } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
}

const rateSchema = z.object({
  // Free-form so "RMB" and "CNY" can both exist if that is how suppliers quote.
  currencyCode: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .transform((s) => s.toUpperCase()),
  rateToUsd: z.coerce.number().positive(),
});

export async function upsertExchangeRate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  const parsed = rateSchema.safeParse({
    currencyCode: formData.get("currencyCode"),
    rateToUsd: formData.get("rateToUsd"),
  });
  if (!parsed.success) return "invalid";
  const { currencyCode, rateToUsd } = parsed.data;

  const existing = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.currencyCode, currencyCode))
    .get();

  if (existing) {
    db.update(exchangeRates)
      .set({ rateToUsd, updatedAt: new Date().toISOString() })
      .where(eq(exchangeRates.currencyCode, currencyCode))
      .run();
  } else {
    db.insert(exchangeRates).values({ currencyCode, rateToUsd }).run();
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}

export async function deleteExchangeRate(currencyCode: string) {
  await requireSession();
  if (currencyCode === "USD") return; // USD is the peg; removing it breaks conversion
  db.delete(exchangeRates).where(eq(exchangeRates.currencyCode, currencyCode)).run();
  revalidatePath("/settings");
  revalidatePath("/orders");
}

/** Everything printed as the vendor block on a proforma invoice. */
const companySchema = z.object({
  companyName: z.string().trim().default(""),
  addressLines: z.string().default(""),
  phone: z.string().trim().default(""),
  email: z.string().trim().default(""),
  website: z.string().trim().default(""),
  taxId: z.string().trim().default(""),
  bankName: z.string().trim().default(""),
  bankAccountName: z.string().trim().default(""),
  bankAccountNumber: z.string().trim().default(""),
  bankSwift: z.string().trim().default(""),
  bankAddress: z.string().default(""),
  paymentTerms: z.string().default(""),
  incoterms: z.string().trim().default(""),
  validityDays: z.coerce.number().int().min(0).max(3650).default(30),
  footerNote: z.string().default(""),
});

export async function saveCompanyProfile(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return "invalid";
  const data = { ...parsed.data, updatedAt: new Date().toISOString() };

  // Always row 1: there is one company, and the proforma reads exactly it.
  const existing = db.select().from(companyProfile).where(eq(companyProfile.id, 1)).get();
  if (existing) {
    db.update(companyProfile).set(data).where(eq(companyProfile.id, 1)).run();
  } else {
    db.insert(companyProfile).values({ id: 1, ...data }).run();
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}
