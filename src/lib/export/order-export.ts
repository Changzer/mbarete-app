import { getTranslations } from "next-intl/server";
import { getOrderView } from "@/lib/queries/order-view";
import {
  getCompanyProfile,
  getBankAccounts,
  resolveProformaBank,
} from "@/lib/queries/settings";
import { formatCbm, formatWeightKg } from "@/lib/calculations";
import { parsePartiesSnapshot, usesFrozenParties } from "@/lib/parties-snapshot";
import { getImagesByProduct, getProducts } from "@/lib/queries/catalog";
import { readExportThumb } from "./thumbs";
import type { Locale } from "@/i18n/routing";

/**
 * Everything the XLSX and PDF order exports print, assembled once so the two
 * files and the on-screen proforma can never disagree.
 *
 * Customer documents show the SELL price only. `getOrderView` already folds
 * the fallback in (cost stands in when no sell price was set) and flags those
 * rows with `sellMissing`, so callers can warn the agent before a file that
 * quotes cost leaves the building. The real cost is never in this structure.
 */
export type OrderExportLine = {
  name: string;
  sku: string;
  /** the factory's own style/model number; "" when none recorded */
  supplierCode: string;
  /** small product photo as JPEG bytes; null when the product has none */
  thumb: Buffer | null;
  quantity: number;
  cartons: number | null;
  unitPrice: number;
  amount: number;
  currency: string;
};

export type OrderExportData = {
  company: {
    name: string;
    addressLines: string[];
    phone: string;
    email: string;
    website: string;
    taxId: string;
  };
  doc: {
    number: string;
    issuedOn: string;
    validUntil: string | null;
    validityDays: number;
    currency: string;
    /**
     * A draft is a price quote — the client is still deciding — so the file
     * says "Price Quote" and carries no bill-to or terms block. Only a
     * confirmed/shipped order exports as a proforma invoice.
     */
    kind: "quote" | "invoice";
  };
  client: {
    name: string;
    address: string;
    taxId: string;
    contactPerson: string;
    phone: string;
    email: string;
    whatsapp: string;
    wechat: string;
  } | null;
  terms: {
    incoterms: string;
    paymentTerms: string[];
    totalCartons: number;
    totalCbm: string;
    totalWeightKg: string;
  };
  lines: OrderExportLine[];
  totals: {
    goods: number;
    commissionPct: number;
    commission: number;
    grandTotal: number;
    equivalents: { currency: string; amount: number }[];
  };
  bank: {
    accountName: string;
    bankName: string;
    accountNumber: string;
    swift: string;
    addressLines: string[];
  } | null;
  notes: string;
  footerNote: string[];
  /** count of lines quoting cost because no sell price was set */
  sellMissingCount: number;
  labels: Record<string, string>;
};

function splitLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function getOrderExportData(
  companyId: number,
  orderId: number,
  locale: Locale,
): Promise<OrderExportData | null> {
  const [view, company, accounts, t, orderT] = await Promise.all([
    getOrderView(companyId, orderId, locale),
    getCompanyProfile(companyId),
    getBankAccounts(companyId),
    getTranslations({ locale, namespace: "proforma" }),
    getTranslations({ locale, namespace: "orders" }),
  ]);
  if (!view) return null;
  const { order, client, rows, targets, totals } = view;
  // A draft is still a negotiation: the file is a price quote, not an invoice.
  const isQuote = order.status === "draft";

  // Product photos for the line items: the cropped thumbnail when the
  // transcription pass made one, else the first catalog photo.
  const productRows = await getProducts(companyId);
  const productMap = new Map(productRows.map((p) => [p.id, p]));
  const imagesByProduct = await getImagesByProduct(rows.map((r) => r.productId));
  const thumbs = await Promise.all(
    rows.map((r) => {
      const product = productMap.get(r.productId);
      return readExportThumb(
        product?.thumbPath || imagesByProduct.get(r.productId)?.[0] || null,
      );
    }),
  );

  // Confirmed and shipped documents render the parties frozen at
  // confirmation; a draft quote renders live data (see parties-snapshot.ts).
  const frozen = usesFrozenParties(order.status)
    ? parsePartiesSnapshot(order.partiesSnapshot)
    : null;
  const seller = frozen?.seller ?? {
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
  };
  const billTo = frozen
    ? frozen.client
    : client
      ? {
          companyName: client.companyName,
          address: client.boothLocation ?? "",
          taxId: client.taxId ?? "",
          contactPerson: client.contactPerson ?? "",
          phone: client.phone ?? "",
          email: client.email ?? "",
          whatsapp: client.whatsapp ?? "",
          wechat: client.wechat ?? "",
        }
      : null;
  const bank = frozen ? frozen.bank : resolveProformaBank(accounts, order.bankAccountId, company);
  const quote = order.displayCurrency;
  const issued = new Date(order.createdAt);
  const validUntil = new Date(issued);
  validUntil.setDate(validUntil.getDate() + seller.validityDays);

  return {
    company: {
      name: seller.companyName || t("yourCompany"),
      addressLines: splitLines(seller.addressLines),
      phone: seller.phone,
      email: seller.email,
      website: seller.website,
      taxId: seller.taxId,
    },
    doc: {
      number: order.orderNumber,
      issuedOn: issued.toLocaleDateString(locale),
      validUntil:
        seller.validityDays > 0 ? validUntil.toLocaleDateString(locale) : null,
      validityDays: seller.validityDays,
      currency: quote,
      kind: isQuote ? "quote" : "invoice",
    },
    // No bill-to on a quote: nothing is owed by anyone yet.
    client: !isQuote && billTo
      ? {
          name: billTo.companyName,
          address: billTo.address,
          taxId: billTo.taxId,
          contactPerson: billTo.contactPerson,
          phone: billTo.phone,
          email: billTo.email,
          whatsapp: billTo.whatsapp,
          wechat: billTo.wechat,
        }
      : null,
    terms: {
      incoterms: seller.incoterms,
      paymentTerms: splitLines(seller.paymentTerms),
      totalCartons: totals.totalCartons,
      totalCbm: formatCbm(totals.totalCbm),
      totalWeightKg: formatWeightKg(totals.totalWeightKg),
    },
    lines: rows.map((r, i) => ({
      name: r.name,
      sku: r.sku,
      supplierCode: r.supplierCode,
      thumb: thumbs[i],
      quantity: r.quantity,
      cartons: r.cartons,
      unitPrice: r.sellPrice,
      amount: r.sellTotal,
      currency: r.sellCurrency,
    })),
    totals: {
      goods: totals.goods[quote] ?? 0,
      commissionPct: order.commissionPct,
      commission: totals.commission[quote] ?? 0,
      grandTotal: totals.grandTotal[quote] ?? 0,
      equivalents: targets
        .filter((c) => c !== quote)
        .map((c) => ({ currency: c, amount: totals.grandTotal[c] ?? 0 })),
    },
    bank: bank
      ? {
          accountName: bank.accountName,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          swift: bank.swift,
          addressLines: splitLines(bank.bankAddress),
        }
      : null,
    notes: order.notes ?? "",
    footerNote: splitLines(seller.footerNote),
    sellMissingCount: rows.filter((r) => r.sellMissing).length,
    labels: {
      title: isQuote ? t("quoteTitle") : t("title"),
      photo: t("photo"),
      number: t("number"),
      date: t("date"),
      validUntil: t("validUntil"),
      billTo: t("billTo"),
      address: t("address"),
      attn: t("attn"),
      phone: t("phone"),
      email: t("email"),
      website: t("website"),
      taxId: t("taxId"),
      terms: t("terms"),
      incoterms: t("incoterms"),
      currency: t("currency"),
      item: t("item"),
      sku: t("sku"),
      quantity: t("quantity"),
      cartons: t("cartons"),
      unitPrice: t("unitPrice"),
      amount: t("amount"),
      bankDetails: t("bankDetails"),
      bankAccountName: t("bankAccountName"),
      bankName: t("bankName"),
      bankAccountNumber: t("bankAccountNumber"),
      bankSwift: t("bankSwift"),
      equivalent: t("equivalent"),
      goodsSubtotal: orderT("goodsSubtotal"),
      commissionAmount: orderT("commissionAmount"),
      grandTotal: orderT("grandTotal"),
      notes: orderT("notes"),
      totalCartons: orderT("totalCartons"),
      totalCbm: orderT("totalCbm"),
      totalWeight: orderT("totalWeight"),
      validityNote: t("validityNote", { days: company.validityDays }),
    },
  };
}
