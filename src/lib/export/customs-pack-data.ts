import { getOrderView } from "@/lib/queries/order-view";
import { getCompanyProfile } from "@/lib/queries/settings";
import { getProducts } from "@/lib/queries/catalog";
import { getSupplierOrigins } from "@/lib/queries/contacts";
import { convert, roundMoney, UnknownCurrencyError } from "@/lib/calculations";
import { parsePartiesSnapshot, usesFrozenParties } from "@/lib/parties-snapshot";
import { buildCustomsPack, type CustomsPack } from "@/lib/customs-pack";
import type { CustomsUnit } from "@/lib/customs";

function splitLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * One order as the customs pack reads it. Names come in both languages
 * (the declaration is Chinese, the invoice and contract English), so the
 * order is read once per locale; prices are the order's own, in its quote
 * currency; classification, declaration elements and unit are the live
 * product's — a code corrected after confirmation is the one to declare.
 */
export async function getCustomsPackData(companyId: number, orderId: number): Promise<{
  pack: CustomsPack;
  status: string;
} | null> {
  const [en, zh, company, products] = await Promise.all([
    getOrderView(companyId, orderId, "en"),
    getOrderView(companyId, orderId, "zh"),
    getCompanyProfile(companyId),
    getProducts(companyId),
  ]);
  if (!en || !zh) return null;
  const { order, client, rows, effectiveRates } = en;
  // A supplier's origin is read live, like the codes: a corrected one is the one to declare.
  const origins = await getSupplierOrigins(companyId, rows.flatMap((r) => (r.supplierId ? [r.supplierId] : [])));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const quote = order.displayCurrency;

  // The agreed parties as frozen at confirmation, like every document.
  const frozen = usesFrozenParties(order.status) ? parsePartiesSnapshot(order.partiesSnapshot) : null;
  const seller = frozen?.seller ?? {
    companyName: company.companyName,
    addressLines: company.addressLines,
    phone: company.phone,
    incoterms: company.incoterms,
    paymentTerms: company.paymentTerms,
  };
  const consignee = frozen?.client?.companyName ?? client?.companyName ?? "";

  const inQuote = (amount: number, from: string) => {
    if (from === quote) return amount;
    try {
      return convert(amount, from, quote, effectiveRates);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) return amount;
      throw err;
    }
  };

  const pack = buildCustomsPack({
    docNo: order.orderNumber,
    contractDate: order.exportContractDate ?? order.createdAt.slice(0, 10),
    exportDate: order.exportDate ?? "",
    customsDeclarationNo: order.customsDeclarationNo ?? "",
    companyName: seller.companyName,
    addressLines: splitLines(seller.addressLines),
    phone: seller.phone,
    consignee,
    incoterms: seller.incoterms,
    paymentTerms: splitLines(seller.paymentTerms),
    notes: order.notes ?? "",
    currency: quote,
    portOfLoading: order.portOfLoading,
    portOfDestination: order.portOfDestination,
    destinationCountry: order.destinationCountry,
    goodsOrigin: order.goodsOrigin,
    shippingMarks: order.shippingMarks,
    lines: rows.map((r) => {
      const product = productMap.get(r.productId);
      // Each language sorts its own names, so pair the lines by id.
      const zhRow = zh.rows.find((z) => z.id === r.id);
      return {
        nameZh: zhRow?.name ?? r.name,
        nameEn: r.name,
        cnHsCode: product?.cnHsCode ?? "",
        declarationElements: product?.declarationElements ?? "",
        unit: (product?.customsUnit ?? "pcs") as CustomsUnit,
        quantity: r.quantity,
        unitPrice: inQuote(r.sellPrice, r.sellCurrency),
        amount: roundMoney(inQuote(r.sellTotal, r.sellCurrency)),
        cartons: r.cartons,
        grossKg: r.lineWeightKg,
        cbm: r.lineCbm,
        supplier: zhRow?.supplierName ?? r.supplierName ?? "",
        goodsOrigin: (r.supplierId && origins.get(r.supplierId)) || "",
        perCarton: r.perCarton,
      };
    }),
  });
  return { pack, status: order.status };
}
