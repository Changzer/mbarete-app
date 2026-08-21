"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { formatMoney } from "@/lib/money";
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
  fullCartons,
  isBelowMoq,
  isPartialCarton,
  suggestedQuantity,
  lineTotal,
  type CurrencyRates,
  missingCartonFigures,
  sellUnitPrice,
  lineSellTotal,
} from "@/lib/calculations";
import { createOrder, updateOrder, type OrderActionResult } from "@/lib/actions/orders";
import { createContact, updateContact } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/contacts/contact-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  dimensionSource: "carton" | "piece";
  /** default selling price; 0 = none set, sells at the supplier price */
  sellPrice: number;
};

type Client = {
  id: number;
  companyName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  wechat?: string;
  notes?: string;
};
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
    status?: "draft" | "confirmed";
    clientId: number;
    displayCurrency: string;
    secondaryCurrency: string;
    commissionPct: number;
    notes: string;
    items: { productId: number; quantity: number; sellPrice: number }[];
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
  // Each line owns its quantity and the price the client will be invoiced.
  // The sell price is text while being edited so a half-typed "1." survives.
  const [cart, setCart] = useState<Record<number, { qty: number; sellPrice: string }>>(() => {
    const map: Record<number, { qty: number; sellPrice: string }> = {};
    initial?.items.forEach((i) => {
      map[i.productId] = { qty: i.quantity, sellPrice: String(i.sellPrice) };
    });
    return map;
  });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // A client created here is held locally as well as revalidated, so the new
  // option is selectable immediately without waiting for the server round trip.
  const [newClients, setNewClients] = useState<Client[]>([]);
  const [clientDialog, setClientDialog] = useState<"closed" | "new" | "edit">("closed");

  const allClients = useMemo(() => {
    const extras = newClients.filter((n) => !clients.some((c) => c.id === n.id));
    return [...clients, ...extras];
  }, [clients, newClients]);

  const selectedClient = allClients.find((c) => String(c.id) === clientId);

  function handleClientSaved(id?: number, values?: Partial<Client>) {
    if (id) {
      setNewClients((prev) => [
        ...prev.filter((c) => c.id !== id),
        { id, companyName: values?.companyName ?? "", ...values } as Client,
      ]);
      setClientId(String(id));
    }
    setClientDialog("closed");
    router.refresh();
  }

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
      .filter(([, entry]) => entry.qty > 0)
      .map(([productId, entry]) => {
        const product = productMap.get(Number(productId))!;
        if (!product) return null;
        // The chosen sell price rides inside the product the maths reads, so
        // computeOrderTotals needs no special order-builder path.
        const chosen = Number(entry.sellPrice);
        const sellPrice = Number.isFinite(chosen) && chosen > 0 ? chosen : sellUnitPrice(product);
        return { product: { ...product, sellPrice }, quantity: entry.qty };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
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

  // Volume and weight below are only as good as their source. Say so when any
  // line's carton was estimated from a piece rather than measured.
  const hasEstimatedCarton = useMemo(
    () => cartLines.some((l) => l.product.dimensionSource === "piece"),
    [cartLines],
  );

  // A product registered without measurements contributes nothing to volume or
  // weight, which would otherwise quietly under-report the whole shipment.
  const hasUnmeasured = useMemo(
    () => cartLines.some((l) => missingCartonFigures(l.product)),
    [cartLines],
  );

  function setQuantity(productId: number, quantity: number) {
    const qty = Math.max(0, Math.floor(quantity) || 0);
    setCart((prev) => {
      const existing = prev[productId];
      const product = productMap.get(productId);
      return {
        ...prev,
        [productId]: {
          qty,
          // First touch pre-fills the product's own selling price (or cost).
          sellPrice:
            existing?.sellPrice ?? String(product ? sellUnitPrice(product) : ""),
        },
      };
    });
  }

  function setSellPrice(productId: number, value: string) {
    setCart((prev) => ({
      ...prev,
      [productId]: { qty: prev[productId]?.qty ?? 0, sellPrice: value },
    }));
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
      items: cartLines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        sellPrice: l.product.sellPrice,
      })),
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {filteredProducts.map((p) => {
            const qty = cart[p.id]?.qty ?? 0;
            const below = isBelowMoq(qty, p.moq);
            const partial = isPartialCarton(p, qty);
            const suggestion = suggestedQuantity(p, qty);
            return (
              <div
                key={p.id}
                data-testid={`picker-${p.sku}`}
                className={`flex flex-col gap-2 rounded-[12px] border bg-surface p-3 ${
                  qty > 0 ? "border-action" : "border-line"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-ink">{p.name}</p>
                  <p className="truncate font-mono text-[11px] text-sub">
                    {p.categoryName} · {formatMoney(p.price, p.currency)} · {t("moq")} {p.moq}
                  </p>
                </div>
                {/* Stepping by the carton, because that is the unit that ships:
                    a supplier does not sell 37 of anything. Typing still works
                    for a buyer who already knows the number. */}
                <Stepper
                  value={qty}
                  onChange={(next) => setQuantity(p.id, next)}
                  step={p.qtyPerBox > 0 ? p.qtyPerBox : 1}
                  label={p.name}
                  suffix={`/${p.qtyPerBox}`}
                  data-testid={`qty-${p.sku}`}
                />
                {qty > 0 || below ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {qty > 0 ? (
                      <Badge variant={partial ? "warning" : "secondary"}>
                        {partial
                          ? t("partialCarton", {
                              cartons: fullCartons(p, qty),
                              perCarton: p.qtyPerBox,
                            })
                          : t("cartons", { count: fullCartons(p, qty) })}
                      </Badge>
                    ) : null}
                    {below ? (
                      <Badge variant="warning" data-testid={`below-moq-${p.sku}`}>
                        {t("moqWarning", { moq: p.moq })}
                      </Badge>
                    ) : null}
                    {qty > 0 && suggestion !== qty ? (
                      <button
                        type="button"
                        onClick={() => setQuantity(p.id, suggestion)}
                        className="focus-ring min-h-11 px-1 text-[11px] font-semibold text-action-chrome underline"
                      >
                        {t("roundTo", { qty: suggestion })}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-1">
        <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-4 lg:sticky lg:top-20">
          <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">{t("cart")}</h2>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="clientId">{t("client")}</Label>
              <div className="flex items-center gap-2">
                {selectedClient ? (
                  <button
                    type="button"
                    onClick={() => setClientDialog("edit")}
                    className="focus-ring min-h-11 px-1 text-[11px] font-semibold text-action-chrome underline"
                  >
                    {common("edit")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setClientDialog("new")}
                  className="focus-ring min-h-11 px-1 text-[11px] font-semibold text-action-chrome underline"
                >
                  {t("newClient")}
                </button>
              </div>
            </div>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="clientId">
                <SelectValue placeholder={t("selectClient")} />
              </SelectTrigger>
              <SelectContent>
                {allClients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {allClients.length === 0 ? (
              <p className="text-[11px] text-warn">
                {t("noClientsYet")}
              </p>
            ) : null}
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
              inputMode="decimal"
              step="0.01"
              min="0"
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
            />
          </div>

          {cartLines.length === 0 ? (
            <p className="text-[12.5px] text-sub">{t("emptyCart")}</p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {cartLines.map(({ product, quantity }) => (
                <li key={product.id} className="flex flex-col gap-1 border-b border-line pb-2 text-[13px] last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="min-w-0 truncate font-bold text-ink">{product.name}</span>
                    <button
                      type="button"
                      className="focus-ring min-h-11 shrink-0 px-2 text-[11px] font-semibold text-faint hover:text-danger"
                      onClick={() => setQuantity(product.id, 0)}
                    >
                      {t("removeLine")}
                    </button>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-sub">
                    <span>
                      {t("lineCost")}: {quantity} × {product.price.toFixed(2)} {product.currency}
                    </span>
                    <span>{lineTotal(product, quantity).toFixed(2)} {product.currency}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-sub">
                      {t("sellPriceLabel")}
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={cart[product.id]?.sellPrice ?? ""}
                        onChange={(e) => setSellPrice(product.id, e.target.value)}
                        className="h-9 w-24"
                        data-testid={`sell-price-${product.sku}`}
                      />
                      {product.currency}
                    </label>
                    <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
                      {lineSellTotal(product, quantity).toFixed(2)} {product.currency}
                    </span>
                  </div>
                  {product.price > 0 ? (
                    <span
                      className={`w-fit font-mono text-[11px] ${
                        product.sellPrice && product.sellPrice < product.price
                          ? "font-semibold text-danger"
                          : "text-sub"
                      }`}
                      data-testid={`line-markup-${product.sku}`}
                    >
                      {t("lineMarkup", {
                        pct: (((sellUnitPrice(product) - product.price) / product.price) * 100).toFixed(1),
                      })}
                    </span>
                  ) : null}
                  <div className="flex items-center justify-between font-mono text-[11px] text-faint">
                    <span>{t("cartons", { count: fullCartons(product, quantity) })}</span>
                    <span>{quantity} / {product.qtyPerBox} {t("perCarton")}</span>
                  </div>
                  {isBelowMoq(quantity, product.moq) ? (
                    <Badge variant="warning" className="w-fit">
                      {t("moqWarning", { moq: product.moq })}
                    </Badge>
                  ) : null}
                  {isPartialCarton(product, quantity) ? (
                    <Badge variant="warning" className="w-fit">
                      {t("partialCarton", {
                        cartons: fullCartons(product, quantity),
                        perCarton: product.qtyPerBox,
                      })}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {totals.missingRates.length > 0 ? (
            <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn">
              {t("missingRate", { codes: totals.missingRates.join(", ") })}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-line pt-3 text-[13px]">
            <div className="flex flex-col gap-1">
              <span className="text-sub">{t("goodsSubtotal")}</span>
              {targets.map((code) => (
                <div key={code} className="flex justify-between">
                  <span className="font-mono text-[11px] text-faint">{code}</span>
                  <span className="font-mono tabular-nums text-ink">
                    {totals.goods[code].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {commissionValue > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sub">
                  {t("commissionAmount")} ({commissionValue}%)
                </span>
                {targets.map((code) => (
                  <div key={code} className="flex justify-between">
                    <span className="font-mono text-[11px] text-faint">{code}</span>
                    <span className="font-mono tabular-nums text-ink">
                      {totals.commission[code].toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-1 border-t border-line pt-2">
              <span className="text-sub">{t("grandTotal")}</span>
              {targets.map((code) => (
                <div key={code} className="flex justify-between">
                  <span className="font-mono text-[11px] text-faint">{code}</span>
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {totals.grandTotal[code].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-t border-line pt-2">
              <div className="flex justify-between text-xs">
                <span className="text-sub">{t("supplierCost")}</span>
                <span className="font-mono tabular-nums text-ink" data-testid="builder-cost">
                  {(totals.cost[displayCurrency] ?? 0).toFixed(2)} {displayCurrency}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-sub">{t("grossMargin")}</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    (totals.grandTotal[displayCurrency] ?? 0) - (totals.cost[displayCurrency] ?? 0) < 0
                      ? "text-danger"
                      : "text-ink"
                  }`}
                  data-testid="builder-margin"
                >
                  {((totals.grandTotal[displayCurrency] ?? 0) - (totals.cost[displayCurrency] ?? 0)).toFixed(2)} {displayCurrency}
                </span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-sub">{t("totalCartons")}</span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {Number.isInteger(totals.totalCartons)
                  ? totals.totalCartons
                  : totals.totalCartons.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sub">{t("totalCbm")}</span>
              <span className="font-mono font-semibold tabular-nums text-ink">{formatCbm(totals.totalCbm)} m³</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sub">{t("totalWeight")}</span>
              <span className="font-mono font-semibold tabular-nums text-ink">{totals.totalWeightKg.toFixed(2)} kg</span>
            </div>
            {hasUnmeasured ? (
              <p
                className="rounded-[10px] bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn"
                data-testid="order-unmeasured-note"
              >
                {t("unmeasuredIncluded")}
              </p>
            ) : null}
            {hasEstimatedCarton ? (
              <p
                className="rounded-[10px] bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn"
                data-testid="order-estimate-note"
              >
                {t("estimatedCartonsIncluded")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">{t("notes")}</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {totals.hasMoqViolation ? (
            <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn" data-testid="moq-blocks-confirm">{t("moqBlocksConfirm")}</p>
          ) : null}
          {error === "empty" ? (
            <p className="text-[12px] font-semibold text-danger">{t("emptyCart")}</p>
          ) : null}
          {error === "client" ? (
            <p className="text-[12px] font-semibold text-danger">{t("selectClient")}</p>
          ) : null}
          {error === "moq" ? (
            <p className="text-[12px] font-semibold text-danger">{t("moqBlocksConfirm")}</p>
          ) : null}

          <div className="flex flex-col gap-2">
            {mode === "edit" && initial?.status === "confirmed" ? (
              /* A confirmed order stays confirmed through an edit — offering
                 "save as draft" here would silently demote it. */
              <Button
                disabled={isPending || totals.hasMoqViolation}
                onClick={() => handleSubmit("confirmed")}
                type="button"
                data-testid="save-changes"
              >
                {t("saveChanges")}
              </Button>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add or correct a client without losing the order being built. */}
      <Dialog
        open={clientDialog !== "closed"}
        onOpenChange={(next) => setClientDialog(next ? "new" : "closed")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clientDialog === "edit" ? t("editClient") : t("newClient")}
            </DialogTitle>
          </DialogHeader>
          {clientDialog !== "closed" ? (
            <ContactForm
              type="client"
              action={
                clientDialog === "edit" && selectedClient
                  ? updateContact.bind(null, selectedClient.id)
                  : createContact
              }
              defaultValues={
                clientDialog === "edit" ? selectedClient : undefined
              }
              submitLabel={common("save")}
              onSuccess={(id) => handleClientSaved(id)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
