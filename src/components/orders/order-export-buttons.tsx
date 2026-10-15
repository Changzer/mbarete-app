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
  customs = null,
}: {
  orderId: number;
  sellMissingCount: number;
  /**
   * The customs pack, offered once the order is confirmed: how many lines
   * lack China's export code and how many shipment fields are unset, so
   * the agent knows what the broker will find blank. Null hides the button.
   */
  customs?: { missingCodes: number; missingShipment: number } | null;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();

  const download = (doc: "proforma" | "packing" | "customs", format: "xlsx" | "pdf") => {
    if (
      doc === "customs" &&
      customs &&
      (customs.missingCodes > 0 || customs.missingShipment > 0) &&
      !confirm(t("customsMissingWarning", { codes: customs.missingCodes, shipment: customs.missingShipment }))
    ) {
      return;
    }
    // Only the proforma carries prices; the packing list never quotes a cost.
    if (
      doc === "proforma" &&
      sellMissingCount > 0 &&
      !confirm(t("exportSellMissingWarning", { count: sellMissingCount }))
    ) {
      return;
    }
    // A Content-Disposition download from a route handler; the page never unloads.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/orders/${orderId}/export?format=${format}&doc=${doc}&locale=${locale}`;
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => download("proforma", "pdf")} data-testid="export-pdf">
        {t("exportPdf")}
      </Button>
      <Button variant="outline" size="sm" onClick={() => download("packing", "xlsx")} data-testid="export-xlsx">
        {t("exportXlsx")}
      </Button>
      <Button variant="outline" size="sm" onClick={() => download("packing", "pdf")} data-testid="export-packing-pdf">
        {t("exportPackingPdf")}
      </Button>
      {customs ? (
        <Button variant="outline" size="sm" onClick={() => download("customs", "xlsx")} data-testid="export-customs">
          {t("exportCustoms")}
        </Button>
      ) : null}
    </>
  );
}
