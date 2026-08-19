"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exchangeRates, companyProfile, bankAccounts, orders } from "@/db/schema";
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
  // Bank details live in bank_accounts now; this schema deliberately leaves
  // the legacy columns alone so old data keeps printing until migrated.
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

/**
 * One beneficiary account as the Settings form submits it. Only the label is
 * required — a half-known account can be saved and finished later; the
 * proforma prints whichever fields exist.
 */
const bankAccountSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  label: z.string().trim().min(1).max(80),
  bankName: z.string().trim().max(120).default(""),
  accountName: z.string().trim().max(160).default(""),
  accountNumber: z.string().trim().max(80).default(""),
  swift: z.string().trim().max(40).default(""),
  bankAddress: z.string().max(500).default(""),
  currency: z
    .string()
    .trim()
    .max(8)
    .transform((s) => s.toUpperCase())
    .default(""),
});

export async function saveBankAccount(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  const raw = Object.fromEntries(formData);
  if (!raw.id) delete raw.id; // empty string means "new account", not id 0
  const parsed = bankAccountSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { id, ...data } = parsed.data;

  if (id) {
    db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id)).run();
  } else {
    // The first account registered becomes the default automatically.
    const existing = db.select({ id: bankAccounts.id }).from(bankAccounts).all();
    db.insert(bankAccounts)
      .values({ ...data, isDefault: existing.length === 0 })
      .run();
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}

export async function setDefaultBankAccount(id: number) {
  await requireSession();
  const target = db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).get();
  if (!target) return;
  db.update(bankAccounts).set({ isDefault: false }).run();
  db.update(bankAccounts).set({ isDefault: true }).where(eq(bankAccounts.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/orders");
}

export async function deleteBankAccount(id: number) {
  await requireSession();
  const target = db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).get();
  if (!target) return;

  // Orders that pointed here fall back to the default account; done by hand
  // because older databases may carry the FK without its SET NULL clause.
  db.update(orders)
    .set({ bankAccountId: null })
    .where(eq(orders.bankAccountId, id))
    .run();
  db.delete(bankAccounts).where(eq(bankAccounts.id, id)).run();

  // Never leave the remaining accounts without a default.
  if (target.isDefault) {
    const next = db.select({ id: bankAccounts.id }).from(bankAccounts).all()[0];
    if (next) {
      db.update(bankAccounts)
        .set({ isDefault: true })
        .where(eq(bankAccounts.id, next.id))
        .run();
    }
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
}

/** Pull today's rates now, rather than waiting for the six-hour cycle. */
export async function refreshRatesNow(): Promise<
  { ok: true; source: string } | { ok: false; error: string }
> {
  await requireSession();
  const { refreshExchangeRates } = await import("@/lib/forex");
  const result = await refreshExchangeRates();
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/orders");
    return { ok: true, source: result.source };
  }
  return { ok: false, error: result.error };
}
