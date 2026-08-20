import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCategories, getProductById, getProductImages } from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { updateProduct } from "@/lib/actions/catalog";
import { transcribeProduct, transcribeCard } from "@/lib/actions/transcribe";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { ProductForm } from "@/components/catalog/product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");

  const [categories, suppliers, product, images] = await Promise.all([
    getCategories(),
    getSuppliersForPicker(),
    getProductById(productId),
    getProductImages(productId),
  ]);

  if (!product) notFound();

  const boundUpdate = updateProduct.bind(null, productId);
  const aiEnabled = isTranscriptionEnabled();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("editProduct")}
      </h1>
      <ProductForm
        categories={categories}
        suppliers={suppliers}
        action={boundUpdate}
        defaultValues={{
          ...product,
          supplierId: product.supplierId ?? undefined,
          // Lineage is not editable; the update action leaves it untouched.
          duplicatedFromId: undefined,
        }}
        existingImages={images.map((i) => ({ id: i.id, path: i.path }))}
        submitLabel={common("save")}
        transcribe={aiEnabled ? transcribeProduct : undefined}
        transcribeCard={aiEnabled ? transcribeCard : undefined}
      />
    </div>
  );
}
