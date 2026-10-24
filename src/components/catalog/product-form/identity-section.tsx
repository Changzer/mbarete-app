"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Field, FormSection } from "@/components/ui/disclosure";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Category, ProductFormValues } from "./shared";

/**
 * How the product is filed: SKU, the factory's own code, the category. Also
 * carries the hidden values a save posts back unchanged — the cropped photo
 * and what was read off the booth — and where to land after an edit.
 */
export function IdentitySection({
  defaults,
  thumbPath,
  returnQuery,
  boardText,
  aiNotes,
  categories,
  categoryId,
  onCategoryChange,
}: {
  defaults?: Partial<ProductFormValues>;
  thumbPath: string;
  returnQuery?: string;
  boardText: string | null;
  aiNotes: string | null;
  categories: Category[];
  categoryId: string;
  onCategoryChange: (value: string) => void;
}) {
  const t = useTranslations("catalog");

  return (
    <FormSection kicker={t("identityGroup")} className="lg:col-span-2">
      <input type="hidden" name="thumbPath" value={thumbPath} />
      {returnQuery ? <input type="hidden" name="returnQuery" value={returnQuery} /> : null}
      <input type="hidden" name="boardText" value={boardText ?? ""} />
      <input type="hidden" name="aiNotes" value={aiNotes ?? ""} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("sku")} htmlFor="sku">
          <Input id="sku" name="sku" numeric defaultValue={defaults?.sku} />
        </Field>
        <Field label={t("supplierCode")} htmlFor="supplierCode" hint={t("supplierCodeHelp")}>
          <Input
            id="supplierCode"
            name="supplierCode"
            defaultValue={defaults?.supplierCode}
            data-testid="supplier-code"
          />
        </Field>
        <Field label={t("category")} htmlFor="categoryId">
          <input type="hidden" name="categoryId" value={categoryId} />
          <Select value={categoryId} onValueChange={onCategoryChange}>
            <SelectTrigger id="categoryId">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nameEn} / {c.nameZh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

    </FormSection>
  );
}
