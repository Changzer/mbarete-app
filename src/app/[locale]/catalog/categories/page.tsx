import { getTranslations } from "next-intl/server";
import { getCategories } from "@/lib/queries/catalog";
import { CategoryManager } from "@/components/catalog/category-manager";

export default async function CategoriesPage() {
  const t = await getTranslations("catalog");
  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
        {t("manageCategories")}
      </h1>
      <CategoryManager categories={categories} />
    </div>
  );
}
