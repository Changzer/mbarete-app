"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { submitEnquiry, type EnquiryResult } from "@/lib/actions/enquiry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/landing/photo-picker";

/** Mirrors the server's caps so the picker can refuse a file before the wait. */
const PHOTO_MAX = 4;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function errorText(t: ReturnType<typeof useTranslations>, result: EnquiryResult | undefined) {
  switch (result?.error) {
    case undefined:
      return null;
    case "rate-limited":
      return t("errorRateLimited");
    case "photos":
      return t("errorPhotos");
    default:
      return t("errorInvalid");
  }
}

export function EnquiryForm() {
  const t = useTranslations("landing.form");
  const [result, formAction, isPending] = useActionState(submitEnquiry, undefined);
  const message = errorText(t, result);

  if (result?.ok) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
        <p className="text-lg font-semibold text-ink">{t("thanksTitle")}</p>
        <p className="max-w-sm text-sm text-sub">{t("thanksBody")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-7">
      <h3 className="sr-only">{t("formTitle")}</h3>

      {/* The product first. Someone arrives here wanting to talk about a thing
          they want made, not to hand over their email — asking for contact
          details before the product is what makes a quote form feel like a
          toll gate. */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sub">
          {t("sectionProduct")}
        </legend>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eq-message">{t("message")}</Label>
          <Textarea
            id="eq-message"
            name="message"
            required
            rows={4}
            maxLength={4000}
            placeholder={t("messagePlaceholder")}
          />
        </div>

        <PhotoPicker max={PHOTO_MAX} maxBytes={PHOTO_MAX_BYTES} name="photos" />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-quantity">{t("quantity")}</Label>
            <Input
              id="eq-quantity"
              name="quantity"
              maxLength={200}
              placeholder={t("quantityPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-destination">{t("destination")}</Label>
            <Input
              id="eq-destination"
              name="destination"
              maxLength={200}
              placeholder={t("destinationPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-target">{t("targetPrice")}</Label>
            <Input
              id="eq-target"
              name="targetPrice"
              maxLength={200}
              placeholder={t("targetPricePlaceholder")}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sub">
          {t("sectionContact")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-name">{t("name")}</Label>
            <Input id="eq-name" name="name" autoComplete="name" required maxLength={120} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-company">{t("companyName")}</Label>
            <Input
              id="eq-company"
              name="companyName"
              autoComplete="organization"
              required
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-email">{t("email")}</Label>
            <Input
              id="eq-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={200}
            />
          </div>
          {/* Optional and free text: the buyers are across Latin America and
              the team answers from China, so this is a WhatsApp number in any
              country, a WeChat ID, or nothing. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eq-contact">
              {t("preferredContact")}{" "}
              <span className="font-normal text-sub">— {t("preferredContactOptional")}</span>
            </Label>
            <Input
              id="eq-contact"
              name="preferredContact"
              autoComplete="tel"
              placeholder={t("preferredContactPlaceholder")}
              maxLength={200}
            />
          </div>
        </div>
      </fieldset>

      {message ? (
        <p className="text-sm text-danger" role="alert">
          {message}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={isPending} size="lg">
          {isPending ? t("submitting") : t("submit")}
        </Button>
        <p className="text-center text-xs text-sub">{t("privacy")}</p>
      </div>
    </form>
  );
}
