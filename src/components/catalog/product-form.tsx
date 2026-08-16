"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

type Category = { id: number; nameEn: string; nameZh: string };

type ProductFormValues = {
  sku: string;
  nameEn: string;
  nameZh: string;
  categoryId: number;
  descriptionEn: string;
  descriptionZh: string;
  price: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  active: boolean;
  imagePath: string | null;
};

export function ProductForm({
  categories,
  action,
  defaultValues,
  submitLabel,
}: {
  categories: Category[];
  action: (prevState: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: Partial<ProductFormValues>;
  submitLabel: string;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const [categoryId, setCategoryId] = useState(
    defaultValues?.categoryId ? String(defaultValues.categoryId) : categories[0] ? String(categories[0].id) : "",
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku">{t("sku")}</Label>
          <Input id="sku" name="sku" defaultValue={defaultValues?.sku} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">{t("category")}</Label>
          <input type="hidden" name="categoryId" value={categoryId} />
          <Select value={categoryId} onValueChange={setCategoryId}>
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nameEn">{t("nameEn")}</Label>
          <Input id="nameEn" name="nameEn" defaultValue={defaultValues?.nameEn} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nameZh">{t("nameZh")}</Label>
          <Input id="nameZh" name="nameZh" defaultValue={defaultValues?.nameZh} required />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="descriptionEn">{t("descriptionEn")}</Label>
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            defaultValue={defaultValues?.descriptionEn}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="descriptionZh">{t("descriptionZh")}</Label>
          <Textarea
            id="descriptionZh"
            name="descriptionZh"
            defaultValue={defaultValues?.descriptionZh}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">{t("price")}</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.price}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={defaultValues?.currency ?? "USD"}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="moq">{t("moq")}</Label>
          <Input
            id="moq"
            name="moq"
            type="number"
            min="1"
            defaultValue={defaultValues?.moq ?? 1}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qtyPerBox">{t("qtyPerBox")}</Label>
          <Input
            id="qtyPerBox"
            name="qtyPerBox"
            type="number"
            min="1"
            defaultValue={defaultValues?.qtyPerBox ?? 1}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lengthCm">{t("length")}</Label>
          <Input
            id="lengthCm"
            name="lengthCm"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.lengthCm ?? 0}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="widthCm">{t("width")}</Label>
          <Input
            id="widthCm"
            name="widthCm"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.widthCm ?? 0}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heightCm">{t("height")}</Label>
          <Input
            id="heightCm"
            name="heightCm"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.heightCm ?? 0}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="weightKg">{t("weight")}</Label>
          <Input
            id="weightKg"
            name="weightKg"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.weightKg ?? 0}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="image">{t("image")}</Label>
          {defaultValues?.imagePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={defaultValues.imagePath}
              alt=""
              className="mb-1 h-24 w-24 rounded-md object-cover"
            />
          ) : null}
          <input
            id="image"
            name="image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="active"
            name="active"
            type="checkbox"
            defaultChecked={defaultValues?.active ?? true}
            className="h-4 w-4"
          />
          <Label htmlFor="active">{t("active")}</Label>
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600">{common("required")}</p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
