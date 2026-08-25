import { db, one } from "@/db";
import { contacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCompanyProfile, getBankAccounts } from "@/lib/queries/settings";
import { resolveProformaBank, type ProformaBank } from "@/lib/proforma-bank";

/**
 * The parties to an order, as they stood the moment it was CONFIRMED.
 *
 * A confirmed proforma is a promise: the client it names, the seller block,
 * the bank the money goes to. All three live in master data that keeps
 * being edited — so confirmation copies them onto the order, and confirmed
 * or shipped documents render this copy, never the live rows. Line-level
 * facts (names, SKUs, prices, logistics) are frozen on the lines
 * themselves; this covers everything AROUND the table.
 *
 * Reopening to draft discards the copy (drafts render live), re-confirming
 * takes a fresh one — which is revisioning without the machinery. Backfilled
 * copies for orders confirmed before this existed carry `reconstructed`,
 * because they were taken from master data as it stood at migration time,
 * not at confirmation.
 */
export type PartiesSnapshot = {
  v: 1;
  frozenAt: string;
  reconstructed?: true;
  client: {
    companyName: string;
    address: string;
    taxId: string;
    contactPerson: string;
    phone: string;
    email: string;
    whatsapp: string;
    wechat: string;
  } | null;
  seller: {
    companyName: string;
    addressLines: string;
    phone: string;
    email: string;
    website: string;
    taxId: string;
    incoterms: string;
    paymentTerms: string;
    footerNote: string;
    validityDays: number;
  };
  bank: ProformaBank | null;
};

export async function buildPartiesSnapshot(
  companyId: number,
  clientId: number,
  bankAccountId: number | null,
  opts?: { reconstructed?: boolean },
): Promise<string> {
  const [client, company, accounts] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), eq(contacts.id, clientId)))
      .limit(1)
      .then(one),
    getCompanyProfile(companyId),
    getBankAccounts(companyId),
  ]);

  const snapshot: PartiesSnapshot = {
    v: 1,
    frozenAt: new Date().toISOString(),
    ...(opts?.reconstructed ? { reconstructed: true as const } : {}),
    client: client
      ? {
          companyName: client.companyName,
          // The contact's booth/address field is the client's address.
          address: client.boothLocation ?? "",
          taxId: client.taxId ?? "",
          contactPerson: client.contactPerson ?? "",
          phone: client.phone ?? "",
          email: client.email ?? "",
          whatsapp: client.whatsapp ?? "",
          wechat: client.wechat ?? "",
        }
      : null,
    seller: {
      companyName: company.companyName,
      addressLines: company.addressLines,
      phone: company.phone,
      email: company.email,
      website: company.website,
      taxId: company.taxId,
      incoterms: company.incoterms,
      paymentTerms: company.paymentTerms,
      footerNote: company.footerNote,
      validityDays: company.validityDays,
    },
    bank: resolveProformaBank(accounts, bankAccountId, company),
  };
  return JSON.stringify(snapshot);
}

/** The stored copy, or null when absent or unreadable (renders live then). */
export function parsePartiesSnapshot(raw: string | null): PartiesSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PartiesSnapshot;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether documents for this status render the frozen copy or live data. */
export function usesFrozenParties(status: string): boolean {
  return status !== "draft";
}
