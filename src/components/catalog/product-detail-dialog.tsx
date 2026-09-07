"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { authenticatedUploadLoader } from "@/lib/client/upload-image-loader";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "@/lib/actions/catalog";
import { useIsAdmin } from "@/components/role-provider";
import { formatCbm, formatWeightKg, missingCartonFigures } from "@/lib/calculations";
import { formatMoney } from "@/lib/money";
import { SupplierPrices } from "@/components/catalog/supplier-prices";
import type { CatalogProduct } from "@/components/catalog/product-card";

/**
 * The product detail sheet: photos with a lightbox, the ranked quotes, pack
 * and carton figures, who touched it, and the edit/duplicate actions. The
 * catalog row opens it; so does a product name on an order line, which is
 * why it takes the product and the open state rather than owning a trigger.
 */
export function ProductDetailDialog({
  product,
  open,
  onOpenChange,
  allowDelete = true,
}: {
  product: CatalogProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Off where deleting would be a surprise — an order being built. */
  allowDelete?: boolean;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const isAdmin = useIsAdmin();
  const [zoom, setZoom] = useState(false);
  const [index, setIndex] = useState(0);
  const setOpen = onOpenChange;

  // Back to the first photo each time it opens, adjusted during render so
  // the dialog never paints once at a stale index.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setIndex(0);
      setZoom(false);
    }
  }

  const estimated = product.dimensionSource === "piece";
  // Registered without measurements — shown as unknown, never as zero.
  const unmeasured = missingCartonFigures(product);
  const count = product.images.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count],
  );
  const openDialog = useCallback(
    (next: boolean) => {
      if (!next) setZoom(false);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Arrow keys page through the carousel while the dialog is open.
  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, go]);

  return (
    <>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>
              {product.altName ? `${product.altName} · ` : ""}
              {product.categoryName} ·{" "}
              <span className="font-mono">{product.sku}</span>
            </DialogDescription>
          </DialogHeader>

          {count > 0 ? (
            <div className="flex flex-col gap-2">
              {/* object-contain so the whole photo is visible, never cropped */}
              <div className="relative h-64 w-full overflow-hidden rounded-[10px] bg-surface-2 sm:h-72">
                <button
                  type="button"
                  aria-label={common("enlarge")}
                  onClick={() => setZoom(true)}
                  className="absolute inset-0 cursor-zoom-in"
                >
                  <Image
                    src={product.images[index]}
                    loader={authenticatedUploadLoader}
                    alt={`${product.name} ${index + 1}/${count}`}
                    fill
                    sizes="(max-width: 640px) 90vw, 512px"
                    className="object-contain"
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-[rgba(20,12,8,.6)] p-1.5 text-white">
                    <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                  </span>
                </button>

                {count > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label={common("previous")}
                      onClick={() => go(-1)}
                      className="press focus-ring absolute left-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow"
                    >
                      <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      aria-label={common("next")}
                      onClick={() => go(1)}
                      className="press focus-ring absolute right-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow"
                    >
                      <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                    <span className="absolute bottom-2 right-2 z-10 rounded-full bg-[rgba(20,12,8,.6)] px-2 py-0.5 font-mono text-[11px] text-white">
                      {index + 1} / {count}
                    </span>
                  </>
                ) : null}
              </div>

              {count > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {product.images.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={`focus-ring relative h-14 w-14 overflow-hidden rounded-[8px] border-2 bg-surface-2 ${
                        i === index ? "border-action" : "border-line"
                      }`}
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                        loader={authenticatedUploadLoader}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
            {/* Cost is no longer one number: it is whoever is quoting, best
                first, with the gap to the others. MOQ rides with each quote,
                which is why it left this grid. */}
            <div className="col-span-2">
              <dt className="text-[11px] font-semibold text-sub">{t("costPrice")}</dt>
              <dd className="mt-1">
                <SupplierPrices offers={product.offers} sellPrice={product.sellPrice} />
              </dd>
            </div>
            <Figure label={t("sellPrice")} testId="card-sell-price">
              {product.sellPrice > 0
                ? formatMoney(product.sellPrice, product.currency)
                : t("sellsAtCost")}
            </Figure>
            <Figure label={t("qtyPerBox")}>{product.qtyPerBox}</Figure>
            <Figure label={estimated ? t("pieceSize") : t("size")}>
              {estimated
                ? `${product.pieceLengthCm}×${product.pieceWidthCm}×${product.pieceHeightCm}`
                : product.lengthCm > 0 || product.widthCm > 0 || product.heightCm > 0
                  ? `${product.lengthCm}×${product.widthCm}×${product.heightCm}`
                  : t("notRecorded")}
            </Figure>
            <Figure label={t("weight")} estimated={estimated} estimatedLabel={t("estimated")}>
              {product.weightKg > 0 ? `${formatWeightKg(product.weightKg)} kg` : t("notRecorded")}
            </Figure>
            <Figure label={t("cbm")} estimated={estimated} estimatedLabel={t("estimated")}>
              {product.cbm > 0 ? `${formatCbm(product.cbm)} m³` : t("notRecorded")}
            </Figure>
          </dl>

          {unmeasured ? (
            <p
              className="rounded-[10px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn"
              data-testid="unmeasured-note"
            >
              {t("notMeasuredYet")}
            </p>
          ) : null}

          {estimated ? (
            <p
              className="rounded-[10px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn"
              data-testid="estimated-note"
            >
              {t("estimatedFromPiece")}
            </p>
          ) : null}

          {product.supplierName ? (
            <dl className="border-t border-line pt-3">
              <dt className="text-[11px] font-semibold text-sub">{t("supplier")}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-ink" data-testid="card-supplier">
                {product.supplierName}
                {product.supplierBooth ? (
                  <span className="ml-1.5 font-mono text-[12px] font-normal text-sub">
                    {product.supplierBooth}
                  </span>
                ) : null}
              </dd>
            </dl>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-3 text-[13px]">
            <Figure label={t("addedBy")} testId="product-added-by" mono={false}>
              {product.createdByName ?? t("unknownUser")}
            </Figure>
            <Figure label={t("updatedBy")} testId="product-updated-by" mono={false}>
              {product.updatedByName ?? t("unknownUser")}
            </Figure>
          </dl>

          {product.description ? (
            <div>
              <p className="text-[11px] font-semibold text-sub">{t("description")}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                {product.description}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            {isAdmin && allowDelete ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (confirm(t("deleteConfirm"))) {
                    const error = await deleteProduct(product.id);
                    if (error) {
                      alert(t("deleteOnOrders"));
                      return;
                    }
                    setOpen(false);
                  }
                }}
              >
                {common("delete")}
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm" data-testid="duplicate-product">
              {/* Prefills a fresh registration from this product: new SKU,
                  blank buy price, no photos or supplier — the compare-vendors loop. */}
              <Link href={`/catalog/new?from=${product.id}`}>{t("duplicate")}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/catalog/${product.id}/edit`}>{common("edit")}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Full-screen view of the photo currently selected in the detail dialog.
        It shares `index` with the carousel, so paging here also moves the
        carousel underneath, and the arrow-key handler above keeps working
        because the detail dialog stays open behind this one.
      */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent
          hideClose
          className="flex h-[92vh] max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[20px] bg-surface p-3 sm:h-[92vh] sm:w-[96vw] sm:max-w-none sm:rounded-[16px]"
        >
          <DialogTitle className="sr-only">{product.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {count > 1 ? `${index + 1} / ${count}` : product.sku}
          </DialogDescription>

          {count > 0 ? (
            <div className="relative min-h-0 flex-1">
              {/* Clicking the photo closes again, the usual lightbox gesture. */}
              <button
                type="button"
                aria-label={common("close")}
                onClick={() => setZoom(false)}
                className="absolute inset-0 cursor-zoom-out"
              >
                <Image
                  src={product.images[index]}
                  loader={authenticatedUploadLoader}
                  alt={`${product.name} ${index + 1}/${count}`}
                  fill
                  sizes="96vw"
                  className="object-contain"
                  priority
                />
              </button>

              {count > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label={common("previous")}
                    onClick={() => go(-1)}
                    className="press focus-ring absolute left-1 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow"
                  >
                    <ChevronLeft className="h-6 w-6" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    aria-label={common("next")}
                    onClick={() => go(1)}
                    className="press focus-ring absolute right-1 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow"
                  >
                    <ChevronRight className="h-6 w-6" strokeWidth={1.5} />
                  </button>
                  <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[rgba(20,12,8,.6)] px-3 py-1 font-mono text-[12px] text-white">
                    {index + 1} / {count}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A label above its figure, with the figure in the data register by default. */
function Figure({
  label,
  children,
  testId,
  mono = true,
  estimated,
  estimatedLabel,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
  mono?: boolean;
  estimated?: boolean;
  estimatedLabel?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold text-sub">{label}</dt>
      <dd
        className={`mt-0.5 font-semibold text-ink ${mono ? "font-mono tabular-nums" : ""}`}
        data-testid={testId}
      >
        {children}
        {estimated ? (
          <span className="ml-1 font-sans text-[11px] font-medium text-warn">
            ({estimatedLabel})
          </span>
        ) : null}
      </dd>
    </div>
  );
}
