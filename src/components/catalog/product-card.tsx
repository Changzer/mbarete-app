"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { authenticatedUploadLoader } from "@/lib/client/upload-image-loader";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { missingCartonFigures } from "@/lib/calculations";
import { formatMoney } from "@/lib/money";
import { SupplierPrices, type CardOffer } from "@/components/catalog/supplier-prices";
import { ProductDetailDialog } from "@/components/catalog/product-detail-dialog";

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  /** The other language's name, shown beside the primary one when it differs. */
  altName: string;
  description: string;
  /** The price board as the AI read it at capture, and what it flagged. */
  boardText: string;
  aiNotes: string;
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
  /** `table` renders the same product as desktop table cells; `gallery` as a
   *  photo-first tile — see CatalogList. All three open the same dialog. */
  variant?: "row" | "table" | "gallery";
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);

  const estimated = product.dimensionSource === "piece";
  // Registered without measurements — shown as unknown, never as zero.
  const unmeasured = missingCartonFigures(product);
  const count = product.images.length;
  const openDialog = useCallback((next: boolean) => setOpen(next), []);

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
    <ProductDetailDialog product={product} open={open} onOpenChange={openDialog} />
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

  if (variant === "gallery") {
    return (
      <>
        {/* The tile: photo first, the working figures beneath. For browsing —
            comparing looks across a wall of products — where the row list is
            for finding. Same registers, same dialog. */}
        <button
          type="button"
          onClick={() => openDialog(true)}
          data-testid="product-tile"
          className="press focus-ring flex w-full flex-col overflow-hidden rounded-[12px] border border-line bg-surface text-left hover:border-line-strong"
        >
          <span className="relative aspect-square w-full overflow-hidden bg-surface-2">
            {count > 0 ? (
              <Image
                src={product.images[0]}
                loader={authenticatedUploadLoader}
                alt=""
                fill
                sizes="(min-width: 1536px) 22vw, 30vw"
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-faint">
                <ImageOff className="h-8 w-8" strokeWidth={1.5} />
              </span>
            )}
            {count > 1 ? (
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[rgba(20,12,8,.7)] px-1.5 font-mono text-[10px] font-medium text-white">
                {count}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-1 p-2.5">
            <span className="line-clamp-2 text-[13px] font-bold leading-tight text-ink">
              {product.name}
              {product.altName ? (
                <span className="ml-1.5 font-medium text-sub">{product.altName}</span>
              ) : null}
            </span>
            <span className="truncate font-mono text-[11px] font-medium text-sub">
              {product.sku} · {product.qtyPerBox}
              {t("unitPerCtn")}
            </span>
            <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">
              {best ? formatMoney(best.price, best.currency) : "—"}
              {best ? (
                <span className="ml-1.5 font-sans text-[11px] font-medium text-sub">
                  {t("moq")} {best.moq}
                </span>
              ) : null}
            </span>
            {best?.supplierName ? (
              <span className="truncate text-[11.5px] text-sub">{best.supplierName}</span>
            ) : null}
            {unmeasured || estimated || !product.active ? (
              <span className="flex flex-wrap gap-1.5 pt-0.5">{warnings}</span>
            ) : null}
          </span>
        </button>
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
