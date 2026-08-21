"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createCategory, deleteCategory } from "@/lib/actions/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type Category = { id: number; nameEn: string; nameZh: string };

export function CategoryManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(
    createCategory,
    undefined,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="p-4">
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nameEn">{t("nameEn")}</Label>
              <Input id="nameEn" name="nameEn" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nameZh">{t("nameZh")}</Label>
              <Input id="nameZh" name="nameZh" required />
            </div>
            <Button type="submit" disabled={isPending}>
              {t("addCategory")}
            </Button>
          </form>
          {errorMessage ? (
            <p className="mt-2 text-sm text-danger">{common("required")}</p>
          ) : null}
        </CardContent>
      </Card>

      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-ink">
              {c.nameEn} / {c.nameZh}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const error = await deleteCategory(c.id);
                if (error) alert(t("deleteCategoryInUse"));
              }}
            >
              {common("delete")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
