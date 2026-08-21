"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "@/lib/actions/catalog";
import { formatCbm, formatWeightKg, missingCartonFigures } from "@/lib/calculations";
import { SupplierPrices, type CardOffer } from "@/components/catalog/supplier-prices";

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  description: string;
  categoryName: string;
  price: number;
  sellPrice: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  cbm: number;
  dimensionSource: "carton" | "piece";
  createdByName: string | null;
  updatedByName: string | null;
  pieceLengthCm: number;
  pieceWidthCm: number;
  pieceHeightCm: number;
  images: string[];
  active: boolean;
  supplierName: string | null;
  supplierBooth: string | null;
  /** Every supplier selling this, best first. Empty until one is attached. */
  offers: CardOffer[];
};

export function ProductCard({ product }: { product: CatalogProduct }) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [index, setIndex] = useState(0);

  const estimated = product.dimensionSource === "piece";
  // Registered without measurements — shown as unknown, never as zero.
  const unmeasured = missingCartonFigures(product);
  const count = product.images.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count],
  );

  // Reset to the first photo on open, set during the event rather than in an
  // effect so the dialog does not render once at a stale index first.
  const openDialog = useCallback((next: boolean) => {
    if (next) setIndex(0);
    else setZoom(false);
    setOpen(next);
  }, []);

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
      <Card
        className="group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-600/40 hover:shadow-lg dark:hover:border-brand-500/40"
        onClick={() => openDialog(true)}
      >
        <div className="relative aspect-square w-full bg-neutral-100 dark:bg-neutral-800">
          {count > 0 ? (
            <Image
              src={product.images[0]}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
              {t("image")}
            </div>
          )}
          {count > 1 ? (
            <Badge variant="secondary" className="absolute left-2 top-2">
              {count} {t("photos")}
            </Badge>
          ) : null}
          {!product.active ? (
            <Badge variant="secondary" className="absolute right-2 top-2">
              {t("active")}: {common("no")}
            </Badge>
          ) : null}
        </div>
        <CardContent className="p-3">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {product.name}
          </p>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{product.categoryName}</p>
          <div className="mt-2">
            <SupplierPrices offers={product.offers} sellPrice={product.sellPrice} compact />
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>{product.categoryName} · {product.sku}</DialogDescription>
          </DialogHeader>

          {count > 0 ? (
            <div className="flex flex-col gap-2">
              {/* object-contain so the whole photo is visible, never cropped */}
              <div className="relative h-72 w-full overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
                <button
                  type="button"
                  aria-label={common("enlarge")}
                  onClick={() => setZoom(true)}
                  className="absolute inset-0 cursor-zoom-in"
                >
                  <Image
                    src={product.images[index]}
                    alt={`${product.name} ${index + 1}/${count}`}
                    fill
                    sizes="(max-width: 640px) 90vw, 512px"
                    className="object-contain"
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-80">
                    <Maximize2 className="h-4 w-4" />
                  </span>
                </button>

                {count > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label={common("previous")}
                      onClick={() => go(-1)}
                      className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 dark:bg-neutral-900/90 p-1.5 text-neutral-900 dark:text-neutral-100 shadow hover:bg-white dark:hover:bg-neutral-900"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label={common("next")}
                      onClick={() => go(1)}
                      className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 dark:bg-neutral-900/90 p-1.5 text-neutral-900 dark:text-neutral-100 shadow hover:bg-white dark:hover:bg-neutral-900"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <span className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
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
                      className={`relative h-14 w-14 overflow-hidden rounded border bg-neutral-100 dark:bg-neutral-800 ${
                        i === index
                          ? "border-neutral-900 dark:border-neutral-100"
                          : "border-neutral-200 dark:border-neutral-800"
                      }`}
                    >
                      <Image src={src} alt="" fill sizes="56px" className="object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="col-span-2">
              <dt className="text-neutral-500 dark:text-neutral-400">{t("costPrice")}</dt>
              <dd className="mt-0.5">
                <SupplierPrices offers={product.offers} sellPrice={product.sellPrice} />
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("sellPrice")}</dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100" data-testid="card-sell-price">
                {product.sellPrice > 0
                  ? `${product.sellPrice.toFixed(2)} ${product.currency}`
                  : t("sellsAtCost")}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("qtyPerBox")}</dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100">{product.qtyPerBox}</dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">
                {estimated ? t("pieceSize") : t("size")}
              </dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                {unmeasured && !estimated
                  ? t("notRecorded")
                  : estimated
                    ? `${product.pieceLengthCm}×${product.pieceWidthCm}×${product.pieceHeightCm}`
                    : `${product.lengthCm}×${product.widthCm}×${product.heightCm}`}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("weight")}</dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                {product.weightKg > 0 ? `${formatWeightKg(product.weightKg)} kg` : t("notRecorded")}
                {estimated ? (
                  <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                    ({t("estimated")})
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("cbm")}</dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                {product.cbm > 0 ? `${formatCbm(product.cbm)} m³` : t("notRecorded")}
                {estimated ? (
                  <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                    ({t("estimated")})
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {unmeasured ? (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              data-testid="unmeasured-note"
            >
              {t("notMeasuredYet")}
            </p>
          ) : null}

          {estimated ? (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              data-testid="estimated-note"
            >
              {t("estimatedFromPiece")}
            </p>
          ) : null}

          {product.supplierName ? (
            <dl className="border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
              <dt className="text-neutral-500 dark:text-neutral-400">{t("supplier")}</dt>
              <dd className="font-medium text-neutral-900 dark:text-neutral-100" data-testid="card-supplier">
                {product.supplierName}
                {product.supplierBooth ? (
                  <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">
                    · {product.supplierBooth}
                  </span>
                ) : null}
              </dd>
            </dl>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("addedBy")}</dt>
              <dd
                className="font-medium text-neutral-900 dark:text-neutral-100"
                data-testid="product-added-by"
              >
                {product.createdByName ?? t("unknownUser")}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">{t("updatedBy")}</dt>
              <dd
                className="font-medium text-neutral-900 dark:text-neutral-100"
                data-testid="product-updated-by"
              >
                {product.updatedByName ?? t("unknownUser")}
              </dd>
            </div>
          </dl>

          {product.description ? (
            <div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("description")}</p>
              <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
                {product.description}
              </p>
            </div>
          ) : null}

          <DialogFooter>
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
        <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-none flex-col overflow-hidden bg-white p-3 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
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
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 dark:bg-neutral-900/90 p-2 text-neutral-900 dark:text-neutral-100 shadow hover:bg-white dark:hover:bg-neutral-900"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    aria-label={common("next")}
                    onClick={() => go(1)}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 dark:bg-neutral-900/90 p-2 text-neutral-900 dark:text-neutral-100 shadow hover:bg-white dark:hover:bg-neutral-900"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
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
