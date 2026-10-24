"use client";

import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/disclosure";
import { PhotoPicker } from "@/components/catalog/photo-picker";
import { AiReading } from "./ai-reading";
import { readErrorKey } from "./submit-checks";
import type { ExistingImage } from "./shared";
import type { PhotoReading } from "./use-photo-reading";

/**
 * Photos first, and not as a courtesy: at a booth the phone comes out, the
 * product is photographed, and everything else on this form is either read
 * off those photos by the AI pass or filled in afterwards.
 */
export function PhotosSection({
  draftId,
  draftImages,
  existingImages,
  removed,
  onToggleRemoved,
  captureEpoch,
  reading,
}: {
  draftId?: number;
  draftImages: { id: number; path: string }[];
  existingImages: ExistingImage[];
  /** Stored photos ticked for removal on save. */
  removed: number[];
  onToggleRemoved: (id: number) => void;
  /** Bumped after a save to the phone: the picker remounts empty for the next booth. */
  captureEpoch: number;
  reading: PhotoReading;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");

  return (
    <FormSection kicker={t("images")} className="lg:col-span-2">
        {draftId ? <input type="hidden" name="draftId" value={draftId} /> : null}
        {/* Photos captured at the booth, already stored on the server under
            the draft. Saving attaches them to the product as they are. */}
        {draftImages.length > 0 ? (
          <div className="flex flex-wrap gap-3" data-testid="draft-photos">
            {draftImages.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={img.id}
                src={img.path}
                alt=""
                className="h-24 w-24 rounded-[8px] border border-line bg-surface-2 object-contain"
              />
            ))}
          </div>
        ) : null}

        {existingImages.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {existingImages.map((img) => {
              const isRemoved = removed.includes(img.id);
              return (
                <div key={img.id} className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.path}
                    alt=""
                    className={`h-24 w-24 rounded-[8px] border border-line bg-surface-2 object-contain ${
                      isRemoved ? "opacity-30" : ""
                    }`}
                  />
                  {isRemoved ? (
                    <input type="hidden" name="removeImageIds" value={img.id} />
                  ) : null}
                  <button
                    type="button"
                    className="focus-ring min-h-11 px-2 text-[11px] font-semibold text-sub hover:text-danger"
                    onClick={() => onToggleRemoved(img.id)}
                  >
                    {isRemoved ? common("cancel") : common("delete")}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <PhotoPicker key={captureEpoch} onFilesChanged={reading.schedule} />

        {reading.enabled ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={reading.pending}
              onClick={() => reading.read()}
              data-testid="fill-from-photos"
              className="w-full justify-center"
            >
              {reading.pending ? (
                <Loader2 className="h-4 w-4 animate-[spin_2.4s_linear_infinite]" strokeWidth={1.5} />
              ) : (
                <Sparkles className="h-4 w-4" strokeWidth={1.5} />
              )}
              {reading.pending ? t("aiFilling") : t("aiFill")}
            </Button>
            {reading.error ? (
              <p className="text-[12px] font-semibold text-danger" data-testid="ai-error">
                {t(readErrorKey(reading.error))}
              </p>
            ) : reading.notes || reading.boardText ? (
              <AiReading boardText={reading.boardText} notes={reading.notes} />
            ) : (
              <p className="text-[11px] leading-relaxed text-sub">{t("aiFillHelp")}</p>
            )}
            {reading.filled || draftId ? (
              <p
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warn"
                data-testid="ai-verify-hint"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {t("aiVerifyHint")}
              </p>
            ) : null}
          </div>
        ) : null}
    </FormSection>
  );
}
