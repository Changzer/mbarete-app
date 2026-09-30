"use client";

import { useActionState, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, CheckCircle2, ChevronDown } from "lucide-react";
import { submitEnquiry, type EnquiryResult } from "@/lib/actions/enquiry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/landing/photo-picker";
import type { EnquiryFields } from "@/lib/enquiry-schema";

export function EnquiryForm() {
  const t = useTranslations("landing.form");
  const locale = useLocale();
  // Pass the Server Action itself: a client wrapper removes React's native
  // POST fallback and leaves both buttons inert when hydration never finishes.
  const [nativeResult, nativeAction] = useActionState(submitEnquiry, undefined, `/${locale}#contact`);
  const [clientResult, setClientResult] = useState<EnquiryResult>();
  const [isPending, setPending] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const result = clientResult ?? nativeResult;
  const bind = (field: keyof EnquiryFields) => ({
    defaultValue: nativeResult?.fields?.[field] ?? "",
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    // Native fields, including photos, remain the source of truth. Reading
    // the DOM also preserves anything entered before scripts finished loading.
    const formData = new FormData(event.currentTarget);
    setClientResult({});
    setPending(true);
    try { setClientResult(await submitEnquiry(undefined, formData)); }
    catch { setClientResult({ error: "failed" }); }
    finally { setPending(false); }
    // No React form reset on a failed response. The selected files and text
    // stay in place until a confirmed success replaces the form.
  }
  const errorKey = result?.error === "rate-limited" ? "errorRateLimited"
    : result?.error === "photos" ? "errorPhotos"
    : result?.error === "failed" ? "errorFailed" : "errorInvalid";
  const nativeError = nativeResult?.error && !clientResult;

  if (result?.ok) return (
    <div className="flex flex-col items-center gap-4 py-12 text-center" role="status" aria-live="polite">
      <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
      <p className="text-xl font-semibold text-ink">{t("thanksTitle")}</p>
      <p className="max-w-sm text-base leading-relaxed text-sub">{t("thanksBody")}</p>
    </div>
  );

  return (
    <form action={nativeAction} onSubmit={submit} className="flex flex-col gap-6" aria-busy={isPending}>
      <h3 className="sr-only">{t("formTitle")}</h3>
      <p className="text-xs leading-relaxed text-sub">{t("requiredHint")}</p>
      {nativeError ? <p className="text-sm text-danger" role="alert">{t(errorKey)}</p> : null}
      <fieldset disabled={isPending} className="flex min-w-0 flex-col gap-5 disabled:opacity-70">
        <legend className="mb-3 text-sm font-semibold text-ink">{t("sectionProduct")}</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="eq-message">{t("message")}</Label>
          <Textarea id="eq-message" name="message" required rows={4} maxLength={4000} placeholder={t("messagePlaceholder")} {...bind("message")} />
        </div>
        <PhotoPicker max={4} maxBytes={8 * 1024 * 1024} files={photos} onChange={setPhotos} disabled={isPending} />
        {nativeResult?.error && nativeResult.hadPhotos && photos.length === 0 ? (
          <p className="text-sm text-sub" role="status">{t("photosReselect")}</p>
        ) : null}
        <details className="group border-y border-line py-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            {t("detailsToggle")}<ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mb-4 mt-2 text-sm text-sub">{t("detailsHelp")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["quantity", "destination", "targetPrice"] as const).map((key) => (
              <div key={key} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={"eq-" + key}>{t(key)} <span className="font-normal text-sub">({t("optional")})</span></Label>
                <Input id={"eq-" + key} name={key} maxLength={200} placeholder={t(key + "Placeholder")} {...bind(key)} />
              </div>
            ))}
          </div>
        </details>
      </fieldset>
      <fieldset disabled={isPending} className="grid min-w-0 gap-4 sm:grid-cols-2 disabled:opacity-70">
        <legend className="mb-3 text-sm font-semibold text-ink">{t("sectionContact")}</legend>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="eq-name">{t("name")}</Label>
          <Input id="eq-name" name="name" autoComplete="name" required maxLength={120} {...bind("name")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="eq-email">{t("email")}</Label>
          <Input id="eq-email" name="email" type="email" autoComplete="email" required maxLength={200} {...bind("email")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="eq-contact">{t("preferredContact")} <span className="font-normal text-sub">({t("optional")})</span></Label>
          <Input id="eq-contact" name="preferredContact" autoComplete="tel" placeholder={t("preferredContactPlaceholder")} maxLength={200} {...bind("preferredContact")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="eq-company">{t("companyName")} <span className="font-normal text-sub">({t("optional")})</span></Label>
          <Input id="eq-company" name="companyName" autoComplete="organization" maxLength={120} {...bind("companyName")} />
        </div>
      </fieldset>
      {result?.error && !nativeError ? <p className="text-sm text-danger" role="alert">{t(errorKey)}</p> : null}
      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={isPending} size="lg" className="min-h-13 h-auto whitespace-normal rounded-md py-3 text-base">
          {isPending ? t("submitting") : t("submit")}<ArrowUpRight aria-hidden />
        </Button>
        <p className="text-sm leading-relaxed text-sub">{t("privacy")} <Link href="/privacy" className="underline underline-offset-4">{t("privacyLink")}</Link></p>
      </div>
    </form>
  );
}
