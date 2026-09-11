"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AlertTriangle, CheckCircle2, CircleDashed, Download, FileUp, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsAdmin } from "@/components/role-provider";
import { deleteOrderDocument } from "@/lib/actions/finance";
import { updateDossierMeta, uploadDossierDocument } from "@/lib/actions/dossier";
import {
  DOSSIER_ITEMS,
  FAPIAO_TYPES,
  TAX_REGIMES,
  type DossierStatus,
  type TaxRegime,
} from "@/lib/dossier";

/**
 * The rebate dossier card: the regime and header the accountant needs,
 * then her nineteen rows with a state and an upload each. Everything here
 * is metadata and files about the order; the agreed document is untouched,
 * which is why it stays editable on a confirmed or shipped order.
 */
export type DossierMeta = {
  version: number;
  taxRegime: TaxRegime;
  customsDeclarationNo: string;
  exportContractDate: string;
  purchaseContractDate: string;
  warehouseInDate: string;
  exportDate: string;
};

export function DossierCard({
  orderId,
  meta,
  status,
  financeOn,
  videoMaxMb,
}: {
  orderId: number;
  meta: DossierMeta;
  status: DossierStatus;
  /** The zip needs the finance module (it carries supplier-side files). */
  financeOn: boolean;
  videoMaxMb: number;
}) {
  const t = useTranslations("dossier");
  const locale = useLocale();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [form, setForm] = useState<DossierMeta>(meta);
  const [saving, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty =
    form.taxRegime !== meta.taxRegime ||
    form.customsDeclarationNo !== meta.customsDeclarationNo ||
    form.exportContractDate !== meta.exportContractDate ||
    form.purchaseContractDate !== meta.purchaseContractDate ||
    form.warehouseInDate !== meta.warehouseInDate ||
    form.exportDate !== meta.exportDate;

  function save() {
    setSaveMsg(null);
    startSave(async () => {
      const result = await updateDossierMeta(orderId, { ...form, version: meta.version });
      if (result.error) {
        const key = (["customsNo", "date", "futureDate", "conflict"].includes(result.error)
          ? `error_${result.error}`
          : "error_generic") as "error_generic";
        setSaveMsg({ kind: "error", text: t(key) });
        return;
      }
      setSaveMsg({ kind: "ok", text: t("saved") });
      router.refresh();
    });
  }

  const item6 = status.items[5];
  const canExport = /^\d{18}$/.test(meta.customsDeclarationNo);
  const set = (field: keyof DossierMeta) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <section className="rounded-lg border border-line bg-surface p-4" data-testid="dossier-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-sub">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[12px] tabular-nums ${status.complete ? "text-ok" : "text-sub"}`}
            data-testid="dossier-progress"
          >
            {status.complete
              ? t("complete")
              : t("progress", { uploaded: status.uploaded, total: DOSSIER_ITEMS.length, outstanding: status.outstanding })}
          </span>
          {isAdmin && financeOn ? (
            canExport ? (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/export/dossier?order=${orderId}&locale=${locale}`} data-testid="dossier-download">
                  <Download className="mr-1 h-4 w-4" strokeWidth={1.5} />
                  {t("download")}
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title={t("downloadDisabled")} data-testid="dossier-download">
                <Download className="mr-1 h-4 w-4" strokeWidth={1.5} />
                {t("download")}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {/* Header: regime, declaration number, the four dates. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="dossier-meta">
        <div className="flex flex-col gap-1.5 md:col-span-3">
          <Label>{t("regime")}</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("regime")}>
            {TAX_REGIMES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={form.taxRegime === r}
                onClick={() => set("taxRegime")(r)}
                className={`rounded-[10px] border px-3 py-2 text-left transition ${
                  form.taxRegime === r ? "border-action bg-action-soft" : "border-line bg-surface-2 hover:border-line-strong"
                }`}
                data-testid={`regime-${r}`}
              >
                <span className="block text-[13px] font-bold text-ink">{t(`regime_${r}`)}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-sub">{t(`regimeHelp_${r}`)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customsNo">{t("customsNo")}</Label>
          <Input
            id="customsNo"
            inputMode="numeric"
            placeholder="310120261234567890"
            value={form.customsDeclarationNo}
            // Pasted with spaces or dashes is fine: only the digits are kept.
            onChange={(e) => set("customsDeclarationNo")(e.target.value.replace(/\D/g, "").slice(0, 18))}
            className="font-mono"
            data-testid="customs-no"
          />
          <span className="text-[11px] text-sub">{t("customsNoHelp")}</span>
        </div>
        <DateField id="exportDate" label={t("exportDate")} help={t("exportDateHelp")} value={form.exportDate} onChange={set("exportDate")} />
        <DateField id="exportContractDate" label={t("exportContractDate")} value={form.exportContractDate} onChange={set("exportContractDate")} />
        <DateField id="purchaseContractDate" label={t("purchaseContractDate")} value={form.purchaseContractDate} onChange={set("purchaseContractDate")} />
        <DateField id="warehouseInDate" label={t("warehouseInDate")} value={form.warehouseInDate} onChange={set("warehouseInDate")} />
        <div className="flex items-end gap-2">
          <Button type="button" size="sm" onClick={save} disabled={!dirty || saving} data-testid="dossier-save">
            {t("save")}
          </Button>
          {saveMsg ? (
            <span className={`text-xs ${saveMsg.kind === "ok" ? "text-ok" : "text-danger"}`} data-testid="dossier-save-msg">
              {saveMsg.text}
            </span>
          ) : null}
        </div>
      </div>

      {/* Banners: the decision, the clock, the fapiao risk, the deadlines. */}
      <div className="mt-3 flex flex-col gap-2">
        {meta.taxRegime === "undecided" ? (
          <p
            className={`rounded-md px-3 py-2 text-xs ${status.undecidedWithExportDate ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
            data-testid="dossier-banner-undecided"
          >
            {status.undecidedWithExportDate && status.deadlines.declareDeadline
              ? t("bannerUndecidedClock", { deadline: status.deadlines.declareDeadline })
              : t("bannerUndecided")}
          </p>
        ) : null}
        {item6.status === "risk" ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" data-testid="dossier-banner-risk">
            {t("bannerRisk")}
          </p>
        ) : null}
        {status.deadlines.declareDeadline ? (
          <div className="flex flex-wrap gap-2 text-[11px]" data-testid="dossier-deadlines">
            {meta.taxRegime === "rebate" && status.deadlines.fxDeadline ? (
              <Badge variant="warning">{t("fxDeadline", { date: status.deadlines.fxDeadline })}</Badge>
            ) : null}
            <Badge variant="secondary">{t("declareDeadline", { date: status.deadlines.declareDeadline })}</Badge>
            <span className="self-center text-sub">{t("retention")}</span>
          </div>
        ) : null}
      </div>

      {/* The nineteen rows. */}
      <ul className="mt-4 flex flex-col divide-y divide-line" data-testid="dossier-items">
        {DOSSIER_ITEMS.map((def) => {
          const st = status.items[def.n - 1];
          return (
            <li key={def.key} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-start md:gap-3" data-testid={`dossier-item-${def.n}`}>
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 w-6 shrink-0 font-mono text-[11px] text-faint">{String(def.n).padStart(2, "0")}</span>
                <StatusIcon status={st.status} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-bold text-ink">{def.zh}</span>
                    <span className="text-[12px] text-sub">{def.en}</span>
                    <Badge variant="secondary">{t(`responsible_${def.responsible}`)}</Badge>
                    <span
                      className={`text-[11px] ${st.status === "risk" ? "font-semibold text-danger" : st.status === "missing" ? "text-warn" : "text-sub"}`}
                      data-testid={`dossier-status-${def.n}`}
                    >
                      {t(`status_${st.status}`)}
                    </span>
                  </div>
                  {def.auto && st.status === "auto" ? <p className="text-[11px] text-sub">{t("proformaAuto")}</p> : null}
                  {st.warning ? (
                    <p className={`mt-0.5 text-[11.5px] ${st.status === "risk" ? "text-danger" : "text-warn"}`} data-testid={`dossier-warning-${def.n}`}>
                      {t(`warning_${st.warning}`)}
                    </p>
                  ) : null}
                  {st.files.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {st.files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 text-[12px]">
                          <a href={f.path} download={f.originalName} className="min-w-0 truncate text-ink hover:underline">
                            {f.originalName}
                          </a>
                          {f.fapiaoType ? <span className="text-faint">{t(`fapiao_${f.fapiaoType}` as "fapiao_none")}</span> : null}
                          {isAdmin ? (
                            <button
                              type="button"
                              className="text-[11px] text-faint hover:text-danger"
                              onClick={async () => {
                                await deleteOrderDocument(orderId, f.id);
                                router.refresh();
                              }}
                            >
                              {t("remove")}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <div className="md:w-72 md:shrink-0">
                {def.video ? (
                  <VideoUpload orderId={orderId} maxMb={videoMaxMb} onDone={() => router.refresh()} />
                ) : (
                  <ItemUpload orderId={orderId} kind={def.key} withFapiao={def.key === "supplier_invoice"} onDone={() => router.refresh()} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DateField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} data-testid={id} />
      {help ? <span className="text-[11px] text-sub">{help}</span> : null}
    </div>
  );
}

function StatusIcon({ status }: { status: DossierStatus["items"][number]["status"] }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  switch (status) {
    case "uploaded":
      return <CheckCircle2 className={`${cls} text-ok`} strokeWidth={2} />;
    case "auto":
      return <Sparkles className={`${cls} text-ok`} strokeWidth={1.5} />;
    case "risk":
      return <AlertTriangle className={`${cls} text-danger`} strokeWidth={2} />;
    case "missing":
      return <XCircle className={`${cls} text-warn`} strokeWidth={1.5} />;
    default:
      return <CircleDashed className={`${cls} text-faint`} strokeWidth={1.5} />;
  }
}

function ItemUpload({
  orderId,
  kind,
  withFapiao,
  onDone,
}: {
  orderId: number;
  kind: string;
  withFapiao: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("dossier");
  const formRef = useRef<HTMLFormElement>(null);
  const [fapiao, setFapiao] = useState<string>("special");
  async function action(prev: { error?: string } | undefined, formData: FormData) {
    const result = await uploadDossierDocument(orderId, prev, formData);
    if (!result.error) {
      formRef.current?.reset();
      onDone();
    }
    return result;
  }
  const [result, formAction, pending] = useActionState(action, undefined);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1.5" data-testid={`dossier-upload-${kind}`}>
      <input type="hidden" name="kind" value={kind} />
      {withFapiao ? (
        <>
          <input type="hidden" name="fapiaoType" value={fapiao} />
          <Select value={fapiao} onValueChange={setFapiao}>
            <SelectTrigger className="h-8 text-xs" aria-label={t("fapiaoType")} data-testid="fapiao-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FAPIAO_TYPES.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`fapiao_${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : null}
      <div className="flex items-center gap-1.5">
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp"
          className="min-w-0 flex-1 text-[11px] text-sub file:mr-2 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-[11px] file:text-ink"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <FileUp className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
          {pending ? t("uploading") : t("upload")}
        </Button>
      </div>
      {result?.error ? (
        <p className="text-[11px] text-danger">{t(`uploadError_${result.error}` as "uploadError_invalid")}</p>
      ) : null}
    </form>
  );
}

function VideoUpload({ orderId, maxMb, onDone }: { orderId: number; maxMb: number; onDone: () => void }) {
  const t = useTranslations("dossier");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > maxMb * 1024 * 1024) {
      setError("size");
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/orders/${orderId}/dossier-video`, { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.status === 413 ? "size" : res.status === 429 ? "rate" : (data.error ?? "invalid"));
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      onDone();
    } catch {
      setError("invalid");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" data-testid="dossier-upload-loading_video">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          required
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          className="min-w-0 flex-1 text-[11px] text-sub file:mr-2 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-[11px] file:text-ink"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <FileUp className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
          {pending ? t("uploading") : t("upload")}
        </Button>
      </div>
      <span className="text-[11px] text-sub">{t("videoHint", { mb: maxMb })}</span>
      {error ? <p className="text-[11px] text-danger">{t(`uploadError_${error}` as "uploadError_invalid")}</p> : null}
    </form>
  );
}
