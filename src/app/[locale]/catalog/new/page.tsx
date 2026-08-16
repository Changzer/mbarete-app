import { getTranslations } from "next-intl/server";
import { getCategories } from "@/lib/queries/catalog";
import { createProduct } from "@/lib/actions/catalog";
import { ProductForm } from "@/components/catalog/product-form";

export default async function NewProductPage() {
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");
  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">
        {t("addProduct")}
      </h1>
      <ProductForm categories={categories} action={createProduct} submitLabel={common("save")} />
    </div>
  );
}
