"use client";

import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection } from "@/components/ui/disclosure";
import { AiReading } from "./ai-reading";
import type { ProductFormValues } from "./shared";

export function DescriptionSection({
  defaults,
  reading,
}: {
  defaults?: Partial<ProductFormValues>;
  /** The booth's reading, when this form has no photo panel to show it in. */
  reading: { boardText: string | null; notes: string | null } | null;
}) {
  const t = useTranslations("catalog");

  return (
    <FormSection kicker={t("description")} className="lg:col-span-2">
      <Field label={t("descriptionEn")} htmlFor="descriptionEn">
        <Textarea
          id="descriptionEn"
          name="descriptionEn"
          defaultValue={defaults?.descriptionEn}
        />
      </Field>
      <Field label={t("descriptionZh")} htmlFor="descriptionZh">
        <Textarea
          id="descriptionZh"
          name="descriptionZh"
          defaultValue={defaults?.descriptionZh}
        />
      </Field>
      {/* With no AI panel on this form, the booth's reading still has to
          be visible somewhere: a figure is easier to trust beside the board. */}
      {reading && (reading.boardText || reading.notes) ? (
        <AiReading boardText={reading.boardText} notes={reading.notes} />
      ) : null}
    </FormSection>
  );
}
