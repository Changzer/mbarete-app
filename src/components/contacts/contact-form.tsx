"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ContactFormValues = {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  notes: string;
};

export function ContactForm({
  type,
  action,
  defaultValues,
  submitLabel,
  onSuccess,
}: {
  type: "supplier" | "client";
  action: (prevState: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: Partial<ContactFormValues>;
  submitLabel: string;
  onSuccess?: () => void;
}) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");

  async function wrappedAction(prevState: string | undefined, formData: FormData) {
    const result = await action(prevState, formData);
    if (!result) onSuccess?.();
    return result;
  }

  const [errorMessage, formAction, isPending] = useActionState(wrappedAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="companyName">{t("companyName")}</Label>
        <Input
          id="companyName"
          name="companyName"
          defaultValue={defaultValues?.companyName}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
        <Input
          id="contactPerson"
          name="contactPerson"
          defaultValue={defaultValues?.contactPerson}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={defaultValues?.phone} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" defaultValue={defaultValues?.email} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsapp">{t("whatsapp")}</Label>
          <Input id="whatsapp" name="whatsapp" defaultValue={defaultValues?.whatsapp} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wechat">{t("wechat")}</Label>
          <Input id="wechat" name="wechat" defaultValue={defaultValues?.wechat} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes} />
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600">{common("required")}</p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
