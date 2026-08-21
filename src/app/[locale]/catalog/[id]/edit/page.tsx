import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCategories, getProductById, getProductImages } from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { updateProduct } from "@/lib/actions/catalog";
import { transcribeProduct, transcribeCard } from "@/lib/actions/transcribe";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { ProductForm } from "@/components/catalog/product-form";
import { computeCbm } from "@/lib/calculations";
import { OfferManager } from "@/components/catalog/offer-manager";
import { getAllOffersForProduct } from "@/lib/queries/offers";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");

  const [categories, suppliers, product, images, offers] = await Promise.all([
    getCategories(),
    getSuppliersForPicker(),
    getProductById(productId),
    getProductImages(productId),
    getAllOffersForProduct(productId),
  ]);

  if (!product) notFound();

  const boundUpdate = updateProduct.bind(null, productId);
  const aiEnabled = isTranscriptionEnabled();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-ink">
        {t("editProduct")}
      </h1>
      <ProductForm
        categories={categories}
        suppliers={suppliers}
        action={boundUpdate}
        defaultValues={{
          ...product,
          // A stored CBM the dimensions cannot explain was quoted by the
          // vendor (cbmOverride); surface it so saving the edit keeps it.
          cbmOverride:
            product.dimensionSource === "carton" &&
            product.cbm > 0 &&
            computeCbm(product.lengthCm, product.widthCm, product.heightCm) === 0
              ? product.cbm
              : undefined,
          supplierId: product.supplierId ?? undefined,
          // Lineage is not editable; the update action leaves it untouched.
          duplicatedFromId: undefined,
        }}
        existingImages={images.map((i) => ({ id: i.id, path: i.path }))}
        submitLabel={common("save")}
        lockCategory
        transcribe={aiEnabled ? transcribeProduct : undefined}
        transcribeCard={aiEnabled ? transcribeCard : undefined}
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
