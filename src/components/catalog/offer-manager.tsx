"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Store, Clock } from "lucide-react";
import { saveOffer, setOfferActive } from "@/lib/actions/offers";
import { isStaleQuote } from "@/lib/offers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Who sells this product, and for how much.
 *
 * Lives on the product's own page rather than the registration form: a
 * product has to exist before anyone can quote it, and on-site registration
 * should stay as fast as it is today. Suppliers are attached afterwards, as
 * quotes come in.
 */

export type ManagedOffer = {
  id: number;
  supplierId: number | null;
  supplierName: string | null;
  price: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  quotedOn: string;
  note: string;
  active: boolean;
};

export type SupplierOption = { id: number; companyName: string };

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: ManagedOffer = {
  id: 0,
  supplierId: null,
  supplierName: null,
  price: 0,
  currency: "RMB",
  moq: 1,
  leadTimeDays: 0,
  quotedOn: "",
  note: "",
  active: true,
};

export function OfferManager({
  productId,
  offers,
  suppliers,
}: {
  productId: number;
  offers: ManagedOffer[];
  suppliers: SupplierOption[];
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<ManagedOffer | null>(null);

  const [result, formAction, isPending] = useActionState(
    async (prev: { error?: string } | undefined, formData: FormData) => {
      const r = await saveOffer(prev, formData);
      if (!r.error) {
        setEditing(null);
        formRef.current?.reset();
      }
      return r;
    },
    undefined,
  );

  const current = editing ?? EMPTY;
  // A brand-new quote is almost always today's; an edit keeps its own date.
  const defaultQuotedOn = current.quotedOn || today();

  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [editing]);

  return (
    <div className="flex flex-col gap-4" data-testid="offer-manager">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          {t("suppliersTitle")}
        </h2>
        <p className="mt-1 text-sm text-sub">
          {t("suppliersHelp")}
        </p>
      </div>

      {offers.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-line rounded-lg border border-line"
          data-testid="offer-list"
        >
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="inline-flex min-w-40 items-center gap-1 font-medium text-ink">
                <Store className="h-3.5 w-3.5 text-faint" strokeWidth={1.5} />
                {o.supplierName ?? t("supplierUnknown")}
              </span>
              <span className="font-medium text-ink">
                {o.price.toFixed(2)} {o.currency}
              </span>
              <span className="text-xs text-sub">
                {t("moq")} {o.moq}
                {o.leadTimeDays > 0 ? ` · ${t("leadDays", { days: o.leadTimeDays })}` : ""}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-faint">
                {o.quotedOn}
                {isStaleQuote(o.quotedOn) ? <Clock className="h-3 w-3 text-warn" strokeWidth={1.5} /> : null}
              </span>
              {!o.active ? <Badge variant="secondary">{t("inactive")}</Badge> : null}
              <span className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(o)}>
                  {common("edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOfferActive(o.id, !o.active)}
                >
                  {o.active ? t("deactivate") : t("reactivate")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-sub" data-testid="offers-empty">
          {t("noSuppliersYet")}
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              {current.id ? t("editOffer") : t("addOffer")}
            </h3>
            {current.id ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {common("cancel")}
              </Button>
            ) : null}
          </div>
          {/* Remount on target change so every default value resets. */}
          <form key={current.id} ref={formRef} action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="productId" value={productId} />
            {current.id ? <input type="hidden" name="id" value={current.id} /> : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-supplier">{t("supplier")}</Label>
                <select
                  id="offer-supplier"
                  name="supplierId"
                  defaultValue={current.supplierId ?? ""}
                  data-testid="offer-supplier"
                  className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
                >
                  <option value="">{t("supplierUnknown")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-quotedOn">{t("quotedOn")}</Label>
                <Input
                  id="offer-quotedOn"
                  name="quotedOn"
                  type="date"
                  defaultValue={defaultQuotedOn}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-price">{t("costPrice")}</Label>
                <Input
                  id="offer-price"
                  name="price"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  defaultValue={current.price || ""}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-currency">{t("currency")}</Label>
                <Input
                  id="offer-currency"
                  name="currency"
                  defaultValue={current.currency}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-moq">{t("moq")}</Label>
                <Input
                  id="offer-moq"
                  name="moq"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  defaultValue={current.moq || 1}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="offer-lead">{t("leadTime")}</Label>
                <Input
                  id="offer-lead"
                  name="leadTimeDays"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder={t("leadTimePlaceholder")}
                  defaultValue={current.leadTimeDays || ""}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offer-note">{t("offerNote")}</Label>
              <Input id="offer-note" name="note" defaultValue={current.note} />
            </div>

            {result?.error ? (
              <p className="text-sm text-danger">
                {result.error === "duplicate"
                  ? t("offerDuplicate")
                  : result.error === "missing"
                    ? t("offerGone")
                    : common("required")}
              </p>
            ) : null}

            <div>
              <Button type="submit" disabled={isPending}>
                {common("save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
