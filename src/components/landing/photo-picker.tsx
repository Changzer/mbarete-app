"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

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

  // A visitor can select a photo before the client bundle arrives. Adopt
  // that real selection; hydration must not erase or omit it.
  useEffect(() => {
    const selected = inputRef.current?.files;
    if (selected?.length) onChange(Array.from(selected));
  }, [onChange]);

  function setFiles(next: File[]) {
    // Keep one canonical, named input for both native POSTs and enhanced
    // submissions. Removed/rejected photos must never ride along invisibly.
    const selection = new DataTransfer();
    for (const file of next) selection.items.add(file);
    if (inputRef.current) inputRef.current.files = selection.files;
    onChange(next);
  }

  function onPick(picked: FileList | null) {
    if (!picked?.length) return;
    const incoming = Array.from(picked);
    setProblem(null);
    if (incoming.some((file) => !file.type.startsWith("image/"))) {
      setFiles(files);
      setProblem(t("photosTypeError")); return;
    }
    if (incoming.some((file) => file.size > maxBytes)) {
      setFiles(files);
      setProblem(t("photosSizeError", { mb: Math.floor(maxBytes / (1024 * 1024)) })); return;
    }
    if (files.length + incoming.length > max) {
      setFiles(files);
      setProblem(t("photosCountError", { max })); return;
    }
    setFiles([...files, ...incoming]);
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-ink">{t("photos")} <span className="font-normal text-sub">({t("photosOptional")})</span></span>
      <p className="text-sm leading-relaxed text-sub">{t("photosHelp")}</p>
      <input ref={inputRef} type="file" name="photos" accept="image/*" multiple disabled={disabled}
        aria-label={files.length ? t("photosAddMore") : t("photosAdd")}
        onChange={(event) => onPick(event.target.files)}
        className="block min-h-14 w-full min-w-0 cursor-pointer rounded-md border border-dashed border-line-strong bg-bg p-3 text-sm text-sub file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-semibold file:text-ink disabled:cursor-not-allowed disabled:opacity-50" />
      {files.length ? (
        <ul className="flex flex-wrap gap-3">
          {files.map((file, i) => (
            <li key={file.name + file.lastModified + i} className="relative">
              <PhotoPreview file={file} />
              <button type="button" disabled={disabled} onClick={() => {
                setFiles(files.filter((_, index) => index !== i)); setProblem(null);
              }} aria-label={t("photosRemove", { name: file.name })}
                className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-surface-2 disabled:opacity-50">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? <p className="text-sm text-danger" role="alert">{problem}</p> : null}
    </div>
  );
}
