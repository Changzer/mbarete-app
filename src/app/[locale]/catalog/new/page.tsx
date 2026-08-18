import { getTranslations } from "next-intl/server";
import { getCategories, suggestNextSku } from "@/lib/queries/catalog";
import { createProduct } from "@/lib/actions/catalog";
import { ProductForm } from "@/components/catalog/product-form";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");
  const [categories, nextSku] = await Promise.all([getCategories(), suggestNextSku()]);

  // "Save and add another" comes back here carrying the category, so a run of
  // products from one supplier does not mean re-picking it every time.
  const categoryId = Number(category);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("addProduct")}
      </h1>
      <ProductForm
        categories={categories}
        action={createProduct}
        submitLabel={common("save")}
        showAddAnother
        defaultValues={{
          sku: nextSku,
          ...(Number.isFinite(categoryId) && categoryId > 0 ? { categoryId } : {}),
        }}
      />
    </div>
  );
}
