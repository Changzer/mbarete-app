"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computeOrderTotals,
  formatCbm,
  isBelowMoq,
  lineTotal,
  type CurrencyRates,
} from "@/lib/calculations";
import { createOrder, updateOrder, type OrderActionResult } from "@/lib/actions/orders";

export type BuilderProduct = {
  id: number;
  sku: string;
  name: string;
  categoryName: string;
  categoryId: number;
  price: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  weightKg: number;
  cbm: number;
};

type Client = { id: number; companyName: string };
type Category = { id: number; name: string };

export function OrderBuilder({
  products,
  categories,
  clients,
  rates,
  mode,
  orderId,
  initial,
}: {
  products: BuilderProduct[];
  categories: Category[];
  clients: Client[];
  rates: CurrencyRates;
  mode: "create" | "edit";
  orderId?: number;
  initial?: {
    clientId: number;
    displayCurrency: string;
    secondaryCurrency: string;
    commissionPct: number;
    notes: string;
    items: { productId: number; quantity: number }[];
  };
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const [isPending, startTransition] = useTransition();

  const [clientId, setClientId] = useState(
    initial?.clientId ? String(initial.clientId) : clients[0] ? String(clients[0].id) : "",
  );
  const [displayCurrency, setDisplayCurrency] = useState(
    initial?.displayCurrency ?? Object.keys(rates)[0] ?? "USD",
  );
  const [secondaryCurrency, setSecondaryCurrency] = useState(
    initial?.secondaryCurrency ?? (rates["CNY"] !== undefined ? "CNY" : Object.keys(rates)[0] ?? "USD"),
  );
  const [commissionPct, setCommissionPct] = useState(
    initial?.commissionPct !== undefined ? String(initial.commissionPct) : "0",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [cart, setCart] = useState<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    initial?.items.forEach((i) => {
      map[i.productId] = i.quantity;
    });
    return map;
  });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== "all" && String(p.categoryId) !== categoryFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [products, search, categoryFilter]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({
        product: productMap.get(Number(productId))!,
        quantity,
      }))
      .filter((l) => l.product);
  }, [cart, productMap]);

  // Both currencies are shown side by side: cost is usually quoted by the
  // supplier in RMB while the client is billed in USD.
  const targets = useMemo(
    () => [...new Set([displayCurrency, secondaryCurrency])],
    [displayCurrency, secondaryCurrency],
  );
  const commissionValue = Number(commissionPct) || 0;
  const totals = useMemo(
    () => computeOrderTotals(cartLines, targets, rates, commissionValue),
    [cartLines, targets, rates, commissionValue],
  );

  function setQuantity(productId: number, quantity: number) {
    setCart((prev) => ({ ...prev, [productId]: Math.max(0, Math.floor(quantity) || 0) }));
  }

  async function handleSubmit(status: "draft" | "confirmed") {
    setError(null);
    if (cartLines.length === 0) {
      setError("empty");
      return;
    }
    if (!clientId) {
      setError("client");
      return;
    }

    const payload = {
      clientId: Number(clientId),
      displayCurrency,
      secondaryCurrency,
      commissionPct: commissionValue,
      notes,
      status,
      items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    };

    startTransition(async () => {
      const result: OrderActionResult =
        mode === "edit" && orderId
          ? await updateOrder(orderId, payload)
          : await createOrder(payload);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            placeholder={common("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allCategories")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredProducts.map((p) => {
            const qty = cart[p.id] ?? 0;
            const below = isBelowMoq(qty, p.moq);
            return (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {p.categoryName} · {p.price.toFixed(2)} {p.currency} · {t("moq")}: {p.moq}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={qty}
                    onChange={(e) => setQuantity(p.id, Number(e.target.value))}
                    className="w-24"
                  />
                  {below ? (
                    <Badge variant="warning">{t("moqWarning", { moq: p.moq })}</Badge>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-1">
        <div className="sticky top-4 flex flex-col gap-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t("cart")}</h2>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clientId">{t("client")}</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="clientId">
                <SelectValue placeholder={t("selectClient")} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="displayCurrency">{t("quoteCurrency")}</Label>
              <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
                <SelectTrigger id="displayCurrency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(rates).map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secondaryCurrency">{t("secondaryCurrency")}</Label>
              <Select value={secondaryCurrency} onValueChange={setSecondaryCurrency}>
                <SelectTrigger id="secondaryCurrency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(rates).map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commissionPct">{t("commission")}</Label>
            <Input
              id="commissionPct"
              type="number"
              step="0.01"
              min="0"
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
            />
          </div>

          {cartLines.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("emptyCart")}</p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {cartLines.map(({ product, quantity }) => (
                <li key={product.id} className="flex flex-col gap-1 border-b border-neutral-100 dark:border-neutral-800 pb-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{product.name}</span>
                    <button
                      type="button"
                      className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                      onClick={() => setQuantity(product.id, 0)}
                    >
                      {t("removeLine")}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                    <span>
                      {quantity} × {product.price.toFixed(2)} {product.currency}
                    </span>
                    <span>{lineTotal(product, quantity).toFixed(2)} {product.currency}</span>
                  </div>
                  {isBelowMoq(quantity, product.moq) ? (
                    <Badge variant="warning" className="w-fit">
                      {t("moqWarning", { moq: product.moq })}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {totals.missingRates.length > 0 ? (
            <p className="rounded-md bg-amber-100 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t("missingRate", { codes: totals.missingRates.join(", ") })}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-3 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-neutral-500 dark:text-neutral-400">{t("goodsSubtotal")}</span>
              {targets.map((code) => (
                <div key={code} className="flex justify-between">
                  <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {totals.goods[code].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {commissionValue > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-neutral-500 dark:text-neutral-400">
                  {t("commissionAmount")} ({commissionValue}%)
                </span>
                {targets.map((code) => (
                  <div key={code} className="flex justify-between">
                    <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
                    <span className="text-neutral-700 dark:text-neutral-300">
                      {totals.commission[code].toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 pt-2">
              <span className="text-neutral-500 dark:text-neutral-400">{t("grandTotal")}</span>
              {targets.map((code) => (
                <div key={code} className="flex justify-between">
                  <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {totals.grandTotal[code].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{t("totalCartons")}</span>
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                {Number.isInteger(totals.totalCartons)
                  ? totals.totalCartons
                  : totals.totalCartons.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{t("totalCbm")}</span>
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCbm(totals.totalCbm)} m³</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{t("totalWeight")}</span>
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">{totals.totalWeightKg.toFixed(2)} kg</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">{t("notes")}</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {totals.hasMoqViolation ? (
            <p className="text-xs text-amber-700">{t("moqBlocksConfirm")}</p>
          ) : null}
          {error === "empty" ? (
            <p className="text-xs text-red-600">{t("emptyCart")}</p>
          ) : null}
          {error === "client" ? (
            <p className="text-xs text-red-600">{t("selectClient")}</p>
          ) : null}
          {error === "moq" ? (
            <p className="text-xs text-red-600">{t("moqBlocksConfirm")}</p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => handleSubmit("draft")}
              type="button"
            >
              {t("saveDraft")}
            </Button>
            <Button
              disabled={isPending || totals.hasMoqViolation}
              onClick={() => handleSubmit("confirmed")}
              type="button"
            >
              {t("confirmOrder")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
