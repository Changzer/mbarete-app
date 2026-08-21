"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  saveBankAccount,
  deleteBankAccount,
  setDefaultBankAccount,
} from "@/lib/actions/settings";
import type { BankAccount } from "@/lib/queries/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

function Field({
  name,
  label,
  defaultValue,
  required,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`bank-${name}`}>{label}</Label>
      <Input id={`bank-${name}`} name={name} defaultValue={defaultValue} required={required} />
      {hint ? (
        <p className="text-xs text-sub">{hint}</p>
      ) : null}
    </div>
  );
}

const EMPTY: BankAccount = {
  id: 0,
  label: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
  swift: "",
  bankAddress: "",
  currency: "",
  isDefault: false,
  createdAt: "",
};

/**
 * The registered beneficiary accounts, and the form that adds or edits one.
 * Every proforma prints exactly one of these; the default is what an order
 * gets until somebody picks otherwise on the order page.
 */
export function BankAccountsManager({ accounts }: { accounts: BankAccount[] }) {
  const t = useTranslations("company");
  const common = useTranslations("common");
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [errorMessage, formAction, isPending] = useActionState(
    async (prev: string | undefined, formData: FormData) => {
      const result = await saveBankAccount(prev, formData);
      if (!result) setEditing(null);
      return result;
    },
    undefined,
  );

  const current = editing ?? EMPTY;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-sub">{t("banksHelp")}</p>

      {accounts.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm" data-testid="bank-accounts">
            <thead className="border-b border-line bg-surface-2 text-left text-sub">
              <tr>
                <th className="px-4 py-2 font-medium">{t("bankLabel")}</th>
                <th className="px-4 py-2 font-medium">{t("bankName")}</th>
                <th className="px-4 py-2 font-medium">{t("bankAccountNumber")}</th>
                <th className="px-4 py-2 font-medium">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-4 py-2 font-medium text-ink">
                    {account.label}
                    {account.currency ? (
                      <span className="ml-1 text-xs text-faint">
                        {account.currency}
                      </span>
                    ) : null}
                    {account.isDefault ? (
                      <Badge variant="success" className="ml-2">
                        {t("bankDefault")}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {account.bankName || "—"}
                  </td>
                  <td className="px-4 py-2 text-sub">
                    {account.accountNumber || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(account)}>
                        {common("edit")}
                      </Button>
                      {!account.isDefault ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefaultBankAccount(account.id)}
                        >
                          {t("bankMakeDefault")}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(t("bankDeleteConfirm", { label: account.label }))) {
                            deleteBankAccount(account.id);
                            if (editing?.id === account.id) setEditing(null);
                          }
                        }}
                      >
                        {common("delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-sub" data-testid="banks-empty">
          {t("banksEmpty")}
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              {current.id ? t("bankEditTitle", { label: current.label }) : t("bankAddTitle")}
            </h3>
            {current.id ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {common("cancel")}
              </Button>
            ) : null}
          </div>
          {/* Remount when the target changes so defaultValues reset. */}
          <form key={current.id} action={formAction} className="flex flex-col gap-4">
            {current.id ? <input type="hidden" name="id" value={current.id} /> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                name="label"
                label={t("bankLabel")}
                defaultValue={current.label}
                required
                hint={t("bankLabelHint")}
              />
              <Field name="currency" label={t("bankCurrency")} defaultValue={current.currency} hint={t("bankCurrencyHint")} />
              <Field name="accountName" label={t("bankAccountName")} defaultValue={current.accountName} />
              <Field name="bankName" label={t("bankName")} defaultValue={current.bankName} />
              <Field name="accountNumber" label={t("bankAccountNumber")} defaultValue={current.accountNumber} />
              <Field name="swift" label={t("bankSwift")} defaultValue={current.swift} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bank-bankAddress">{t("bankAddress")}</Label>
              <Textarea
                id="bank-bankAddress"
                name="bankAddress"
                rows={2}
                defaultValue={current.bankAddress}
              />
            </div>
            {errorMessage ? (
              <p className="text-sm text-danger">
                {errorMessage === "missing" ? t("bankGone") : t("bankInvalid")}
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
