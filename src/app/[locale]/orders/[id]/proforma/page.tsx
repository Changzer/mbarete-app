import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderView } from "@/lib/queries/order-view";
import { getCompanyProfile } from "@/lib/queries/settings";
import type { Locale } from "@/i18n/routing";
import { formatCbm, formatWeightKg } from "@/lib/calculations";
import { PrintButton } from "@/components/orders/print-button";
import { Link } from "@/i18n/navigation";

/** Blank lines are dropped so an unfilled address does not leave gaps. */
function Lines({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-neutral-500">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

export default async function ProformaPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations("proforma");
  const orderT = await getTranslations("orders");

  const [view, company] = await Promise.all([
    getOrderView(Number(id), locale as Locale),
    getCompanyProfile(),
  ]);
  if (!view) notFound();
  const { order, client, rows, targets, totals } = view;

  const quote = order.displayCurrency;
  const issued = new Date(order.createdAt);
  const validUntil = new Date(issued);
  validUntil.setDate(validUntil.getDate() + company.validityDays);
  const money = (n: number) => n.toFixed(2);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 text-neutral-900 print:max-w-none print:p-0 print:text-black">
      {/*
        Printed on A4 with the browser's own margins turned down, and the app
        chrome removed. `print:` utilities handle the rest.
      */}
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: #fff !important; }
          header, nav { display: none !important; }
        }
      `}</style>

      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/orders/${order.id}`}
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          ← {orderT("title")}
        </Link>
        <PrintButton />
      </div>

      {!company.companyName ? (
        <p
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden"
          data-testid="company-missing"
        >
          {t("companyMissing")}
        </p>
      ) : null}

      {/* --- the document itself --- */}
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-8 border-b border-neutral-300 pb-6">
          <div>
            <div className="text-xl font-bold" data-testid="vendor-name">
              {company.companyName || t("yourCompany")}
            </div>
            <Lines text={company.addressLines} className="mt-1 text-neutral-600" />
            <div className="mt-1 text-neutral-600">
              <Row label={t("phone")} value={company.phone} />
              <Row label={t("email")} value={company.email} />
              <Row label={t("website")} value={company.website} />
              <Row label={t("taxId")} value={company.taxId} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold uppercase tracking-wide">{t("title")}</div>
            <div className="mt-2 text-neutral-600">
              <Row label={t("number")} value={order.orderNumber} />
              <Row label={t("date")} value={issued.toLocaleDateString()} />
              {company.validityDays > 0 ? (
                <Row label={t("validUntil")} value={validUntil.toLocaleDateString()} />
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 border-b border-neutral-300 py-6">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t("billTo")}
            </div>
            <div className="font-semibold" data-testid="client-name">
              {client?.companyName ?? "—"}
            </div>
            <div className="text-neutral-600">
              <Row label={t("attn")} value={client?.contactPerson} />
              <Row label={t("phone")} value={client?.phone} />
              <Row label={t("email")} value={client?.email} />
              <Row label="WhatsApp" value={client?.whatsapp} />
              <Row label="WeChat" value={client?.wechat} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t("terms")}
            </div>
            <div className="text-neutral-600">
              <Row label={t("incoterms")} value={company.incoterms} />
              <Row label={t("currency")} value={quote} />
              <Row label={t("totalCartons")} value={String(totals.totalCartons)} />
              <Row label={t("totalCbm")} value={`${formatCbm(totals.totalCbm)} m³`} />
              <Row label={t("totalWeight")} value={`${formatWeightKg(totals.totalWeightKg)} kg`} />
            </div>
            <Lines text={company.paymentTerms} className="mt-2 text-neutral-600" />
          </div>
        </div>

        <table className="w-full border-collapse py-6 text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-2 font-semibold">{t("item")}</th>
              <th className="py-2 pr-2 font-semibold">{t("sku")}</th>
              <th className="py-2 pr-2 text-right font-semibold">{t("quantity")}</th>
              <th className="py-2 pr-2 text-right font-semibold">{t("cartons")}</th>
              <th className="py-2 pr-2 text-right font-semibold">{t("unitPrice")}</th>
              <th className="py-2 text-right font-semibold">{t("amount")}</th>
            </tr>
          </thead>
          <tbody data-testid="proforma-lines">
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-200">
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2 text-neutral-600">{r.sku}</td>
                <td className="py-2 pr-2 text-right">{r.quantity}</td>
                <td className="py-2 pr-2 text-right">{r.cartons ?? "—"}</td>
                <td className="py-2 pr-2 text-right">
                  {money(r.sellPrice)} {r.currencySnapshot}
                </td>
                <td className="py-2 text-right">
                  {money(r.sellTotal)} {r.currencySnapshot}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end pt-4">
          <div className="w-72">
            <div className="flex justify-between py-1">
              <span className="text-neutral-600">{orderT("goodsSubtotal")}</span>
              <span data-testid="proforma-goods">
                {money(totals.goods[quote] ?? 0)} {quote}
              </span>
            </div>
            {order.commissionPct > 0 ? (
              <div className="flex justify-between py-1">
                <span className="text-neutral-600">
                  {orderT("commissionAmount")} ({order.commissionPct}%)
                </span>
                <span>
                  {money(totals.commission[quote] ?? 0)} {quote}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-neutral-300 pt-2 text-base font-bold">
              <span>{orderT("grandTotal")}</span>
              <span data-testid="proforma-total">
                {money(totals.grandTotal[quote] ?? 0)} {quote}
              </span>
            </div>
            {targets
              .filter((c) => c !== quote)
              .map((c) => (
                <div key={c} className="flex justify-between py-1 text-neutral-600">
                  <span>{t("equivalent")}</span>
                  <span>
                    {money(totals.grandTotal[c] ?? 0)} {c}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {company.bankAccountName || company.bankName || company.bankAccountNumber ? (
          <div className="mt-8 border-t border-neutral-300 pt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t("bankDetails")}
            </div>
            <div className="text-neutral-700">
              <Row label={t("bankAccountName")} value={company.bankAccountName} />
              <Row label={t("bankName")} value={company.bankName} />
              <Row label={t("bankAccountNumber")} value={company.bankAccountNumber} />
              <Row label={t("bankSwift")} value={company.bankSwift} />
            </div>
            <Lines text={company.bankAddress} className="text-neutral-700" />
          </div>
        ) : null}

        {order.notes ? (
          <div className="mt-6">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {orderT("notes")}
            </div>
            <div className="whitespace-pre-wrap text-neutral-700">{order.notes}</div>
          </div>
        ) : null}

        <Lines
          text={company.footerNote}
          className="mt-8 border-t border-neutral-300 pt-4 text-xs text-neutral-500"
        />
      </div>
    </div>
  );
}
