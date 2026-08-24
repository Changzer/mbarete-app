import { getTranslations } from "next-intl/server";
import { getCategories, getProducts, getImagesByProduct } from "@/lib/queries/catalog";
import { getContactsByType } from "@/lib/queries/contacts";
import { getExchangeRates } from "@/lib/queries/orders";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { OrderBuilder, type BuilderProduct } from "@/components/orders/order-builder";
import { requireUser } from "@/lib/authz";

export default async function NewOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { companyId } = await requireUser();
  const { locale } = await params;
  const t = await getTranslations("orders");

  const [products, categories, clients, suppliers, rates] = await Promise.all([
    getProducts(companyId, { activeOnly: true }),
    getCategories(companyId),
    getContactsByType(companyId, "client"),
    getContactsByType(companyId, "supplier"),
    getExchangeRates(companyId),
  ]);
  const imagesByProduct = await getImagesByProduct(products.map((p) => p.id));

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const builderProducts: BuilderProduct[] = products.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    return {
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
      <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">{t("newOrder")}</h1>
      <OrderBuilder
        mode="create"
        products={builderProducts}
        categories={builderCategories}
        suppliers={builderSuppliers}
        clients={clients}
        rates={rates}
      />
    </div>
  );
}
