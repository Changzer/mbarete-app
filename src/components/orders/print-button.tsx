"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Opens the browser's print dialog, where the destination is "Save as PDF".
 *
 * Deliberately not a server-rendered PDF: a proforma here carries Chinese
 * company and product names, and every JS PDF library needs a CJK font
 * embedded before it can draw one. Printing uses the fonts the device already
 * has, so both languages come out right on a laptop and on a phone.
 */
export function PrintButton({ label }: { label?: string }) {
  const t = useTranslations("proforma");
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      {label ?? t("savePdf")}
    </Button>
  );
}
