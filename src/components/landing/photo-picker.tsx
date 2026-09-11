"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus, X } from "lucide-react";

function PhotoPreview({ file }: { file: File }) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const src = URL.createObjectURL(file);
    if (preview.current) preview.current.src = src;
    return () => URL.revokeObjectURL(src);
  }, [file]);
  // Local preview only; the server validates and re-encodes the actual bytes.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={preview} alt={file.name} className="h-24 w-24 rounded-md border border-line object-cover" />;
}

export function PhotoPicker({ max, maxBytes, files, onChange, disabled = false }: {
  max: number; maxBytes: number; files: File[]; onChange: (files: File[]) => void; disabled?: boolean;
}) {
  const t = useTranslations("landing.form");
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function onPick(picked: FileList | null) {
    if (!picked?.length) return;
    const incoming = Array.from(picked);
    // The picker never submits directly. Clearing it lets the same file be
    // selected again and cannot replace the accepted attachments on failure.
    if (inputRef.current) inputRef.current.value = "";
    setProblem(null);
    if (incoming.some((file) => !file.type.startsWith("image/"))) {
      setProblem(t("photosTypeError")); return;
    }
    if (incoming.some((file) => file.size > maxBytes)) {
      setProblem(t("photosSizeError", { mb: Math.floor(maxBytes / (1024 * 1024)) })); return;
    }
    if (files.length + incoming.length > max) {
      setProblem(t("photosCountError", { max })); return;
    }
    onChange([...files, ...incoming]);
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-ink">{t("photos")} <span className="font-normal text-sub">({t("photosOptional")})</span></span>
      <p className="text-sm leading-relaxed text-sub">{t("photosHelp")}</p>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden disabled={disabled} onChange={(event) => onPick(event.target.files)} />
      {files.length ? (
        <ul className="flex flex-wrap gap-3">
          {files.map((file, i) => (
            <li key={file.name + file.lastModified + i} className="relative">
              <PhotoPreview file={file} />
              <button type="button" disabled={disabled} onClick={() => {
                onChange(files.filter((_, index) => index !== i)); setProblem(null);
              }} aria-label={t("photosRemove", { name: file.name })}
                className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-surface-2 disabled:opacity-50">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < max ? (
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-bg px-4 py-3 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50">
          <ImagePlus className="h-5 w-5" aria-hidden />{files.length ? t("photosAddMore") : t("photosAdd")}
        </button>
      ) : null}
      {problem ? <p className="text-sm text-danger" role="alert">{problem}</p> : null}
    </div>
  );
}
