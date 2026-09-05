import { getTranslations } from "next-intl/server";
import { getOpenDrafts } from "@/lib/queries/drafts";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { DraftList } from "@/components/catalog/draft-list";
import { requireUser } from "@/lib/authz";
import { getSuppliersForPicker } from "@/lib/queries/contacts";

/**
 * Captures delivered from phones, waiting to be reviewed into the catalog or
 * the contact book. This is where "populate the info once there is a
 * connection" actually happens — at the hotel or back at the office, with the
 * AI's reading already attached to each capture.
 */
export default async function DraftsPage() {
  const t = await getTranslations("drafts");
  const { companyId } = await requireUser();
  const [drafts, suppliers] = await Promise.all([getOpenDrafts(companyId), getSuppliersForPicker(companyId)]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-ink">
        {t("title")}
      </h1>
      <p className="mb-6 text-sm text-sub">{t("help")}</p>
      <DraftList
        drafts={drafts}
        aiEnabled={isTranscriptionEnabled()}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.companyName || s.companyNameZh, booth: s.boothLocation }))}
      />
    </div>
  );
}
