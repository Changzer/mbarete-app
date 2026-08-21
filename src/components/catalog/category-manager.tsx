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
            <p className="mt-2 text-sm text-red-600">{common("required")}</p>
          ) : null}
        </CardContent>
      </Card>

      <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-neutral-900 dark:text-neutral-100">
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
