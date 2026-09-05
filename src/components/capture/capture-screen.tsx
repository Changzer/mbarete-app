"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  Contact,
  ImagePlus,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useOutbox } from "@/components/offline/outbox";
import {
  addAddendum,
  addPhoto,
  ensureVisit,
  markVisitCard,
  newCapture,
  photosOf,
  photoUrl,
  pruneOld,
  removePhoto,
  resumeCapture,
  seal,
  setLocalVisitSupplier,
  setNote,
  snapshot,
  startVisit,
  touchVisit,
  type PhotoTimings,
} from "@/lib/client/capture-store";
import { requestPersistentStorage } from "@/lib/client/outbox-db";
import { previousCapture, type LocalCapture, type LocalVisit } from "@/lib/offline/capture";
import { formatLocalMinute } from "@/lib/format-time";

/**
 * The market screen. Photograph → (more photos) → Next product → photograph.
 *
 * Every photo is on the phone before its tile says so; "Next product" only
 * seals what is already safe. The supplier bar is the visit: it carries
 * between products, "Change supplier" starts a new one, and a card can be
 * photographed at any point of the visit — before, between or after the
 * products. Nothing here is typed unless the buyer wants to.
 *
 * Feedback is deliberately quiet: tiles say Saving/Saved, one line says
 * what the phone owes the server, and a failed local write is a red bar
 * that does not go away on its own.
 */

type SupplierOption = { id: number; name: string; booth: string };

type Tile = {
  key: string;
  seq: number;
  url: string;
  state: "saving" | "saved" | "failed";
  /** Kept for retry when the write failed. */
  file?: File;
};

type Banner =
  | { kind: "resumed"; when: string }
  | { kind: "addendum" }
  | { kind: "card" }
  | null;

let tileKey = 0;

export function CaptureScreen({ title, suppliers }: { title: string; suppliers: SupplierOption[] }) {
  const t = useTranslations("capture");
  const outbox = useOutbox();
  const scope = outbox?.storageScope ?? "";

  const [visit, setVisit] = useState<LocalVisit | null>(null);
  const [capture, setCapture] = useState<LocalCapture | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [productIndex, setProductIndex] = useState(1);
  const [previous, setPrevious] = useState<LocalCapture | undefined>(undefined);
  const [lastTiming, setLastTiming] = useState<PhotoTimings | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [storeError, setStoreError] = useState(false);
  const [storeUnavailable, setStoreUnavailable] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNoteText] = useState("");
  // Buttons wait for the store to be read: a tap during that first read
  // would race the resumed capture and the visit being restored.
  const [ready, setReady] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLInputElement>(null);
  const addendumRef = useRef<HTMLInputElement>(null);
  // The capture being photographed into, readable from async handlers
  // without a stale closure: two photos landing back to back must both
  // count against the same capture object.
  const captureRef = useRef<LocalCapture | null>(null);
  const visitRef = useRef<LocalVisit | null>(null);
  // Photos are written one after another, whatever order their change
  // events fire in: two camera returns racing for the same sequence number
  // would overwrite each other under one key.
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);
  useEffect(() => {
    visitRef.current = visit;
  }, [visit]);

  const now = () => new Date().toISOString();

  /** What the visit holds so far, for the "Product n" label and the previous chip. */
  const refreshFromStore = useCallback(
    async (v: LocalVisit | null) => {
      if (!scope) return;
      try {
        const s = await snapshot(scope);
        const inVisit = v ? s.captures.filter((c) => c.visitId === v.visitId && c.status !== "open" && c.kind === "product") : [];
        setProductIndex(inVisit.length + 1);
        setPrevious(previousCapture(s.captures));
      } catch {
        // Store unreadable: counts stay as they were.
      }
    },
    [scope],
  );

  // First paint: the visit to continue under, and any product left open.
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        await pruneOld(scope).catch(() => 0);
        const v = await ensureVisit(scope, now());
        const open = await resumeCapture(scope);
        if (cancelled) return;
        setVisit(v);
        if (open) {
          // The open capture's own visit wins over "current": a product left
          // half-photographed keeps the booth it was photographed at.
          const photos = await photosOf(scope, open.captureId);
          setTiles(
            photos.map((p) => ({
              key: `t${tileKey++}`,
              seq: p.seq,
              url: photoUrl(p),
              state: "saved" as const,
            })),
          );
          setCapture(open);
          setNoteText(open.note);
          setBanner({ kind: "resumed", when: formatLocalMinute(open.startedAt) });
          await refreshFromStore({ ...v, visitId: open.visitId });
        } else {
          setCapture(newCapture(v.visitId, "product", now()));
          await refreshFromStore(v);
        }
        setReady(true);
        setPersisted(await requestPersistentStorage());
      } catch {
        if (!cancelled) setStoreUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, refreshFromStore]);

  // A delivery pass finished: the previous chip may have moved to "uploaded".
  const epoch = outbox?.epoch ?? 0;
  useEffect(() => {
    void refreshFromStore(visitRef.current);
  }, [epoch, refreshFromStore]);

  // Object URLs are released when the screen goes.
  useEffect(() => {
    return () => {
      for (const tile of tiles) URL.revokeObjectURL(tile.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persistFile(file: File, existingKey?: string) {
    const current = captureRef.current;
    // Only an open capture takes photos; a sealed one is frozen (addenda
    // are the way in), so a late change event never lands on it.
    if (!ready || !current || !scope || current.status !== "open") return;
    const key = existingKey ?? `t${tileKey++}`;
    const url = URL.createObjectURL(file);
    setTiles((prev) =>
      existingKey
        ? prev.map((tile) => (tile.key === key ? { ...tile, state: "saving", url } : tile))
        : [...prev, { key, seq: -1, url, state: "saving", file }],
    );
    try {
      const result = await addPhoto(scope, current, file, now(), (savedCapture, photo) => {
        // The original committed: this is the "Saved" moment.
        captureRef.current = savedCapture;
        setCapture(savedCapture);
        setTiles((prev) =>
          prev.map((tile) =>
            tile.key === key ? { ...tile, seq: photo.seq, state: "saved", file: undefined } : tile,
          ),
        );
        setStoreError(false);
      });
      setLastTiming(result.timings);
    } catch {
      setTiles((prev) => prev.map((tile) => (tile.key === key ? { ...tile, state: "failed", file } : tile)));
      setStoreError(true);
    }
  }

  function onFiles(list: FileList | null) {
    if (!list) return;
    setBanner(null);
    for (const file of Array.from(list)) {
      writeQueue.current = writeQueue.current.then(() => persistFile(file)).catch(() => {});
    }
  }

  async function onRemove(tile: Tile) {
    const current = captureRef.current;
    if (!current || !scope) return;
    if (tile.state === "failed") {
      setTiles((prev) => prev.filter((x) => x.key !== tile.key));
      if (!tiles.some((x) => x.state === "failed" && x.key !== tile.key)) setStoreError(false);
      return;
    }
    const next = await removePhoto(scope, current, tile.seq);
    captureRef.current = next;
    setCapture(next);
    setTiles((prev) => prev.filter((x) => x.key !== tile.key));
    URL.revokeObjectURL(tile.url);
  }

  async function onNext() {
    const current = captureRef.current;
    const v = visitRef.current;
    if (!current || !v || !scope || current.photoCount === 0) return;
    if (tiles.some((x) => x.state !== "saved")) return;
    // Switch to the next product FIRST, synchronously: a photo returning
    // from the camera during the seal below must land on the new product,
    // never on the one being closed.
    const fresh = newCapture(v.visitId, "product", now());
    captureRef.current = fresh;
    setCapture(fresh);
    for (const tile of tiles) URL.revokeObjectURL(tile.url);
    setTiles([]);
    setNoteText("");
    setBanner(null);
    setProductIndex((n) => n + 1);
    const sealed = await seal(scope, current, now());
    outbox?.kick();
    setPrevious(sealed);
    setVisit(await touchVisit(scope, v, now()));
  }

  async function onCard(list: FileList | null) {
    const v = visitRef.current;
    const file = list?.[0];
    if (!v || !scope || !file) return;
    // A card is its own capture under the same visit, sealed at once: one
    // photo is the whole of it, and it must reach review as a contact.
    let card = newCapture(v.visitId, "contact", now());
    try {
      const result = await addPhoto(scope, card, file, now());
      card = result.capture;
      setLastTiming(result.timings);
      const sealed = await seal(scope, card, now());
      outbox?.kick();
      const nextVisit = await markVisitCard(scope, v, sealed.captureId);
      setVisit(nextVisit);
      setBanner({ kind: "card" });
      setStoreError(false);
    } catch {
      setStoreError(true);
    }
  }

  async function onAddendum(list: FileList | null) {
    const file = list?.[0];
    if (!previous || !scope || !file) return;
    try {
      const result = await addAddendum(scope, previous.captureId, file, now());
      setLastTiming(result.timings);
      outbox?.kick();
      setBanner({ kind: "addendum" });
      setStoreError(false);
    } catch {
      setStoreError(true);
    }
  }

  async function onChangeSupplier() {
    const current = captureRef.current;
    const v = visitRef.current;
    if (!ready || !v || !scope) return;
    const fresh = await startVisit(scope, now());
    // Same order as Next product: the screen moves to the new booth in one
    // synchronous step, then the product left behind is sealed under the
    // booth it was photographed at.
    const nextCapture = newCapture(fresh.visitId, "product", now());
    captureRef.current = nextCapture;
    visitRef.current = fresh;
    setVisit(fresh);
    setCapture(nextCapture);
    for (const tile of tiles) URL.revokeObjectURL(tile.url);
    setTiles([]);
    setNoteText("");
    setBanner(null);
    setProductIndex(1);
    if (current && current.photoCount > 0 && tiles.every((x) => x.state === "saved")) {
      await seal(scope, current, now());
      outbox?.kick();
    }
    await refreshFromStore(fresh);
  }

  async function onPickSupplier(option: SupplierOption | null) {
    const v = visitRef.current;
    if (!v || !scope) return;
    setVisit(await setLocalVisitSupplier(scope, v, option ? { id: option.id, name: option.name } : null));
    setSheetOpen(false);
    setQuery("");
  }

  async function onNoteBlur() {
    const current = captureRef.current;
    if (!current || !scope) return;
    const next = await setNote(scope, current, note);
    captureRef.current = next;
    setCapture(next);
  }

  const allSaved = tiles.length > 0 && tiles.every((x) => x.state === "saved");
  const filtered = suppliers.filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.booth.toLowerCase().includes(q);
  });

  const status = (() => {
    if (!outbox) return null;
    if (outbox.syncing) return { tone: "sub", text: t("saving") };
    if (outbox.blocked > 0) return { tone: "warn", text: t("syncFailed", { count: outbox.blocked }) };
    if (outbox.pending > 0) return { tone: "sub", text: t("waiting", { count: outbox.pending }) };
    if (outbox.offline) return { tone: "sub", text: t("offline") };
    return { tone: "ok", text: t("synced") };
  })();

  const supplierLabel = visit?.supplierName
    ? visit.supplierName
    : visit?.cardCaptureId
      ? t("supplierCard")
      : t("supplierUnknown");

  const big =
    "press focus-ring flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold";

  return (
    <div className="mx-auto max-w-lg px-4 pb-44 pt-4" data-testid="capture-screen" data-ready={ready ? "1" : "0"}>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-ink">{title}</h1>
        <div className="flex items-center gap-3 text-[12px]">
          <Link href="/catalog/drafts" className="text-sub underline-offset-2 hover:underline">
            {t("reviewLink")}
          </Link>
          <Link href="/catalog/new" className="text-sub underline-offset-2 hover:underline" data-testid="detailed-form-link">
            {t("detailedForm")}
          </Link>
        </div>
      </div>

      {/* Supplier bar — the visit. */}
      <div
        className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5"
        data-testid="supplier-bar"
        data-visit={visit?.visitId ?? ""}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Contact className="h-4 w-4 shrink-0 text-faint" />
          <span
            className={`truncate text-[14px] font-semibold ${visit?.supplierName || visit?.cardCaptureId ? "text-ink" : "text-sub"}`}
            data-testid="supplier-label"
          >
            {supplierLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
            data-testid="set-supplier"
          >
            {t("setSupplier")}
          </button>
          <button
            type="button"
            onClick={onChangeSupplier}
            title={t("changeSupplierHint")}
            className="rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
            data-testid="change-supplier"
          >
            {t("changeSupplier")}
          </button>
        </div>
      </div>

      {storeUnavailable ? (
        <p className="mb-3 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger" data-testid="store-unavailable">
          {t("privateMode")}
        </p>
      ) : null}
      {storeError ? (
        <p className="mb-3 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger" data-testid="store-error">
          {t("storeFailed")}
        </p>
      ) : null}
      {banner?.kind === "resumed" ? (
        <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-sub" data-testid="resumed-banner">
          {t("resumed", { when: banner.when })}
        </p>
      ) : null}
      {banner?.kind === "addendum" ? (
        <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-sub" data-testid="addendum-banner">
          {t("addendumSaved")}
        </p>
      ) : null}
      {banner?.kind === "card" ? (
        <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-sub" data-testid="card-banner">
          {t("cardSaved")}
        </p>
      ) : null}

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-sub" data-testid="product-index">
          {t("productN", { n: productIndex })}
        </span>
        {capture ? (
          <span className="font-mono text-[10px] text-faint" data-testid="capture-id">
            {capture.captureId.slice(0, 12)}
          </span>
        ) : null}
      </div>

      {tiles.length === 0 ? (
        <p className="mb-3 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-sub">
          {t("noPhotosYet")}
        </p>
      ) : (
        <div className="mb-3 grid grid-cols-3 gap-2" data-testid="tiles">
          {tiles.map((tile) => (
            <div key={tile.key} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2" data-testid={`tile-${tile.state}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tile.url} alt="" className="h-full w-full object-cover" />
              <span
                className={`absolute bottom-1 left-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                  tile.state === "saved"
                    ? "bg-ink/80 text-bg"
                    : tile.state === "saving"
                      ? "bg-surface/90 text-sub"
                      : "bg-danger text-white"
                }`}
              >
                {tile.state === "saved" ? <Check className="h-3 w-3" /> : tile.state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                {tile.state === "saved" ? t("saved") : tile.state === "saving" ? t("saving") : t("notSaved")}
              </span>
              {tile.state === "failed" && tile.file ? (
                <button
                  type="button"
                  onClick={() => tile.file && persistFile(tile.file, tile.key)}
                  className="absolute inset-x-1 top-1 rounded-md bg-surface/90 py-1 text-[11px] font-semibold text-ink"
                  data-testid="retry-save"
                >
                  {t("retrySave")}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("remove")}
                  onClick={() => onRemove(tile)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-bg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        value={note}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={onNoteBlur}
        placeholder={t("notePlaceholder")}
        aria-label={t("note")}
        className="mb-3 h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint"
        data-testid="capture-note"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" data-testid="status-line">
        {status ? (
          <span className={status.tone === "warn" ? "font-medium text-warn" : status.tone === "ok" ? "text-ok" : "text-sub"}>
            {status.text}
          </span>
        ) : null}
        {lastTiming ? (
          <span className="text-faint" data-testid="timing">
            {t("savedTiming", { ms: Math.round(lastTiming.persistMs) })}
            {lastTiming.compressMs !== null
              ? ` · ${Math.round(lastTiming.originalBytes / 1024)}→${Math.round(lastTiming.storedBytes / 1024)} KB`
              : ""}
          </span>
        ) : null}
        {persisted === false ? <span className="text-faint">{t("storageNotProtected")}</span> : null}
      </div>

      {/* The thumb's row. Fixed above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg/95 px-4 pb-2 pt-2 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={!ready} className={`${big} bg-action text-white active:bg-action-press disabled:opacity-50`} data-testid="take-photo">
              <Camera className="h-5 w-5" /> {t("takePhoto")}
            </button>
            <button type="button" onClick={() => libraryRef.current?.click()} disabled={!ready} className={`${big} border border-line bg-surface text-ink disabled:opacity-50`} data-testid="add-photos">
              <ImagePlus className="h-5 w-5" /> {t("addPhotos")}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onNext}
              disabled={!allSaved}
              className={`${big} border-2 ${allSaved ? "border-action text-action" : "border-line text-faint"} bg-surface`}
              data-testid="next-product"
            >
              {t("nextProduct")} <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <button type="button" onClick={() => cardRef.current?.click()} className="flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 font-medium text-ink" data-testid="card-button">
              <Contact className="h-4 w-4" /> {t("card")}
            </button>
            <button
              type="button"
              onClick={() => addendumRef.current?.click()}
              disabled={!previous}
              className={`flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 font-medium ${previous ? "text-ink" : "text-faint"}`}
              data-testid="add-to-previous"
            >
              <RefreshCw className="h-4 w-4" /> {t("addToPrevious")}
              {previous ? (
                <span className="text-faint" data-testid="previous-state">
                  · {previous.status === "sent" ? t("previousSent") : t("previousQueued")}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="camera-input" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" data-testid="library-input" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={cardRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="card-input" onChange={(e) => { void onCard(e.target.files); e.target.value = ""; }} />
      <input ref={addendumRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="addendum-input" onChange={(e) => { void onAddendum(e.target.files); e.target.value = ""; }} />

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-label={t("setSupplier")} data-testid="supplier-sheet">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search className="h-4 w-4 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchSuppliers")}
              className="h-10 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
              data-testid="supplier-search"
            />
            <button type="button" onClick={() => setSheetOpen(false)} aria-label="close" className="p-2 text-sub">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visit?.supplierId ? (
              <button type="button" onClick={() => onPickSupplier(null)} className="w-full border-b border-line px-4 py-3 text-left text-[14px] text-sub" data-testid="clear-supplier">
                {t("clearSupplier")}
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-sub">{t("noSupplierMatch")}</p>
            ) : (
              filtered.slice(0, 200).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPickSupplier(s)}
                  className="flex w-full flex-col items-start border-b border-line px-4 py-3 text-left"
                  data-testid={`supplier-option-${s.id}`}
                >
                  <span className="text-[15px] font-medium text-ink">{s.name}</span>
                  {s.booth ? <span className="text-[12px] text-sub">{s.booth}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
