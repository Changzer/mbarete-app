import { getTranslations } from "next-intl/server";
import { getOpenDrafts } from "@/lib/queries/drafts";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { DraftList } from "@/components/catalog/draft-list";

/**
 * Captures delivered from phones, waiting to be reviewed into the catalog or
 * the contact book. This is where "populate the info once there is a
 * connection" actually happens — at the hotel or back at the office, with the
 * AI's reading already attached to each capture.
 */
export default async function DraftsPage() {
  const t = await getTranslations("drafts");
  const drafts = await getOpenDrafts();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("title")}
      </h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">{t("help")}</p>
      <DraftList drafts={drafts} aiEnabled={isTranscriptionEnabled()} />
    </div>
  );
}
