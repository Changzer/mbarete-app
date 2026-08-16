"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "@/lib/actions/catalog";

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  description: string;
  categoryName: string;
  price: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  cbm: number;
  imagePath: string | null;
  active: boolean;
};

export function ProductCard({ product }: { product: CatalogProduct }) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
        onClick={() => setOpen(true)}
      >
        <div className="relative aspect-square w-full bg-neutral-100">
          {product.imagePath ? (
            <Image
              src={product.imagePath}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
              {t("image")}
            </div>
          )}
          {!product.active ? (
            <Badge variant="secondary" className="absolute right-2 top-2">
              {t("active")}: {common("no")}
            </Badge>
          ) : null}
        </div>
        <CardContent className="p-3">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {product.name}
          </p>
          <p className="truncate text-xs text-neutral-500">{product.categoryName}</p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>{product.categoryName} · {product.sku}</DialogDescription>
          </DialogHeader>

          {product.imagePath ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-neutral-100">
              <Image
                src={product.imagePath}
                alt={product.name}
                fill
                sizes="512px"
                className="object-cover"
              />
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-neutral-500">{t("price")}</dt>
              <dd className="font-medium text-neutral-900">
                {product.price.toFixed(2)} {product.currency}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t("moq")}</dt>
              <dd className="font-medium text-neutral-900">{product.moq}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t("qtyPerBox")}</dt>
              <dd className="font-medium text-neutral-900">{product.qtyPerBox}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t("size")}</dt>
              <dd className="font-medium text-neutral-900">
                {product.lengthCm}×{product.widthCm}×{product.heightCm}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t("weight")}</dt>
              <dd className="font-medium text-neutral-900">{product.weightKg} kg</dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t("cbm")}</dt>
              <dd className="font-medium text-neutral-900">{product.cbm.toFixed(4)} m³</dd>
            </div>
          </dl>

          {product.description ? (
            <div>
              <p className="text-sm text-neutral-500">{t("description")}</p>
              <p className="text-sm text-neutral-800 whitespace-pre-wrap">
                {product.description}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (confirm(t("deleteConfirm"))) {
                  await deleteProduct(product.id);
                  setOpen(false);
                }
              }}
            >
              {common("delete")}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/catalog/${product.id}/edit`}>{common("edit")}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
