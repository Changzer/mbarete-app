"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { exchangeRates, companyProfile, bankAccounts, orders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/authz";

// Company profile, banks and exchange rates feed the proforma and every
// price calculation — admin ground, in full.
async function requireSession() {
  return await requireAdmin();
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
  const admin = await requireSession();

  const parsed = rateSchema.safeParse({
    currencyCode: formData.get("currencyCode"),
    rateToUsd: formData.get("rateToUsd"),
  });
  if (!parsed.success) return "invalid";
  const { currencyCode, rateToUsd } = parsed.data;

  const scope = and(
    eq(exchangeRates.companyId, admin.companyId),
    eq(exchangeRates.currencyCode, currencyCode),
  );
  const existing = await db.select().from(exchangeRates).where(scope).limit(1).then(one);

  if (existing) {
    await db.update(exchangeRates)
      .set({ rateToUsd, updatedAt: new Date().toISOString() })
      .where(scope);
  } else {
    await db
      .insert(exchangeRates)
      .values({ companyId: admin.companyId, currencyCode, rateToUsd });
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}

export async function deleteExchangeRate(currencyCode: string) {
  const admin = await requireSession();
  if (currencyCode === "USD") return; // USD is the peg; removing it breaks conversion
  await db
    .delete(exchangeRates)
    .where(
      and(
        eq(exchangeRates.companyId, admin.companyId),
        eq(exchangeRates.currencyCode, currencyCode),
      ),
    );
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
  const admin = await requireSession();

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return "invalid";
  const data = { ...parsed.data, updatedAt: new Date().toISOString() };

  // One profile row per company; the proforma reads exactly it.
  const existing = await db
    .select()
    .from(companyProfile)
    .where(eq(companyProfile.companyId, admin.companyId))
    .limit(1)
    .then(one);
  if (existing) {
    await db
      .update(companyProfile)
      .set(data)
      .where(eq(companyProfile.companyId, admin.companyId));
  } else {
    await db.insert(companyProfile).values({ companyId: admin.companyId, ...data });
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
  const admin = await requireSession();

  const raw = Object.fromEntries(formData);
  if (!raw.id) delete raw.id; // empty string means "new account", not id 0
  const parsed = bankAccountSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { id, ...data } = parsed.data;

  if (id) {
    // The row may have been deleted from another tab; a silent no-op would
    // close the form and discard what was typed as if it had been saved.
    const target = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)))
      .limit(1)
      .then(one);
    if (!target) {
      revalidatePath("/settings");
      return "missing";
    }
    await db
      .update(bankAccounts)
      .set(data)
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)));
  } else {
    // The first account registered becomes the default automatically.
    const existing = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, admin.companyId));
    await db
      .insert(bankAccounts)
      .values({ ...data, companyId: admin.companyId, isDefault: existing.length === 0 });
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}

export async function setDefaultBankAccount(id: number) {
  const admin = await requireSession();
  // One transaction: a crash between the two updates would leave no default.
  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)))
      .limit(1)
      .then(one);
    if (!target) return;
    await tx
      .update(bankAccounts)
      .set({ isDefault: false })
      .where(eq(bankAccounts.companyId, admin.companyId));
    await tx
      .update(bankAccounts)
      .set({ isDefault: true })
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)));
  });
  revalidatePath("/settings");
  revalidatePath("/orders");
}

export async function deleteBankAccount(id: number) {
  const admin = await requireSession();
  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)))
      .limit(1)
      .then(one);
    if (!target) return;

    // Orders that pointed here fall back to the default account; done by hand
    // rather than trusting the FK's SET NULL, so it holds on any database.
    await tx
      .update(orders)
      .set({ bankAccountId: null })
      .where(and(eq(orders.companyId, admin.companyId), eq(orders.bankAccountId, id)));
    await tx
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.companyId, admin.companyId), eq(bankAccounts.id, id)));

    // Never leave the remaining accounts without a default.
    if (target.isDefault) {
      const [next] = await tx
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(eq(bankAccounts.companyId, admin.companyId))
        .limit(1);
      if (next) {
        await tx
          .update(bankAccounts)
          .set({ isDefault: true })
          .where(eq(bankAccounts.id, next.id));
      }
    }
  });

  revalidatePath("/settings");
  revalidatePath("/orders");
}

/** Pull today's rates now, rather than waiting for the six-hour cycle. */
export async function refreshRatesNow(): Promise<
  { ok: true; source: string } | { ok: false; error: string }
> {
  const admin = await requireSession();
  const { refreshExchangeRates } = await import("@/lib/forex");
  const result = await refreshExchangeRates(admin.companyId);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/orders");
    return { ok: true, source: result.source };
  }
  return { ok: false, error: result.error };
}
