"use client";

import { useMemo, useState } from "react";
import { Search, X, Check, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";
import { sellUnitPrice, suggestedQuantity } from "@/lib/calculations";
import type { BuilderProduct } from "@/components/orders/order-builder";

/**
 * Full-screen product picker: search first, tick several, add them all at
 * once. A product already in the order shows as owned — tapping it jumps to
 * editing its line instead of double-adding.
 */
export function ProductPicker({
  products,
  categories,
  inOrder,
  onClose,
  onAdd,
  onEditLine,
}: {
  products: BuilderProduct[];
  categories: { id: number; name: string }[];
  /** productId → current qty for lines already in the order. */
  inOrder: Map<number, number>;
  onClose: () => void;
  onAdd: (productIds: number[]) => void;
  onEditLine: (productId: number) => void;
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [sel, setSel] = useState<Set<number>>(() => new Set());

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== "all" && String(p.categoryId) !== cat) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, query, cat]);

  const toggle = (id: number) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // One estimate only when every picked product quotes the same currency —
  // adding RMB and USD together would be a lie.
  const picked = [...sel].map((id) => products.find((p) => p.id === id)!).filter(Boolean);
  const oneCurrency = new Set(picked.map((p) => p.currency)).size === 1 && picked.length > 0;
  const estimate = oneCurrency
    ? picked.reduce((sum, p) => sum + suggestedQuantity(p, p.moq) * sellUnitPrice(p), 0)
    : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <div className="h-[5px] bg-action" />
      <div className="border-b border-line bg-bg">
        <div className="mx-auto w-full max-w-[780px] px-4 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <button aria-label={t("backToOrder")} onClick={onClose} className="-ml-1 p-1 text-ink">
              <ChevronLeft size={26} />
            </button>
            <div className="text-[18px] font-extrabold text-ink">{t("addProductsTitle")}</div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <Search size={18} className="text-sub" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pickerSearchPlaceholder")}
              className="flex-1 bg-transparent font-mono text-[13.5px] text-ink outline-none placeholder:text-sub"
              data-testid="picker-search"
            />
            {query ? (
              <button aria-label={common("clear")} onClick={() => setQuery("")} className="text-sub">
                <X size={16} />
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {[{ id: "all", name: t("allCategories") }, ...categories.map((c) => ({ id: String(c.id), name: c.name }))].map(
              (c) => {
                const on = cat === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCat(c.id)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold ${
                      on ? "border-action bg-action text-white" : "border-line bg-surface text-ink"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              },
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[780px] px-4 pt-3" style={{ paddingBottom: 110 }}>
          {results.map((p) => {
            const ownedQty = inOrder.get(p.id);
            const owned = ownedQty !== undefined;
            const on = sel.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => (owned ? onEditLine(p.id) : toggle(p.id))}
                data-testid={`picker-${p.sku}`}
                className={`mb-2 flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors active:scale-[0.99] ${
                  on ? "border-2 border-action bg-action-soft" : "border-line bg-surface"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    owned || on ? "border-action bg-action text-white" : "border-line"
                  }`}
                >
                  {owned || on ? <Check size={14} strokeWidth={3.5} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-bold leading-tight text-ink">{p.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11.5px] text-sub">
                    {p.categoryName} · {formatMoney(sellUnitPrice(p), p.currency)} · {t("moq")} {p.moq} ·{" "}
                    {p.qtyPerBox > 1 ? `${p.qtyPerBox}/${t("ctnShort")}` : t("noCartonShort")}
                  </span>
                  {owned ? (
                    <span className="mt-0.5 block font-mono text-[11.5px] text-action-chrome">
                      {t("pickerInOrder", { qty: ownedQty })}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {results.length === 0 ? (
            <div className="mt-16 px-8 text-center font-mono text-[12.5px] text-sub">
              {t("pickerNoMatch", { query })}
            </div>
          ) : null}
        </div>
      </div>

      {sel.size > 0 ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-line bg-bg">
          <div className="mx-auto w-full max-w-[780px] p-4">
            <button
              onClick={() => onAdd([...sel])}
              className="w-full rounded-2xl bg-action py-3.5 text-[15.5px] font-extrabold text-white active:scale-95"
              data-testid="picker-add"
            >
              {t("pickerAddN", { count: sel.size })}
              {estimate !== null ? ` · ${t("pickerEst")} ${formatMoney(estimate, picked[0].currency)}` : ""}
            </button>
            <div className="mt-2 text-center font-mono text-[11px] text-sub">{t("pickerAddedAtMin")}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
