"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  isPartialCarton,
  suggestedQuantity,
  type CurrencyRates,
  missingCartonFigures,
  sellUnitPrice,
} from "@/lib/calculations";
import { createOrder, updateOrder, type OrderActionResult } from "@/lib/actions/orders";
import { LineCard } from "@/components/orders/line-card";
import { OrderKeypad } from "@/components/orders/order-keypad";
import { ProductPicker } from "@/components/orders/product-picker";
import { AlertTriangle, Plus } from "lucide-react";
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
  /** cropped product shot, else the first catalog photo; null = no photo */
  thumbPath: string | null;
  supplierId: number | null;
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
type Supplier = { id: number; name: string };

export function OrderBuilder({
  products,
  categories,
  suppliers = [],
  clients,
  rates,
  mode,
  orderId,
  initial,
}: {
  products: BuilderProduct[];
  categories: Category[];
  /** suppliers that actually have products in the list, for the picker filter */
  suppliers?: Supplier[];
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
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keypad, setKeypad] = useState<{ id: number; tab: "qty" | "price" } | null>(null);
  // A removed line lingers here for a few seconds so a mis-tap costs nothing.
  const [undo, setUndo] = useState<{ id: number; entry: { qty: number; sellPrice: string } } | null>(
    null,
  );
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function removeLine(productId: number) {
    setCart((prev) => {
      const entry = prev[productId];
      if (!entry) return prev;
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ id: productId, entry });
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  function restoreLine() {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setCart((prev) => ({ ...prev, [undo.id]: undo.entry }));
    setUndo(null);
  }

  /** ± one carton (or one piece without carton data), snapping a partial
   *  carton to its boundary first; stepping to zero removes the line. */
  function stepLine(productId: number, dir: 1 | -1) {
    const entry = cart[productId];
    const product = productMap.get(productId);
    if (!entry || !product) return;
    const per = product.qtyPerBox > 1 ? product.qtyPerBox : 1;
    const clean = entry.qty % per === 0;
    const next =
      dir > 0
        ? clean
          ? entry.qty + per
          : Math.ceil(entry.qty / per) * per
        : clean
          ? entry.qty - per
          : Math.floor(entry.qty / per) * per;
    if (next <= 0) removeLine(productId);
    else setQuantity(productId, next);
  }

  function addProducts(ids: number[]) {
    for (const id of ids) {
      const product = productMap.get(id);
      if (!product || cart[id]?.qty) continue;
      // Added at the smallest quantity that clears both MOQ and full cartons.
      setQuantity(id, suggestedQuantity(product, product.moq));
    }
    setPickerOpen(false);
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
        {(() => {
          const nBelow = cartLines.filter((l) => isBelowMoq(l.quantity, l.product.moq)).length;
          const nPart = cartLines.filter((l) => isPartialCarton(l.product, l.quantity)).length;
          const nIssues = nBelow + nPart;
          if (nIssues === 0) return null;
          return (
            <div
              className="mb-3 flex items-center gap-2.5 rounded-2xl border-[1.5px] border-action bg-action-soft px-4 py-3"
              data-testid="issues-banner"
            >
              <AlertTriangle size={18} className="shrink-0 text-action-chrome" />
              <div className="text-[13.5px] font-bold text-action-chrome">
                {t("linesNeedAttention", { count: nIssues })}
                <span className="ml-1.5 font-mono text-[11.5px] font-normal">
                  {nBelow ? t("nBelowMoq", { count: nBelow }) : ""}
                  {nBelow && nPart ? " · " : ""}
                  {nPart ? t("nPartCarton", { count: nPart }) : ""}
                </span>
              </div>
            </div>
          );
        })()}

        {cartLines.map(({ product, quantity }) => (
          <LineCard
            key={product.id}
            product={productMap.get(product.id)!}
            qty={quantity}
            sellPrice={product.sellPrice}
            onStep={stepLine}
            onOpenKeypad={(id, tab) => setKeypad({ id, tab })}
            onFix={(id, qty) => setQuantity(id, qty)}
            onRemove={removeLine}
          />
        ))}

        {cartLines.length === 0 ? (
          <p className="mb-3 mt-6 px-8 text-center font-mono text-[12.5px] text-sub">
            {t("emptyCart")}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-action py-3.5 text-[15.5px] font-extrabold text-action-chrome active:scale-95"
          data-testid="open-picker"
        >
          <Plus size={20} strokeWidth={3} /> {t("addProductsTitle")}
        </button>
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
          {error === "frozen" ? (
            <p className="text-[12px] font-semibold text-danger">{t("orderFrozen")}</p>
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

      {pickerOpen ? (
        <ProductPicker
          products={products}
          categories={categories}
          suppliers={suppliers}
          inOrder={new Map(cartLines.map((l) => [l.product.id, l.quantity]))}
          onClose={() => setPickerOpen(false)}
          onAdd={addProducts}
          onEditLine={(id) => {
            setPickerOpen(false);
            setKeypad({ id, tab: "qty" });
          }}
        />
      ) : null}

      {keypad && cart[keypad.id] ? (
        <OrderKeypad
          product={productMap.get(keypad.id)!}
          qty={cart[keypad.id].qty}
          sellPrice={
            cartLines.find((l) => l.product.id === keypad.id)?.product.sellPrice ??
            sellUnitPrice(productMap.get(keypad.id)!)
          }
          initialTab={keypad.tab}
          onSetQty={setQuantity}
          onSetSellPrice={(id, price) => setSellPrice(id, String(price))}
          onClose={() => setKeypad(null)}
        />
      ) : null}

      {undo ? (
        <div
          className="fixed inset-x-4 z-50 mx-auto flex max-w-[540px] items-center justify-between rounded-2xl bg-ink px-4 py-3 text-surface"
          style={{ bottom: 88 }}
          data-testid="undo-toast"
        >
          <span className="min-w-0 truncate pr-3 text-[13.5px] font-semibold">
            {t("removedLine", { name: productMap.get(undo.id)?.name ?? "" })}
          </span>
          <button
            type="button"
            onClick={restoreLine}
            className="shrink-0 text-[13.5px] font-extrabold text-warn"
            data-testid="undo-restore"
          >
            {t("undo")}
          </button>
        </div>
      ) : null}

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
