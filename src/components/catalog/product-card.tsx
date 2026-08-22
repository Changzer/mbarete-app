"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { authenticatedUploadLoader } from "@/lib/client/upload-image-loader";
import { ChevronLeft, ChevronRight, ImageOff, Maximize2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "@/lib/actions/catalog";
import { useIsAdmin } from "@/components/role-provider";
import { formatCbm, formatWeightKg, missingCartonFigures } from "@/lib/calculations";
import { formatMoney } from "@/lib/money";
import { SupplierPrices, type CardOffer } from "@/components/catalog/supplier-prices";

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  /** The other language's name, shown beside the primary one when it differs. */
  altName: string;
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


/**
 * A product as a row, not a tile.
 *
 * The tile grid looked like a shop; this is a working list. Reading order is
 * fixed: photo, name (EN then ZH), SKU · supplier, price + pack, and status at
 * the end — so a thumb scrolling a hundred products lands on the same figure
 * in the same place every time. The whole row is the tap target and there is
 * no overflow menu: actions live in the detail sheet the row opens.
 */
export function ProductCard({
  product,
  variant = "row",
}: {
  product: CatalogProduct;
  /** `table` renders the same product as desktop table cells — see CatalogList. */
  variant?: "row" | "table";
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const isAdmin = useIsAdmin();
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

  // The quote to lead with; the query layer already ranked them.
  const best = product.offers[0];

  const warnings = (
    <>
      {unmeasured ? (
        <Badge variant="warning" data-testid="row-unmeasured">
          {t("noCartonSize")}
        </Badge>
      ) : null}
      {estimated ? <Badge variant="warning">{t("estimatedChip")}</Badge> : null}
      {!product.active ? (
        <Badge variant="secondary">
          {t("active")}: {common("no")}
        </Badge>
      ) : null}
    </>
  );

  const dialogs = (
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
              {unmeasured && !estimated
                ? t("notRecorded")
                : estimated
                  ? `${product.pieceLengthCm}×${product.pieceWidthCm}×${product.pieceHeightCm}`
                  : `${product.lengthCm}×${product.widthCm}×${product.heightCm}`}
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
            {isAdmin ? (
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

  if (variant === "table") {
    return (
      <>
        <tr
          onClick={() => openDialog(true)}
          data-testid="product-table-row"
          className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
        >
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[6px] bg-surface-2">
                {count > 0 ? (
                  <Image
                    src={product.images[0]}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                    loader={authenticatedUploadLoader}
                  />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-ink">{product.name}</span>
                {product.altName ? (
                  <span className="block truncate text-[11.5px] text-sub">{product.altName}</span>
                ) : null}
              </span>
            </div>
          </td>
          <td className="px-3 py-2.5 font-mono text-[12px] text-sub">{product.sku}</td>
          {/* The cheapest live quote, like the phone row — with the count of
              the others, since a table has no room for the whole comparison. */}
          <td className="px-3 py-2.5 font-mono text-[13px] font-semibold tabular-nums text-ink">
            {best ? formatMoney(best.price, best.currency) : "—"}
          </td>
          <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums text-sub">
            {best ? `${best.moq} · ${product.qtyPerBox}` : product.qtyPerBox}
          </td>
          <td className="max-w-48 truncate px-3 py-2.5 text-[12.5px] text-sub">
            {best?.supplierName ?? "—"}
            {product.offers.length > 1 ? (
              <span className="ml-1.5 font-mono text-[11px] text-faint">
                +{product.offers.length - 1}
              </span>
            ) : null}
          </td>
          <td className="px-3 py-2.5">
            <span className="flex flex-wrap justify-end gap-1.5">{warnings}</span>
          </td>
        </tr>
        {/* Portalled, so living inside a <tbody> costs it nothing. */}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openDialog(true)}
        data-testid="product-row"
        className="press focus-ring flex w-full items-center gap-3 rounded-[12px] border border-line bg-surface p-2.5 text-left hover:border-line-strong"
      >
        <span className="relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-[8px] bg-surface-2">
          {count > 0 ? (
            <Image
              src={product.images[0]}
              loader={authenticatedUploadLoader}
              alt=""
              fill
              sizes="74px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint">
              <ImageOff className="h-5 w-5" strokeWidth={1.5} />
            </span>
          )}
          {count > 1 ? (
            <span className="absolute bottom-1 right-1 rounded-full bg-[rgba(20,12,8,.7)] px-1.5 font-mono text-[9px] font-medium text-white">
              {count}
            </span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {/* ② Both names on one line: the buyer's and the supplier's. */}
          <span className="truncate text-[13.5px] font-bold leading-tight text-ink">
            {product.name}
            {product.altName ? (
              <span className="ml-1.5 font-medium text-sub">{product.altName}</span>
            ) : null}
          </span>

          {/* ③ The identifier, in the data register. The supplier's name used
              to sit here; it now belongs to a quote, so it rides on line ④. */}
          <span className="truncate font-mono text-[11px] font-medium text-sub">
            {product.sku} · {product.qtyPerBox}
            {t("unitPerCtn")}
          </span>

          {/* ④ Who is quoting what — best first, with the gap to the others. */}
          <SupplierPrices offers={product.offers} sellPrice={product.sellPrice} compact />

          {/* ⑤ Warnings only. A well-measured, active product says nothing. */}
          {unmeasured || estimated || !product.active ? (
            <span className="flex flex-wrap gap-1.5 pt-0.5">{warnings}</span>
          ) : null}
        </span>
      </button>
{dialogs}
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
