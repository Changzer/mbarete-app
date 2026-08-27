import { db, one } from "@/db";
import { companyProfile, bankAccounts } from "@/db/schema";
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
