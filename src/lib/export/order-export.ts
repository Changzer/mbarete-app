import { getTranslations } from "next-intl/server";
import { getOrderView } from "@/lib/queries/order-view";
import {
  getCompanyProfile,
  getBankAccounts,
  resolveProformaBank,
} from "@/lib/queries/settings";
import { formatCbm, formatWeightKg } from "@/lib/calculations";
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
  };
  client: {
    name: string;
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

  const bank = resolveProformaBank(accounts, order.bankAccountId, company);
  const quote = order.displayCurrency;
  const issued = new Date(order.createdAt);
  const validUntil = new Date(issued);
  validUntil.setDate(validUntil.getDate() + company.validityDays);

  return {
    company: {
      name: company.companyName || t("yourCompany"),
      addressLines: splitLines(company.addressLines),
      phone: company.phone,
      email: company.email,
      website: company.website,
      taxId: company.taxId,
    },
    doc: {
      number: order.orderNumber,
      issuedOn: issued.toLocaleDateString(locale),
      validUntil:
        company.validityDays > 0 ? validUntil.toLocaleDateString(locale) : null,
      validityDays: company.validityDays,
      currency: quote,
    },
    client: client
      ? {
          name: client.companyName,
          contactPerson: client.contactPerson ?? "",
          phone: client.phone ?? "",
          email: client.email ?? "",
          whatsapp: client.whatsapp ?? "",
          wechat: client.wechat ?? "",
        }
      : null,
    terms: {
      incoterms: company.incoterms,
      paymentTerms: splitLines(company.paymentTerms),
      totalCartons: totals.totalCartons,
      totalCbm: formatCbm(totals.totalCbm),
      totalWeightKg: formatWeightKg(totals.totalWeightKg),
    },
    lines: rows.map((r) => ({
      name: r.name,
      sku: r.sku,
      quantity: r.quantity,
      cartons: r.cartons,
      unitPrice: r.sellPrice,
      amount: r.sellTotal,
      currency: r.currencySnapshot,
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
    footerNote: splitLines(company.footerNote),
    sellMissingCount: rows.filter((r) => r.sellMissing).length,
    labels: {
      title: t("title"),
      number: t("number"),
      date: t("date"),
      validUntil: t("validUntil"),
      billTo: t("billTo"),
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
