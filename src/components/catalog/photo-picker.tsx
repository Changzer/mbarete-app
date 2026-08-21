"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { compressImage } from "@/lib/client/compress-image";

/**
 * Photo input for registering a product, built for a phone at a supplier.
 *
 * "Take photo" uses the file input's `capture` hint, which hands off to the
 * phone's own camera app. A live in-page camera would need getUserMedia, which
 * browsers only allow on HTTPS — this app is reached over plain HTTP on the
 * LAN and over Tailscale, so that route is unavailable. The handoff works
 * either way and gives the same result.
 *
 * Files chosen from both buttons are held in one list so they can be reviewed
 * and removed before saving, then written back into the form's real file input
 * so the existing server action keeps receiving `images` unchanged.
 */

/** Rewriting a file input's contents needs DataTransfer; Safari has it since 14.1. */
function canRewriteFileInputs() {
  if (typeof window === "undefined" || typeof DataTransfer === "undefined") return false;
  try {
    return new DataTransfer().items !== undefined;
  } catch {
    return false;
  }
}

/** Ids keep previews distinct: two photos can arrive with the same filename. */
type Picked = { id: number; file: File };
let nextId = 0;

/** Support never changes during a page's life, so there is nothing to watch. */
function subscribeNothing() {
  return () => {};
}

/**
 * One preview tile, owning the object URL for its file.
 *
 * Each tile revoking its own URL means removing a photo — or leaving the page
 * — releases it, without the parent having to track URLs alongside files.
 */
function Preview({
  file,
  onRemove,
  removeLabel,
}: {
  file: File;
  onRemove: () => void;
  removeLabel: string;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="h-24 w-24 rounded-md border border-line bg-surface-2 object-contain"
      />
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-bg shadow"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function PhotoPicker({
  name = "images",
  onFilesChanged,
}: {
  name?: string;
  /** Fires whenever the picked set changes — lets a form auto-transcribe. */
  onFilesChanged?: (files: File[]) => void;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");

  const [picked, setPicked] = useState<Picked[]>([]);

  // Latest-callback ref, so the mirror effect below never has to depend on a
  // function identity that changes every parent render.
  const onFilesChangedRef = useRef(onFilesChanged);
  useEffect(() => {
    onFilesChangedRef.current = onFilesChanged;
  }, [onFilesChanged]);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const formFieldRef = useRef<HTMLInputElement>(null);

  // Only the browser knows what it supports, so the server renders the modern
  // path and anything older swaps to the fallback on hydration.
  const supported = useSyncExternalStore(
    subscribeNothing,
    canRewriteFileInputs,
    () => true,
  );

  // The visible list is the source of truth; mirror it into the submitted input.
  useEffect(() => {
    const field = formFieldRef.current;
    if (!field || !supported) return;
    const dt = new DataTransfer();
    for (const p of picked) dt.items.add(p.file);
    field.files = dt.files;
    onFilesChangedRef.current?.(picked.map((p) => p.file));
  }, [picked, supported]);

  async function add(input: HTMLInputElement | null) {
    if (!input?.files?.length) return;
    const files = Array.from(input.files);
    // Cleared so picking the very same file again still fires a change event.
    input.value = "";
    // Phone photos are shrunk before they ever touch the form — a full-size
    // camera shot is a slow upload over Tailscale and more than the server
    // accepts in one go.
    const compressed = await Promise.all(files.map(compressImage));
    const added = compressed.map((file) => ({ id: nextId++, file }));
    setPicked((prev) => [...prev, ...added]);
  }

  function remove(id: number) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  // Until the check has run, and on anything too old for DataTransfer, fall
  // back to a plain file input rather than silently dropping the photos.
  if (!supported) {
    return (
      <input
        name={name}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="text-sm"
        onChange={(e) => onFilesChanged?.(Array.from(e.currentTarget.files ?? []))}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The only input that is submitted; kept in step with `picked`. */}
      <input ref={formFieldRef} name={name} type="file" multiple className="hidden" />

      {/* Triggers. `capture` asks for the rear camera, straight to the viewfinder. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={() => add(cameraRef.current)}
      />
      {/*
        `image/*` rather than a format list: iPhones store HEIC, which the
        compressor converts to JPEG on the way in. A narrow accept list would
        make Safari transcode (slowly) or hide those photos entirely.
      */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={() => add(libraryRef.current)}
      />

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          data-testid="take-photo"
          onClick={() => cameraRef.current?.click()}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2 active:bg-surface-2"
        >
          <Camera className="h-5 w-5" />
          {t("takePhoto")}
        </button>
        <button
          type="button"
          data-testid="choose-photos"
          onClick={() => libraryRef.current?.click()}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2 active:bg-surface-2"
        >
          <ImagePlus className="h-5 w-5" />
          {t("choosePhotos")}
        </button>
      </div>

      {picked.length > 0 ? (
        <div className="flex flex-wrap gap-3" data-testid="picked-photos">
          {picked.map((p) => (
            <Preview
              key={p.id}
              file={p.file}
              removeLabel={common("delete")}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      ) : null}

      <p className="text-xs text-sub">
        {picked.length > 0 ? t("photosReady", { count: picked.length }) : t("imagesHelp")}
      </p>
    </div>
  );
}
