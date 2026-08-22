"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * One-tap order exports. Plain navigations to the export route, so the
 * browser handles the download and the file is ready to share on
 * WeChat/WhatsApp.
 *
 * When lines have no sell price the file quotes the cost instead — that may
 * be exactly wrong for a customer document, so the agent confirms first.
 */
export function OrderExportButtons({
  orderId,
  sellMissingCount,
}: {
  orderId: number;
  sellMissingCount: number;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();

  const download = (format: "xlsx" | "pdf") => {
    if (
      sellMissingCount > 0 &&
      !confirm(t("exportSellMissingWarning", { count: sellMissingCount }))
    ) {
      return;
    }
    // A Content-Disposition download from a route handler; the page never unloads.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/orders/${orderId}/export?format=${format}&locale=${locale}`;
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => download("xlsx")} data-testid="export-xlsx">
        {t("exportXlsx")}
      </Button>
      <Button variant="outline" size="sm" onClick={() => download("pdf")} data-testid="export-pdf">
        {t("exportPdf")}
      </Button>
    </>
  );
}
