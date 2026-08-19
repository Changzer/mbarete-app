import { db } from "@/db";
import { companyProfile, bankAccounts } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";

export type CompanyProfile = typeof companyProfile.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;

/** The vendor block for a proforma. Empty strings until Settings is filled in. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  const row = db.select().from(companyProfile).where(eq(companyProfile.id, 1)).get();
  return (
    row ?? {
      id: 1,
      companyName: "",
      addressLines: "",
      phone: "",
      email: "",
      website: "",
      taxId: "",
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
export async function getBankAccounts(): Promise<BankAccount[]> {
  return db
    .select()
    .from(bankAccounts)
    .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.id))
    .all();
}

export { resolveProformaBank, type ProformaBank } from "@/lib/proforma-bank";
