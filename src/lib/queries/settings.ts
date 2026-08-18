import { db } from "@/db";
import { companyProfile } from "@/db/schema";
import { eq } from "drizzle-orm";

export type CompanyProfile = typeof companyProfile.$inferSelect;

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
