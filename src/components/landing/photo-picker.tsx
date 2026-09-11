"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus, X } from "lucide-react";

/**
 * Up to four product photos on the public enquiry form.
 *
 * A hidden file input driven by a button, with the chosen files mirrored back
 * as removable thumbnails — the native control shows only "3 files selected",
 * which is no help when the whole point is checking you attached the right
 * picture of the right product.
 *
 * The caps here are courtesy, not security: they tell someone their photo is
 * too big before they wait for an upload that would be refused anyway. The
 * server enforces the same limits again, because anyone can post this form
 * without ever loading this component.
 */
export function PhotoPicker({
  max,
  maxBytes,
  name,
}: {
  max: number;
  maxBytes: number;
  name: string;
}) {
  const t = useTranslations("landing.form");
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * The input's own FileList is what gets submitted, so it has to be rebuilt
   * rather than merely tracked: dropping a file from React state alone would
   * leave it in the input and still upload it.
   */
  function commit(next: File[]) {
    const transfer = new DataTransfer();
    for (const f of next) transfer.items.add(f);
    if (inputRef.current) inputRef.current.files = transfer.files;
    previews.forEach(URL.revokeObjectURL);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function onPick(picked: FileList | null) {
    if (!picked) return;
    setProblem(null);
    const incoming = [...picked];

    if (incoming.some((f) => !f.type.startsWith("image/"))) {
      setProblem(t("photosTypeError"));
      return;
    }
    if (incoming.some((f) => f.size > maxBytes)) {
      setProblem(t("photosSizeError", { mb: Math.floor(maxBytes / (1024 * 1024)) }));
      return;
    }
    const next = [...files, ...incoming];
    if (next.length > max) {
      setProblem(t("photosCountError", { max }));
      return;
    }
    commit(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink">
        {t("photos")} <span className="font-normal text-sub">— {t("photosOptional")}</span>
      </span>
      <p className="text-[12.5px] leading-relaxed text-sub">{t("photosHelp")}</p>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => onPick(e.target.files)}
      />

      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {previews.map((src, i) => (
            <li key={src} className="relative">
              {/* A local blob URL for a file the visitor just chose; next/image
                  would want a loader and a known size for no benefit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={files[i]?.name ?? ""}
                className="h-20 w-20 rounded-field border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => commit(files.filter((_, n) => n !== i))}
                aria-label={t("photosRemove", { name: files[i]?.name ?? "" })}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-surface-2"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {files.length < max ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface text-[13px] font-semibold text-ink hover:bg-surface-2 sm:w-auto sm:px-5"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {files.length ? t("photosAddMore") : t("photosAdd")}
        </button>
      ) : null}

      {problem ? (
        <p className="text-[12.5px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
