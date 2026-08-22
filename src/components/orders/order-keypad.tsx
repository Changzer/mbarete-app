"use client";

import { useState } from "react";
import { X, Delete } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";
import { sellUnitPrice } from "@/lib/calculations";
import type { BuilderProduct } from "@/components/orders/order-builder";

/**
 * The market-counter keypad: big digits, one thing edited at a time.
 *
 * Quantity is entered in cartons (the unit that actually ships) or pieces;
 * price entry is POS-style — digits only, the last two are cents, so "950"
 * is 9.50 and there is no decimal key to hunt for with a thumb.
 */
export function OrderKeypad({
  product,
  qty,
  sellPrice,
  initialTab,
  onSetQty,
  onSetSellPrice,
  onClose,
}: {
  product: BuilderProduct;
  qty: number;
  sellPrice: number;
  initialTab: "qty" | "price";
  onSetQty: (productId: number, qty: number) => void;
  onSetSellPrice: (productId: number, price: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("orders");
  const hasCarton = product.qtyPerBox > 1;
  const [tab, setTab] = useState<"qty" | "price">(initialTab);
  const [unit, setUnit] = useState<"ctn" | "pcs">(hasCarton ? "ctn" : "pcs");
  const [typed, setTyped] = useState("");

  const mult = unit === "ctn" ? product.qtyPerBox : 1;
  const untouched = typed === "";
  const effQty = untouched ? qty : parseInt(typed || "0", 10) * mult;
  const effPrice = untouched ? sellPrice : parseInt(typed || "0", 10) / 100;
  const listPrice = sellUnitPrice(product);

  const cartonText = (pcs: number) =>
    hasCarton ? `${Math.round((pcs / product.qtyPerBox) * 10) / 10}` : "";

  const press = (d: string) =>
    setTyped((prev) => (prev + d).replace(/^0+(?=\d)/, "").slice(0, tab === "price" ? 7 : 5));

  const confirm = () => {
    if (tab === "qty") onSetQty(product.id, effQty);
    else onSetSellPrice(product.id, Math.round(effPrice * 100) / 100);
    onClose();
  };

  const chip =
    "flex-1 rounded-xl border-[1.5px] border-action bg-action-soft px-3 py-2 text-[13.5px] font-bold text-action-chrome active:scale-95";
  const key =
    "rounded-xl border border-line bg-surface-2 py-3 text-[19px] font-bold text-ink active:scale-95";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button aria-label={t("close")} className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <div className="relative mx-auto w-full max-w-[540px] rounded-t-3xl border-t-4 border-t-action bg-surface px-5 pb-6 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[15.5px] font-bold leading-tight text-ink">{product.name}</div>
          <button aria-label={t("close")} onClick={onClose} className="-m-1 p-1 text-sub">
            <X size={20} />
          </button>
        </div>

        {/* what am I editing? */}
        <div className="mt-3 flex rounded-xl border border-line bg-surface-2 p-1">
          {(
            [
              ["qty", t("keypadQuantity")],
              ["price", t("keypadUnitPrice")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setTyped("");
              }}
              className={`flex-1 rounded-lg py-1.5 text-[13.5px] font-bold ${
                tab === id ? "bg-action text-white" : "text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "qty" ? (
          <div className="mt-2 flex rounded-xl border border-line bg-surface-2 p-1">
            {(["ctn", "pcs"] as const).map((m) => {
              const disabled = m === "ctn" && !hasCarton;
              const on = unit === m;
              return (
                <button
                  key={m}
                  disabled={disabled}
                  onClick={() => {
                    setUnit(m);
                    setTyped("");
                  }}
                  className={`flex-1 rounded-lg py-1.5 font-mono text-[12.5px] font-semibold ${
                    disabled ? "text-line" : on ? "bg-ink text-surface" : "text-sub"
                  }`}
                >
                  {m === "ctn" ? t("unitCartons") : t("unitPieces")}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* the number being built */}
        <div className="mt-4 text-center">
          <div
            className={`text-[44px] font-extrabold leading-none ${untouched ? "text-sub" : "text-ink"}`}
            data-testid="keypad-display"
          >
            {tab === "qty"
              ? untouched
                ? unit === "ctn"
                  ? cartonText(qty)
                  : String(qty)
                : typed
              : formatMoney(effPrice, product.currency)}
            <span className="ml-1.5 text-[16px] font-semibold text-sub">
              {tab === "qty" ? (unit === "ctn" ? t("ctnShort") : t("pcsShort")) : t("perPiece")}
            </span>
          </div>
          <div className="mt-2 font-mono text-[12.5px] text-sub">
            {tab === "qty"
              ? `= ${effQty} ${t("pcsShort")}${hasCarton ? ` · ${cartonText(effQty)} ${t("ctnShort")}` : ""} · ${formatMoney(effQty * sellPrice, product.currency)}`
              : `${t("keypadSubtotal")} ${formatMoney(effPrice * qty, product.currency)} · ${t("keypadList")} ${formatMoney(listPrice, product.currency)}`}
          </div>
        </div>

        {/* quick actions */}
        {tab === "qty" && hasCarton ? (
          <div className="mt-4 flex gap-2">
            {[1, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => {
                  onSetQty(product.id, Math.max(0, qty + n * product.qtyPerBox));
                  setTyped("");
                }}
                className={chip}
              >
                +{n} {t("ctnShort")}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "price" ? (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                onSetSellPrice(product.id, listPrice);
                setTyped("");
              }}
              className={chip}
            >
              {t("keypadList")} {formatMoney(listPrice, product.currency)}
            </button>
            {[5, 10].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  onSetSellPrice(product.id, Math.round(listPrice * (1 - pct / 100) * 100) / 100);
                  setTyped("");
                }}
                className={`${chip} flex-none px-4`}
              >
                −{pct}%
              </button>
            ))}
          </div>
        ) : null}

        {/* keypad */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((k) => (
            <button key={k} onClick={() => press(k)} className={key}>
              {k}
            </button>
          ))}
          <button
            aria-label={t("backspace")}
            onClick={() => setTyped((prev) => prev.slice(0, -1))}
            className={`${key} flex items-center justify-center`}
          >
            <Delete size={22} />
          </button>
        </div>

        <button
          onClick={confirm}
          className="mt-3 w-full rounded-2xl bg-action py-3.5 text-[15.5px] font-extrabold text-white active:scale-95"
          data-testid="keypad-confirm"
        >
          {tab === "qty"
            ? t("keypadSetQty", { qty: effQty })
            : t("keypadSetPrice", { price: formatMoney(effPrice, product.currency) })}
        </button>
      </div>
    </div>
  );
}
