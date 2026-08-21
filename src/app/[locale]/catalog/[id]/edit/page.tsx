import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCategories, getProductById, getProductImages } from "@/lib/queries/catalog";
import { updateProduct } from "@/lib/actions/catalog";
import { ProductForm } from "@/components/catalog/product-form";
import { OfferManager } from "@/components/catalog/offer-manager";
import { getAllOffersForProduct, getActiveSuppliers } from "@/lib/queries/offers";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");

  const [categories, product, images, offers, suppliers] = await Promise.all([
    getCategories(),
    getProductById(productId),
    getProductImages(productId),
    getAllOffersForProduct(productId),
    getActiveSuppliers(),
  ]);

  if (!product) notFound();

  const boundUpdate = updateProduct.bind(null, productId);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("editProduct")}
      </h1>
      <ProductForm
        categories={categories}
        action={boundUpdate}
        defaultValues={product}
        existingImages={images.map((i) => ({ id: i.id, path: i.path }))}
        submitLabel={common("save")}
      />

      <div className="mt-10 border-t border-neutral-200 pt-8 dark:border-neutral-800">
        <OfferManager
          productId={productId}
          offers={offers.map((o) => ({
            id: o.id,
            supplierId: o.supplierId,
            supplierName: o.supplierName,
            price: o.price,
            currency: o.currency,
            moq: o.moq,
            leadTimeDays: o.leadTimeDays,
            quotedOn: o.quotedOn,
            note: o.note,
            active: o.active,
          }))}
          suppliers={suppliers.map((s) => ({ id: s.id, companyName: s.companyName }))}
        />
      </div>
    </div>
  );
}
