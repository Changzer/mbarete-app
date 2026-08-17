import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCategories, getProductById } from "@/lib/queries/catalog";
import { updateProduct } from "@/lib/actions/catalog";
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

  const [categories, product] = await Promise.all([
    getCategories(),
    getProductById(productId),
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
        submitLabel={common("save")}
      />
    </div>
  );
}
