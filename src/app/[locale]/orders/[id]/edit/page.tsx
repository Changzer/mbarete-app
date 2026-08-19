import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderById, getExchangeRates } from "@/lib/queries/orders";
import { getCategories, getProducts } from "@/lib/queries/catalog";
import { getContactsByType } from "@/lib/queries/contacts";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { OrderBuilder, type BuilderProduct } from "@/components/orders/order-builder";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations("orders");

  const data = await getOrderById(Number(id));
  if (!data) notFound();
  const { order, items } = data;

  const [products, categories, clients, rates] = await Promise.all([
    getProducts({ activeOnly: true }),
    getCategories(),
    getContactsByType("client"),
    getExchangeRates(),
  ]);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const builderProducts: BuilderProduct[] = products.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    return {
      id: p.id,
      sku: p.sku,
      name: localizeField(locale as Locale, p.nameEn, p.nameZh),
      categoryId: p.categoryId,
      categoryName: cat ? localizeField(locale as Locale, cat.nameEn, cat.nameZh) : "",
      price: p.price,
      sellPrice: p.sellPrice,
      currency: p.currency,
      moq: p.moq,
      qtyPerBox: p.qtyPerBox,
      weightKg: p.weightKg,
      cbm: p.cbm,
      dimensionSource: p.dimensionSource,
    };
  });

  const builderCategories = categories.map((c) => ({
    id: c.id,
    name: localizeField(locale as Locale, c.nameEn, c.nameZh),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {order.orderNumber} — {t("newOrder")}
      </h1>
      <OrderBuilder
        mode="edit"
        orderId={order.id}
        products={builderProducts}
        categories={builderCategories}
        clients={clients}
        rates={rates}
        initial={{
          status: order.status === "confirmed" ? "confirmed" : "draft",
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
