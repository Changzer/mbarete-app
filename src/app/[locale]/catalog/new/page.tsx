import { getTranslations } from "next-intl/server";
import { getCategories, getProductById, suggestNextSku } from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { getDraftById } from "@/lib/queries/drafts";
import { createProduct } from "@/lib/actions/catalog";
import { transcribeProduct, transcribeCard } from "@/lib/actions/transcribe";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { ProductForm } from "@/components/catalog/product-form";
import { normalizeDecimalInput } from "@/lib/decimal-input";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; from?: string; supplier?: string; draft?: string }>;
}) {
  const { category, from, supplier, draft } = await searchParams;
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

  // Reviewing a capture draft: what was typed at the booth wins over what the
  // AI read off the photos, and both land here as ordinary defaults for the
  // person to proofread — the same posture as live transcription. The photos
  // are already on the server under the draft; saving moves them across.
  const draftId = Number(draft);
  const openDraft = Number.isFinite(draftId) && draftId > 0 ? await getDraftById(draftId) : undefined;
  const reviewable =
    openDraft &&
    openDraft.kind === "product" &&
    (openDraft.status === "pending" || openDraft.status === "read")
      ? openDraft
      : undefined;

  // Draft field values arrive as posted — strings, possibly comma-decimals —
  // and go through the same normalizer the save itself would apply.
  const num = (v: string | number | undefined) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(normalizeDecimalInput(String(v)));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const draftDefaults = reviewable
    ? (() => {
        const f = reviewable.fields;
        const tr = reviewable.transcript;
        const catId = num(f.categoryId) ?? tr.categoryId;
        const supId = num(f.supplierId);
        return {
          sku: f.sku || undefined,
          nameEn: f.nameEn || tr.nameEn,
          nameZh: f.nameZh || tr.nameZh,
          descriptionEn: f.descriptionEn || tr.descriptionEn,
          descriptionZh: f.descriptionZh || tr.descriptionZh,
          price: num(f.price) ?? tr.price,
          sellPrice: num(f.sellPrice),
          currency: f.currency || tr.currency,
          moq: num(f.moq) ?? tr.moq,
          qtyPerBox: num(f.qtyPerBox) ?? tr.qtyPerBox,
          lengthCm: num(f.lengthCm) ?? tr.lengthCm,
          widthCm: num(f.widthCm) ?? tr.widthCm,
          heightCm: num(f.heightCm) ?? tr.heightCm,
          weightKg: num(f.weightKg) ?? tr.weightKg,
          cbmOverride: num(f.cbmOverride) ?? tr.cbm,
          dimensionSource: f.dimensionSource === "piece" ? ("piece" as const) : ("carton" as const),
          pieceLengthCm: num(f.pieceLengthCm),
          pieceWidthCm: num(f.pieceWidthCm),
          pieceHeightCm: num(f.pieceHeightCm),
          pieceWeightKg: num(f.pieceWeightKg),
          packingAllowancePct: num(f.packingAllowancePct),
          active: f.active === undefined || f.active === "on",
          ...(catId && categories.some((c) => c.id === catId) ? { categoryId: catId } : {}),
          ...(supId && suppliers.some((s) => s.id === supId) ? { supplierId: supId } : {}),
        };
      })()
    : undefined;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {reviewable ? t("reviewDraft") : source ? t("duplicateProduct") : t("addProduct")}
      </h1>
      <ProductForm
        categories={categories}
        suppliers={suppliers}
        action={createProduct}
        submitLabel={common("save")}
        showAddAnother
        // Duplicating carries the source product's category, which is real
        // data. The sticky category from "save & add another" is only a
        // default and must stay overridable by the photos.
        lockCategory={Boolean(source)}
        transcribe={aiEnabled ? transcribeProduct : undefined}
        transcribeCard={aiEnabled ? transcribeCard : undefined}
        draftId={reviewable?.id}
        draftImages={reviewable?.images.filter((i) => i.role === "image")}
        defaultValues={{
          ...duplicateDefaults,
          ...draftDefaults,
          sku: draftDefaults?.sku ?? nextSku,
          ...(Number.isFinite(categoryId) && categoryId > 0 ? { categoryId } : {}),
          ...(Number.isFinite(supplierId) && supplierId > 0 ? { supplierId } : {}),
        }}
      />
    </div>
  );
}
