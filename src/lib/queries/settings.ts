import { db, one } from "@/db";
import { companyProfile, bankAccounts, shippingRates } from "@/db/schema";
import { DESTINATIONS, latestPerDestination, type Destination, type ShippingRate } from "@/lib/landed-cost";
import { eq, desc, asc } from "drizzle-orm";

export type CompanyProfile = typeof companyProfile.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;

/** The vendor block for a proforma. Empty strings until Settings is filled in. */
export async function getCompanyProfile(companyId: number): Promise<CompanyProfile> {
  const row = await db
    .select()
    .from(companyProfile)
    .where(eq(companyProfile.companyId, companyId))
    .limit(1)
    .then(one);
  return (
    row ?? {
      companyId,
      companyName: "",
      addressLines: "",
      phone: "",
      email: "",
      website: "",
      taxId: "",
      logoPath: "",
      bankName: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankSwift: "",
      bankAddress: "",
      paymentTerms: "",
      incoterms: "",
      validityDays: 30,
      footerNote: "",
      functionalCurrency: "",
      updatedAt: "",
    }
  );
}

/** All registered accounts, the default first so pickers can lead with it. */
export async function getBankAccounts(companyId: number): Promise<BankAccount[]> {
  return db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.companyId, companyId))
    .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.id));
}

export { resolveProformaBank, type ProformaBank } from "@/lib/proforma-bank";

/** Every shipping estimate ever recorded, newest first: the log the settings page shows. */
export async function getShippingRates(companyId: number) {
  return db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.companyId, companyId))
    .orderBy(desc(shippingRates.effectiveFrom), desc(shippingRates.id));
}

/** The estimate in force per destination, for the landed-cost figure. */
export async function getLatestShippingRates(companyId: number): Promise<Partial<Record<Destination, ShippingRate>>> {
  const rows = await getShippingRates(companyId);
  const latest = latestPerDestination(rows);
  const out: Partial<Record<Destination, ShippingRate>> = {};
  for (const d of DESTINATIONS) {
    const row = latest.get(d);
    if (row) {
      out[d] = {
        destination: d,
        basis: row.basis,
        amount: row.amount,
        currency: row.currency,
        usableCbm: row.usableCbm,
        effectiveFrom: row.effectiveFrom,
      };
    }
  }
  return out;
}
