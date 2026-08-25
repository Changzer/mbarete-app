import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { isEditable } from "@/lib/order-status";
import { getTranslations } from "next-intl/server";
import { getOrderById, getExchangeRates } from "@/lib/queries/orders";
import { getCategories, getProducts, getImagesByProduct } from "@/lib/queries/catalog";
import { getContactsByType } from "@/lib/queries/contacts";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { OrderBuilder, type BuilderProduct } from "@/components/orders/order-builder";
import { requireUser, requireModulePage } from "@/lib/authz";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const _mbUser = await requireUser();
  const { companyId } = _mbUser;
  await requireModulePage(_mbUser, "orders");
  const { id, locale } = await params;
  const t = await getTranslations("orders");

  const data = await getOrderById(companyId, Number(id));
  if (!data) notFound();
  const { order, items } = data;

  // Shipped orders are history — the edit URL bounces back to the record.
  if (!isEditable(order.status)) {
    redirect({ href: `/orders/${order.id}`, locale: locale as Locale });
  }

  const [allProducts, categories, clients, suppliers, rates] = await Promise.all([
    getProducts(companyId, { activeOnly: false }),
    getCategories(companyId),
    getContactsByType(companyId, "client"),
    getContactsByType(companyId, "supplier"),
    getExchangeRates(companyId),
  ]);
  const onOrder = new Set(items.map((i) => i.productId));
  const products = allProducts.filter((p) => p.active || onOrder.has(p.id));
  const imagesByProduct = await getImagesByProduct(products.map((p) => p.id));

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const itemByProduct = new Map(items.map((i) => [i.productId, i]));

  const builderProducts: BuilderProduct[] = products.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    const base = {
      id: p.id,
      sku: p.sku,
      name: localizeField(locale as Locale, p.nameEn, p.nameZh),
      categoryId: p.categoryId,
      categoryName: cat ? localizeField(locale as Locale, cat.nameEn, cat.nameZh) : "",
      thumbPath: p.thumbPath || imagesByProduct.get(p.id)?.[0] || null,
      supplierId: p.supplierId,
      price: p.price,
      sellPrice: p.sellPrice,
      currency: p.currency,
      moq: p.moq,
      qtyPerBox: p.qtyPerBox,
      weightKg: p.weightKg,
      cbm: p.cbm,
      dimensionSource: p.dimensionSource,
    };
    // A product already on the order shows the LINE's frozen terms, not the
    // live catalog — the builder's preview then matches exactly what the
    // server preserves on save. Newly picked products use live values,
    // which is exactly what the server snapshots for a new line.
    const line = itemByProduct.get(p.id);
    if (!line) return base;
    const snapName = localizeField(locale as Locale, line.nameEnSnapshot, line.nameZhSnapshot);
    return {
      ...base,
      price: line.unitPriceSnapshot,
      currency: line.currencySnapshot,
      moq: line.moqSnapshot,
      sku: line.skuSnapshot || base.sku,
      name: snapName || base.name,
      ...(line.qtyPerBoxSnapshot > 0
        ? {
            qtyPerBox: line.qtyPerBoxSnapshot,
            cbm: line.cartonCbmSnapshot,
            weightKg: line.cartonWeightSnapshot,
          }
        : {}),
    };
  });

  const builderCategories = categories.map((c) => ({
    id: c.id,
    name: localizeField(locale as Locale, c.nameEn, c.nameZh),
  }));

  // Only suppliers that can actually return a product from this list.
  const supplierIdsInList = new Set(builderProducts.map((p) => p.supplierId));
  const builderSuppliers = suppliers
    .filter((s) => supplierIdsInList.has(s.id))
    .map((s) => ({
      id: s.id,
      name: localizeField(locale as Locale, s.companyName, s.companyNameZh),
    }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
        {order.orderNumber} — {t("newOrder")}
      </h1>
      <OrderBuilder
        mode="edit"
        orderId={order.id}
        products={builderProducts}
        categories={builderCategories}
        suppliers={builderSuppliers}
        clients={clients}
        rates={rates}
        initial={{
          status: order.status === "confirmed" ? "confirmed" : "draft",
          version: order.version,
          clientId: order.clientId,
          displayCurrency: order.displayCurrency,
          secondaryCurrency: order.secondaryCurrency,
          commissionPct: order.commissionPct,
          notes: order.notes,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            // Orders saved before selling prices carry 0: they sold at cost.
            sellPrice:
              i.sellPriceSnapshot > 0 ? i.sellPriceSnapshot : i.unitPriceSnapshot,
          })),
        }}
      />
    </div>
  );
}
