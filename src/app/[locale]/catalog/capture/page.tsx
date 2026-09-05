import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/authz";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { CaptureScreen } from "@/components/capture/capture-screen";

/**
 * The market screen: photograph, next product, photograph. Nothing here
 * asks for a name, a price or a quantity — every capture becomes a draft on
 * the server, read by the AI and reviewed later, whether the phone was
 * online at the booth or not. The detailed form stays at /catalog/new for
 * desk work.
 */
export default async function CapturePage() {
  const { companyId } = await requireUser();
  const t = await getTranslations("capture");
  const suppliers = await getSuppliersForPicker(companyId);
  return (
    <CaptureScreen
      title={t("title")}
      suppliers={suppliers.map((s) => ({
        id: s.id,
        name: s.companyName || s.companyNameZh,
        booth: s.boothLocation,
      }))}
    />
  );
}
