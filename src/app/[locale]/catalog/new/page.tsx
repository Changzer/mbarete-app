import { getTranslations } from "next-intl/server";
import { getCategories, getProductById, suggestNextSku } from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { createProduct } from "@/lib/actions/catalog";
import { transcribeProduct, transcribeCard } from "@/lib/actions/transcribe";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { ProductForm } from "@/components/catalog/product-form";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; from?: string; supplier?: string }>;
}) {
  const { category, from, supplier } = await searchParams;
  const t = await getTranslations("catalog");
  const common = await getTranslations("common");
  const [categories, suppliers, nextSku] = await Promise.all([
    getCategories(),
    getSuppliersForPicker(),
    suggestNextSku(),
  ]);

  // "Save and add another" comes back here carrying the category — and the
  // supplier, so a run of products from one booth keeps its vendor.
  const categoryId = Number(category);
  const supplierId = Number(supplier);

  // Duplicating for comparison shopping: everything descriptive is copied,
  // but the SKU is fresh, the buy price is blank (this booth's price is the
  // datum being collected — and blank is what lets "Fill from photos" write
  // it), and photos and supplier stay empty because they belong to the other
  // vendor. The source id rides along as lineage for later comparison.
  const fromId = Number(from);
  const source = Number.isFinite(fromId) && fromId > 0 ? await getProductById(fromId) : undefined;
  const duplicateDefaults = source
    ? {
        nameEn: source.nameEn,
        nameZh: source.nameZh,
        categoryId: source.categoryId,
        descriptionEn: source.descriptionEn,
        descriptionZh: source.descriptionZh,
        sellPrice: source.sellPrice,
        currency: source.currency,
        moq: source.moq,
        qtyPerBox: source.qtyPerBox,
        lengthCm: source.lengthCm,
        widthCm: source.widthCm,
        heightCm: source.heightCm,
        weightKg: source.weightKg,
        dimensionSource: source.dimensionSource,
        pieceLengthCm: source.pieceLengthCm,
        pieceWidthCm: source.pieceWidthCm,
        pieceHeightCm: source.pieceHeightCm,
        pieceWeightKg: source.pieceWeightKg,
        packingAllowancePct: source.packingAllowancePct,
        active: source.active,
        duplicatedFromId: source.id,
      }
    : {};

  const aiEnabled = isTranscriptionEnabled();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {source ? t("duplicateProduct") : t("addProduct")}
      </h1>
      <ProductForm
        categories={categories}
        suppliers={suppliers}
        action={createProduct}
        submitLabel={common("save")}
        showAddAnother
        transcribe={aiEnabled ? transcribeProduct : undefined}
        transcribeCard={aiEnabled ? transcribeCard : undefined}
        defaultValues={{
          ...duplicateDefaults,
          sku: nextSku,
          ...(Number.isFinite(categoryId) && categoryId > 0 ? { categoryId } : {}),
          ...(Number.isFinite(supplierId) && supplierId > 0 ? { supplierId } : {}),
        }}
      />
    </div>
  );
}
