"use client";

import { X, Plus, Minus, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";
import {
  fullCartons,
  isBelowMoq,
  isPartialCarton,
  sellUnitPrice,
  suggestedQuantity,
} from "@/lib/calculations";
import type { BuilderProduct } from "@/components/orders/order-builder";

/**
 * One order line as a card. The grammar the whole screen follows:
 * an editable value is a labeled, boxed field with a pencil; a computed
 * value is plain text with a name; red is reserved for problems.
 *
 * Stacked on phones; from 640px up the card lays out as a table row
 * (name | quantity | price | subtotal) where leftover width goes to the
 * name, never to the controls.
 */
export function LineCard({
  product,
  qty,
  sellPrice,
  onStep,
  onOpenKeypad,
  onFix,
  onRemove,
}: {
  product: BuilderProduct;
  qty: number;
  /** the price the client is billed, already resolved to a number */
  sellPrice: number;
  onStep: (productId: number, dir: 1 | -1) => void;
  onOpenKeypad: (productId: number, tab: "qty" | "price") => void;
  onFix: (productId: number, qty: number) => void;
  onRemove: (productId: number) => void;
}) {
  const t = useTranslations("orders");
  const hasCarton = product.qtyPerBox > 1;
  const listPrice = sellUnitPrice(product);
  const edited = Math.abs(sellPrice - listPrice) > 0.004;
  const below = isBelowMoq(qty, product.moq);
  const partial = isPartialCarton(product, qty);
  const fix = suggestedQuantity(product, qty);
  const subtotal = qty * sellPrice;

  const field = "rounded-xl border border-line bg-surface-2";
  const cartonCount = (pcs: number) => Math.round((pcs / product.qtyPerBox) * 10) / 10;

  return (
    <div
      data-testid={`line-${product.sku}`}
      className={`relative mb-3 rounded-2xl bg-surface p-4 ${
        below || partial ? "border-2 border-action" : "border border-line"
      }`}
    >
      <button
        aria-label={t("removeLineNamed", { name: product.name })}
        onClick={() => onRemove(product.id)}
        className="absolute right-3 top-3 p-1 text-sub"
        data-testid={`remove-${product.sku}`}
      >
        <X size={18} />
      </button>

      <div className="grid grid-cols-[1fr_112px] gap-3 sm:grid-cols-[minmax(170px,1fr)_252px_120px_104px] sm:items-end sm:gap-x-5">
        {/* name — the only column that absorbs extra width */}
        <div className="col-span-full pr-7 sm:col-auto sm:self-center">
          <div className="text-[16px] font-bold leading-tight text-ink">{product.name}</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-sub">
            {product.categoryName} · {t("moq")} {product.moq} ·{" "}
            {hasCarton ? `${product.qtyPerBox}/${t("ctnShort")}` : (
              <span className="text-warn">{t("noCartonShort")}</span>
            )}
          </div>
        </div>

        {/* quantity field */}
        <div>
          <div className="font-mono text-[11px] font-medium tracking-[0.12em] text-sub">
            {t("keypadQuantity").toUpperCase()}
          </div>
          <div className="mt-1 flex items-stretch gap-1.5">
            <button
              aria-label={t("oneCartonLess")}
              onClick={() => onStep(product.id, -1)}
              className={`${field} flex w-11 shrink-0 items-center justify-center text-ink active:scale-95`}
              data-testid={`step-down-${product.sku}`}
            >
              <Minus size={18} />
            </button>
            <button
              onClick={() => onOpenKeypad(product.id, "qty")}
              className={`${field} min-w-0 flex-1 py-1.5 active:scale-95`}
              data-testid={`qty-${product.sku}`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <span className="text-[19px] font-extrabold leading-none text-ink">{qty}</span>
                <span className="font-mono text-[11px] text-sub">{t("pcsShort")}</span>
                <Pencil size={12} className="text-sub" />
              </span>
              <span className="mt-0.5 block font-mono text-[10.5px] text-sub">
                {hasCarton ? `${cartonCount(qty)} ${t("ctnShort")}` : t("noCartonData")}
              </span>
            </button>
            <button
              aria-label={t("oneCartonMore")}
              onClick={() => onStep(product.id, 1)}
              className={`${field} flex w-11 shrink-0 items-center justify-center text-ink active:scale-95`}
              data-testid={`step-up-${product.sku}`}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* price field */}
        <div>
          <div className="font-mono text-[11px] font-medium tracking-[0.12em] text-sub">
            {t("keypadUnitPrice").toUpperCase()}
          </div>
          <button
            onClick={() => onOpenKeypad(product.id, "price")}
            className={`${field} mt-1 w-full py-1.5 active:scale-95`}
            data-testid={`price-${product.sku}`}
          >
            <span className="flex items-center justify-center gap-1">
              <span className="font-mono text-[13.5px] font-semibold text-ink">
                {formatMoney(sellPrice, product.currency)}
              </span>
              <Pencil size={12} className="text-sub" />
            </span>
            <span className="mt-0.5 block font-mono text-[10.5px] text-sub">
              {edited ? <s>{formatMoney(listPrice, product.currency)}</s> : t("perPiece")}
            </span>
          </button>
        </div>

        {/* computed */}
        <div className="col-span-full flex items-baseline justify-between border-t border-line pt-2.5 sm:col-auto sm:flex-col sm:items-end sm:gap-1.5 sm:border-t-0 sm:pt-0">
          <span className="font-mono text-[11px] tracking-[0.12em] text-sub">
            {t("keypadSubtotal").toUpperCase()}
          </span>
          <span className="font-mono text-[14.5px] font-semibold tabular-nums text-ink">
            {formatMoney(subtotal, product.currency)}
          </span>
        </div>
      </div>

      {below || partial ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-warn-soft px-2.5 py-1.5 font-mono text-[11.5px] text-warn">
            {below
              ? t("chipBelowMoq", { moq: product.moq })
              : t("chipPartCarton", { ships: fullCartons(product, qty) })}
          </span>
          {fix !== qty ? (
            <button
              onClick={() => onFix(product.id, fix)}
              className="rounded-lg border-[1.5px] border-action bg-action-soft px-2.5 py-1.5 text-[12px] font-bold text-action-chrome active:scale-95"
              data-testid={`fix-${product.sku}`}
            >
              {below ? t("chipSetQty", { qty: fix }) : t("chipRoundUp", { qty: fix })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
