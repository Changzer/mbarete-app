"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Field, FormSection } from "@/components/ui/disclosure";
import { CurrencyField, SALE_CHOICES } from "@/components/catalog/currency-field";
import { formatMoney } from "@/lib/money";
import type { ProductFormValues } from "./shared";

/**
 * The commercial group — what a buyer is actually deciding with. It sits
 * under the supplier so a capture can legitimately stop here.
 */
export function CommercialSection({
  defaults,
  onPriceInput,
  vatText,
  onVatChange,
  vatValid,
  inclusiveCost,
  currency,
  onCurrencyChange,
  sellCurrency,
  onSellCurrencyChange,
  qtyPerBox,
  onQtyPerBoxChange,
  missing,
}: {
  defaults?: Partial<ProductFormValues>;
  /** The price input stays uncontrolled so a photo reading can write into it; this follows it. */
  onPriceInput: (value: string) => void;
  vatText: string;
  onVatChange: (value: string) => void;
  vatValid: boolean;
  /** The unit cost with the supplier's VAT, when both are readable. */
  inclusiveCost: number | null;
  currency: string;
  onCurrencyChange: (value: string) => void;
  sellCurrency: string;
  onSellCurrencyChange: (value: string) => void;
  qtyPerBox: string;
  onQtyPerBoxChange: (value: string) => void;
  /** Required fields a refused save found empty. */
  missing: Set<string>;
}) {
  const t = useTranslations("catalog");

  return (
    <FormSection kicker={t("commercial")} className="lg:col-span-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("costPrice")} htmlFor="price" hint={t("costPriceHint")}>
          <Input
            id="price"
            name="price"
            type="text"
            numeric
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={defaults?.price}
            onInput={(e) => onPriceInput(e.currentTarget.value)}
          />
        </Field>
        <Field label={t("supplierVatPct")} htmlFor="supplierVatPct" hint={t("supplierVatHint")}>
          <Input
            id="supplierVatPct"
            name="supplierVatPct"
            type="text"
            numeric
            inputMode="decimal"
            suffix="%"
            placeholder={t("optionalPlaceholder")}
            value={vatText}
            onChange={(e) => onVatChange(e.currentTarget.value)}
            aria-invalid={!vatValid}
            aria-describedby={!vatValid ? "supplier-vat-error" : undefined}
          />
          {!vatValid ? <p id="supplier-vat-error" className="text-xs text-danger">{t("errorSupplierVat")}</p> : null}
        </Field>
        {inclusiveCost !== null ? (
          <p className="col-span-2 -mt-1 text-[12px] text-sub" data-testid="supplier-cost-preview" aria-live="polite">
            {t("costIncludingVat")}: <span className="font-mono font-semibold text-ink">{formatMoney(inclusiveCost, currency, 4)}</span>
          </p>
        ) : null}
        <CurrencyField
          value={currency}
          onChange={onCurrencyChange}
          label={t("currency")}
          otherLabel={t("currencyOther")}
        />

        <Field label={t("moq")} htmlFor="moq" required>
          <Input
            id="moq"
            name="moq"
            className={missing.has("moq") ? "border-danger" : undefined}
            type="text"
            numeric
            inputMode="numeric"
            suffix={t("unitPcs")}
            defaultValue={defaults?.moq ?? 1}
          />
        </Field>
        <Field label={t("qtyPerBox")} htmlFor="qtyPerBox" required>
          <Input
            id="qtyPerBox"
            name="qtyPerBox"
            className={missing.has("qtyPerBox") ? "border-danger" : undefined}
            type="text"
            numeric
            inputMode="numeric"
            suffix={t("perCarton")}
            value={qtyPerBox}
            onChange={(e) => onQtyPerBoxChange(e.target.value)}
          />
        </Field>

        <Field
          label={t("sellPrice")}
          htmlFor="sellPrice"
          hint={t("sellPriceHelp")}
          className="col-span-2"
        >
          <Input
            id="sellPrice"
            name="sellPrice"
            type="text"
            numeric
            inputMode="decimal"
            placeholder={t("optionalPlaceholder")}
            defaultValue={defaults?.sellPrice ? defaults.sellPrice : ""}
          />
        </Field>
        {/* The market the price is for is a switch, like the cost currency:
            USD, RMB or BRL at a tap, anything else one tap further. */}
        <CurrencyField
          value={sellCurrency}
          onChange={onSellCurrencyChange}
          name="sellCurrency"
          label={t("sellCurrency")}
          otherLabel={t("currencyOther")}
          choices={SALE_CHOICES}
          testId="sell-currency"
        />
      </div>

      {/* Both names, stacked: the supplier reads the Chinese one off the box
          and the client reads the English one off the quote. */}
      <Field label={t("nameEn")} htmlFor="nameEn" required>
        <Input
          id="nameEn"
          name="nameEn"
          defaultValue={defaults?.nameEn}
          className={missing.has("nameEn") ? "border-danger" : undefined}
        />
      </Field>
      <Field label={t("nameZh")} htmlFor="nameZh" required>
        <Input
          id="nameZh"
          name="nameZh"
          defaultValue={defaults?.nameZh}
          className={missing.has("nameZh") ? "border-danger" : undefined}
        />
      </Field>
    </FormSection>
  );
}
