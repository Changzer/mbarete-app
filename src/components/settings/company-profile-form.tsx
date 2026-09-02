"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveCompanyProfile } from "@/lib/actions/settings";
import type { CompanyProfile } from "@/lib/queries/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

function Field({
  name,
  label,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} />
      {hint ? (
        <p className="text-xs text-sub">{hint}</p>
      ) : null}
    </div>
  );
}

export function CompanyProfileForm({
  profile,
  currencies,
}: {
  profile: CompanyProfile;
  /** Codes in the rate table — the only currencies a result can be shown in. */
  currencies: string[];
}) {
  const t = useTranslations("company");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(
    saveCompanyProfile,
    undefined,
  );

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-4 text-sm text-sub">{t("help")}</p>
        <form action={formAction} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="companyName" label={t("companyName")} defaultValue={profile.companyName} />
            <Field name="taxId" label={t("taxId")} defaultValue={profile.taxId} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addressLines">{t("address")}</Label>
            <Textarea
              id="addressLines"
              name="addressLines"
              rows={3}
              defaultValue={profile.addressLines}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field name="phone" label={t("phone")} defaultValue={profile.phone} />
            <Field name="email" label={t("email")} defaultValue={profile.email} />
            <Field name="website" label={t("website")} defaultValue={profile.website} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="functionalCurrency">{t("functionalCurrency")}</Label>
              {/* A native select: "" (automatic) is a legitimate choice here,
                  and the value must post with the rest of the form. */}
              <select
                id="functionalCurrency"
                name="functionalCurrency"
                defaultValue={profile.functionalCurrency}
                data-testid="functional-currency"
                className="focus-ring h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink"
              >
                <option value="">{t("functionalCurrencyAuto")}</option>
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <p className="text-xs text-sub">{t("functionalCurrencyHint")}</p>
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">
              {t("termsSection")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field name="incoterms" label={t("incoterms")} defaultValue={profile.incoterms} hint={t("incotermsHint")} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="validityDays">{t("validityDays")}</Label>
                <Input
                  id="validityDays"
                  name="validityDays"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  defaultValue={profile.validityDays}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              <Label htmlFor="paymentTerms">{t("paymentTerms")}</Label>
              <Textarea
                id="paymentTerms"
                name="paymentTerms"
                rows={2}
                defaultValue={profile.paymentTerms}
              />
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              <Label htmlFor="footerNote">{t("footerNote")}</Label>
              <Textarea
                id="footerNote"
                name="footerNote"
                rows={2}
                defaultValue={profile.footerNote}
              />
            </div>
          </div>

          {errorMessage ? (
            <p className="text-sm text-danger">{common("required")}</p>
          ) : null}

          <div>
            <Button type="submit" disabled={isPending}>
              {common("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
