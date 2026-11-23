"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, FileUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOSSIER_ITEMS } from "@/lib/dossier";
import { DOSSIER_DOCUMENT_MAX_BYTES, DOSSIER_DOCUMENT_MAX_MB } from "@/lib/upload-limits";

const MAX_FILES = 10;

type FileResult = {
  name: string;
  status: "filed" | "unrecognized" | "error";
  kind?: string;
  reason?: string;
  error?: string;
};

export function DossierBulkSort({ orderId }: { orderId: number }) {
  const t = useTranslations("dossier");
  const locale = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);

  function validate(files: File[]): string | null {
    if (files.length > MAX_FILES) return "count";
    if (files.some((file) => file.size > DOSSIER_DOCUMENT_MAX_BYTES)) return "size";
    if (files.reduce((sum, file) => sum + file.size, 0) > DOSSIER_DOCUMENT_MAX_BYTES) return "totalSize";
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return;
    const invalid = validate(files);
    setError(invalid);
    setResults([]);
    if (invalid) return;

    const body = new FormData();
    for (const file of files) body.append("file", file, file.name);
    setPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/dossier-sort`, { method: "POST", body });
      const data = await response.json().catch(() => null) as {
        ok?: boolean;
        results?: FileResult[];
        error?: string;
      } | null;
      if (!response.ok || data?.ok !== true || !Array.isArray(data.results)) {
        setError(response.status === 429 ? "rate" : data?.error ?? "server");
        return;
      }
      setResults(data.results);
      setError(null);
      if (inputRef.current) inputRef.current.value = "";
      setChosen(0);
      if (data.results.some((result) => result.status === "filed")) router.refresh();
    } catch {
      setError("network");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-line bg-surface-2 p-3" data-testid="dossier-ai-sort" aria-busy={pending}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-action" strokeWidth={1.5} />
            {t("aiSortTitle")}
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{t("aiSortHelp", { max: MAX_FILES, mb: DOSSIER_DOCUMENT_MAX_MB })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <input
            ref={inputRef}
            type="file"
            name="file"
            multiple
            required
            disabled={pending}
            accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp"
            aria-label={t("aiSortChoose")}
            data-testid="dossier-ai-files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              setChosen(files.length);
              setResults([]);
              setError(validate(files));
            }}
            className="max-w-64 text-[11px] text-sub file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-[11px] file:text-ink"
          />
          <Button type="submit" size="sm" disabled={pending || chosen === 0} data-testid="dossier-ai-submit">
            <FileUp className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
            {pending ? t("aiSortPending") : t("aiSortAction")}
          </Button>
        </div>
      </div>
      {chosen > 0 ? <p className="mt-2 text-[11px] text-sub">{t("aiSortChosen", { count: chosen })}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-danger">
          {t(`aiSortError_${error}` as "aiSortError_server", { max: MAX_FILES, mb: DOSSIER_DOCUMENT_MAX_MB })}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5" aria-live="polite">
          {results.map((result, index) => {
            const item = result.kind ? DOSSIER_ITEMS.find((candidate) => candidate.key === result.kind) : undefined;
            return (
              <li key={`${result.name}-${index}`} className="flex items-start gap-2 text-[12px]" data-testid={`dossier-ai-result-${index}`}>
                {result.status === "filed" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                ) : (
                  <FileUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                )}
                <span className="min-w-0 break-words text-ink">
                  <span className="font-medium">{result.name}</span>{" "}
                  {result.status === "filed" && item
                    ? `→ ${locale === "zh" ? `${item.zh} ${item.en}` : `${item.en} ${item.zh}`}`
                    : result.status === "unrecognized"
                      ? t("aiSortUnrecognized", { reason: result.reason || t("aiSortUnclear") })
                      : t(`aiSortError_${result.error ?? "read"}` as "aiSortError_read", { mb: DOSSIER_DOCUMENT_MAX_MB })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </form>
  );
}
